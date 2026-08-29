// 章节执行路由：B1 上下文预览（写作上下文可视化）+ v0.24.2（F2）书内全文检索
import type { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { buildChapterWriteContext } from '../../services/context/dynamic'

export function registerChapterSearchRoutes(router: Router, db: DatabaseSync): void {
  // ---------- B1 上下文预览（写作上下文可视化） ----------
  router.get('/:novelId/chapters/:chapterId/context-preview', (req, res) => {
    const novelId = Number(req.params.novelId)
    const chapterId = Number(req.params.chapterId)
    try {
      const ctx = buildChapterWriteContext(db, novelId, chapterId)
      const text = ctx.messages[0].content ?? ''
      const sections: Array<{ key: string; label: string; chars: number; tokens: number }> = []
      const findSection = (label: string): string => {
        const idx = text.indexOf(label)
        if (idx < 0) return ''
        const next = ['【本章任务单】', '【前文回顾】', '【未回收伏笔', '【已确认事实', '【流派节奏', '【爽点', '【本章三方会审', '【绑定写法', '【书级合约', '【世界观手册', '【角色账本', '【参考资料', '【本章任务单】', '请直接输出'].map((l) => {
          const i = text.indexOf(l, idx + label.length)
          return i >= 0 ? i : text.length
        })
        return text.slice(idx, Math.min(...next))
      }
      const defs: Array<{ key: string; label: string }> = [
        { key: 'contract', label: '【书级合约】' },
        { key: 'world', label: '【世界观手册】' },
        { key: 'characters', label: '【角色账本】' },
        { key: 'external', label: '【参考资料·' },
        { key: 'continuity', label: '【未回收伏笔' },
        { key: 'genre', label: '【流派节奏模板' },
        { key: 'triple', label: '【本章三方会审约束' },
        { key: 'style', label: '【绑定写法要求' },
        { key: 'summary', label: '【前文回顾】' }
      ]
      for (const d of defs) {
        const seg = findSection(d.label)
        if (seg) {
          const chars = seg.length
          sections.push({
            key: d.key,
            label: d.key,
            chars,
            tokens: Math.ceil(chars * 1.2)
          })
        }
      }
      res.json({ sections, totalTokens: ctx.budgetUsed, budgetLimit: ctx.budgetLimit })
    } catch (err) {
      // v0.9.0（审查 #9）：固定文案，详情进日志（此前透传 buildChapterWriteContext 内部消息）
      console.error('[context-preview] error:', err instanceof Error ? err.message : String(err))
      res.status(500).json({ error: 'internal error' })
    }
  })

  // ---------- v0.24.2（F2）：书内全文检索（正文/角色/设定/伏笔/事实/知识库） ----------
  // LIKE 方案（50 万字量级单书扫描 <20ms；护栏：转义通配符 + 分组 LIMIT）
  router.get('/:novelId/search', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const q = String(req.query.q ?? '').trim()
      if (!q) {
        res.status(400).json({ error: '搜索词不能为空' })
        return
      }
      if (q.length > 100) {
        res.status(400).json({ error: '搜索词过长（最多 100 字符）' })
        return
      }
      // LIKE 特殊字符转义（配合 ESCAPE '\'，防止用户输入 %/_ 全表通配）
      const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`)
      const like = `%${escaped}%`
      const lowerQ = q.toLowerCase()
      /** 命中窗口：前 20 字 + 命中 + 后 40 字（未命中截前 60 字） */
      const snippet = (text: string): string => {
        const idx = text.toLowerCase().indexOf(lowerQ)
        if (idx < 0) return text.slice(0, 60)
        const from = Math.max(0, idx - 20)
        const to = Math.min(text.length, idx + q.length + 40)
        return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`
      }
      const chapters = db
        .prepare(
          `SELECT id, title, status, word_count AS wordCount, content
           FROM chapter WHERE novel_id = ? AND (content LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')
           ORDER BY id LIMIT 20`
        )
        .all(novelId, like, like, like) as Array<{ id: number; title: string; status: string; wordCount: number; content: string }>
      const characters = db
        .prepare(
          `SELECT id, name, profile_json FROM character
           WHERE novel_id = ? AND (name LIKE ? ESCAPE '\\' OR profile_json LIKE ? ESCAPE '\\') LIMIT 10`
        )
        .all(novelId, like, like) as Array<{ id: number; name: string; profile_json: string }>
      const worldRow = db
        .prepare('SELECT manual_json, factions_json, map_json, timeline_json FROM world WHERE novel_id = ? LIMIT 1')
        .get(novelId) as { manual_json: string | null; factions_json: string | null; map_json: string | null; timeline_json: string | null } | undefined
      const worldBlobs = worldRow ? [worldRow.manual_json, worldRow.factions_json, worldRow.map_json, worldRow.timeline_json] : []
      const worldHit = worldBlobs.find((b) => b && b.toLowerCase().includes(lowerQ)) ?? null
      const foreshadows = db
        .prepare("SELECT id, content, status FROM foreshadow WHERE novel_id = ? AND content LIKE ? ESCAPE '\\' LIMIT 10")
        .all(novelId, like) as Array<{ id: number; content: string; status: string }>
      const facts = db
        .prepare("SELECT id, content FROM fact WHERE novel_id = ? AND content LIKE ? ESCAPE '\\' LIMIT 10")
        .all(novelId, like) as Array<{ id: number; content: string }>
      const kb = db
        .prepare("SELECT id, title, content FROM kb_doc WHERE (novel_id = ? OR novel_id = 0) AND content LIKE ? ESCAPE '\\' LIMIT 10")
        .all(novelId, like) as Array<{ id: number; title: string; content: string }>

      res.json({
        query: q,
        chapters: chapters.map((c) => ({ id: c.id, title: c.title, status: c.status, wordCount: c.wordCount, snippet: snippet(c.content) })),
        characters: characters.map((c) => ({ id: c.id, name: c.name, snippet: snippet(c.profile_json) })),
        world: worldHit ? [{ snippet: snippet(worldHit) }] : [],
        foreshadows: foreshadows.map((f) => ({ id: f.id, content: f.content, status: f.status })),
        facts: facts.map((f) => ({ id: f.id, content: f.content })),
        kb: kb.map((d) => ({ id: d.id, title: d.title, snippet: snippet(d.content) }))
      })
    } catch (err) {
      next(err)
    }
  })
}
