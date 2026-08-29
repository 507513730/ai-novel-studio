// 章节执行路由：状态回灌 / 待确认区 / 记忆面（角色与势力状态机显式查看与手动修正）
import type { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { buildBackfillContext } from '../../services/context/dynamic'
import { callLlmJson } from '../../services/jsonSafe'
import { writeCharacterStates, writeFactionStates } from '../../services/ledger'
import { updateSmartContext } from '../../services/smartContext'

export function registerChapterBackfillRoutes(router: Router, db: DatabaseSync): void {
  // ---------- 状态回灌（提取 → 待确认区） ----------
  router.post('/:novelId/chapters/:chapterId/backfill', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const chapter = db
        .prepare('SELECT content FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { content: string } | undefined
      if (!chapter || !chapter.content) {
        res.status(400).json({ error: '章节无正文' })
        return
      }
      const messages = buildBackfillContext(db, novelId, chapterId, chapter.content)
      const result = await callLlmJson<{
        characterStates: Array<{ name: string; state: string }>
        newFacts: Array<{ content: string }>
        foreshadows: Array<{ content: string; hint: string }>
        paidForeshadows: Array<{ content: string }>
        factionStates: Array<{ name: string; state: string }>
      }>(
        db,
        'extraction',
        {
          novelId,
          messages,
          maxTokens: 4096
        },
        (obj) => {
          const r = obj as Record<string, unknown>
          if (!Array.isArray(r.characterStates) && !Array.isArray(r.newFacts)) return null
          return {
            characterStates: Array.isArray(r.characterStates)
              ? r.characterStates.map((x) => {
                  const c = x as Record<string, unknown>
                  return { name: String(c.name ?? ''), state: String(c.state ?? '') }
                })
              : [],
            newFacts: Array.isArray(r.newFacts)
              ? r.newFacts.map((x) => ({ content: String((x as Record<string, unknown>).content ?? '') }))
              : [],
            foreshadows: Array.isArray(r.foreshadows)
              ? r.foreshadows.map((x) => {
                  const f = x as Record<string, unknown>
                  return { content: String(f.content ?? ''), hint: String(f.hint ?? '') }
                })
              : [],
            paidForeshadows: Array.isArray(r.paidForeshadows)
              ? r.paidForeshadows.map((x) => ({ content: String((x as Record<string, unknown>).content ?? '') }))
              : [],
            // v0.13.0（批E/I4）：势力状态（缺失时容错为空数组）
            factionStates: Array.isArray(r.factionStates)
              ? r.factionStates.map((x) => {
                  const f = x as Record<string, unknown>
                  return { name: String(f.name ?? ''), state: String(f.state ?? '') }
                })
              : []
          }
        },
        'backfill'
      )

      // 写入待确认区（fact 表 confirmed=0；foreshadow 表 status=laid；角色状态写入 ledger 待确认）
      const insertFact = db.prepare(
        'INSERT INTO fact (novel_id, chapter_id, content, confirmed) VALUES (?, ?, ?, 0)'
      )
      const insertForeshadow = db.prepare(
        'INSERT INTO foreshadow (novel_id, chapter_id, content, status) VALUES (?, ?, ?, ?)'
      )
      const paidCount = result.paidForeshadows.length
      db.exec('BEGIN')
      try {
        for (const f of result.newFacts) {
          if (f.content) insertFact.run(novelId, chapterId, f.content)
        }
        for (const f of result.foreshadows) {
          if (f.content) insertForeshadow.run(novelId, chapterId, f.content, 'laid')
        }
        // 已兑现伏笔：把同名 laid 伏笔标记回收
        if (paidCount > 0) {
          for (const p of result.paidForeshadows) {
            const row = db
              .prepare(
                "SELECT id FROM foreshadow WHERE novel_id = ? AND content = ? AND status = 'laid' ORDER BY id LIMIT 1"
              )
              .get(novelId, p.content) as { id: number } | undefined
            if (row) {
              db.prepare("UPDATE foreshadow SET status = 'paid' WHERE id = ?").run(row.id)
            }
          }
        }
        // v0.13.0（批E/I4）：势力状态更新（匹配 world.factions_json 中的 name，更新 currentState）
        writeFactionStates(db, novelId, result.factionStates ?? [])
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      // C1：回灌后异步更新书级智能上下文（不阻塞响应）
      void updateSmartContext(db, novelId).catch(() => undefined)
      // E2：时间线事件写入（回灌时间线消费空壳表）
      try {
        const novelTitle = db.prepare('SELECT title FROM novel WHERE id = ?').get(novelId) as
          | { title: string }
          | undefined
        const chapterTitle = db
          .prepare('SELECT title FROM chapter WHERE id = ?')
          .get(chapterId) as { title: string } | undefined
        db.prepare(
          'INSERT INTO timeline_event (novel_id, chapter_id, title, content, time_ref) VALUES (?, ?, ?, ?, ?)'
        ).run(
          novelId,
          chapterId,
          chapterTitle?.title ?? '',
          `${novelTitle?.title ?? ''} 第${chapterId}章：${(result.newFacts ?? []).length} 条新事实、${(result.foreshadows ?? []).length} 条新伏笔`,
          `chapter-${chapterId}`
        )
      } catch {
        /* 时间线写入失败不影响主流程 */
      }
      res.json({
        characterStates: result.characterStates.filter((c) => c.name && c.state),
        newFacts: result.newFacts.filter((f) => f.content),
        foreshadows: result.foreshadows.filter((f) => f.content),
        paidForeshadows: paidCount
      })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 待确认区确认（角色状态 → 账本） ----------
  router.post('/:novelId/confirm-state', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({
          characterStates: z.array(z.object({ name: z.string(), state: z.string() }))
        })
        .parse(req.body)
      const written = writeCharacterStates(db, novelId, input.characterStates)
      res.json({ ok: true, written })
    } catch (err) {
      next(err)
    }
  })

  // 待确认区查询（未确认事实 + 角色 pending）
  router.get('/:novelId/pending', (req, res) => {
    const novelId = Number(req.params.novelId)
    const facts = db
      // v0.17.0（审查 M5）：DAO 边界 camelCase（此前 chapter_id 直出）
      .prepare('SELECT id, content, chapter_id AS chapterId FROM fact WHERE novel_id = ? AND confirmed = 0')
      .all(novelId) as Array<Record<string, unknown>>
    const chars = db
      .prepare('SELECT id, name, profile_json FROM character WHERE novel_id = ? AND status = \'pending\'')
      .all(novelId) as Array<Record<string, unknown>>
    res.json({
      pendingFacts: facts,
      pendingCharacters: chars.map((c) => ({
        id: c.id,
        name: c.name,
        profile: JSON.parse(String(c.profile_json ?? '{}'))
      }))
    })
  })

  // ---------- v0.20.0（NovelClaw 学习组）：记忆面——状态机显式查看与手动修正 ----------
  router.get('/:novelId/memory', (req, res) => {
    const novelId = Number(req.params.novelId)
    const chars = db
      .prepare('SELECT name, ledger_json FROM character WHERE novel_id = ? ORDER BY id')
      .all(novelId) as Array<{ name: string; ledger_json: string }>
    const world = db.prepare('SELECT factions_json FROM world WHERE novel_id = ?').get(novelId) as
      | { factions_json: string }
      | undefined
    const facts = db
      .prepare('SELECT id, content FROM fact WHERE novel_id = ? AND confirmed = 0')
      .all(novelId) as Array<{ id: number; content: string }>
    let factions: Array<{ name: string; currentState?: string }> = []
    try {
      factions = JSON.parse(world?.factions_json || '[]') as Array<{ name: string; currentState?: string }>
    } catch {
      factions = []
    }
    res.json({
      characters: chars.map((c) => {
        try {
          const ledger = JSON.parse(c.ledger_json || '{}') as { states?: string[] }
          return { name: c.name, states: ledger.states ?? [] }
        } catch {
          return { name: c.name, states: [] }
        }
      }),
      factions: factions.map((f) => ({ name: f.name, currentState: f.currentState ?? '' })),
      pendingFacts: facts
    })
  })

  router.post('/:novelId/memory/character', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({ name: z.string().min(1), state: z.string().optional(), remove: z.boolean().optional() })
        .parse(req.body)
      const char = db
        .prepare('SELECT id, ledger_json FROM character WHERE novel_id = ? AND name = ?')
        .get(novelId, input.name) as { id: number; ledger_json: string } | undefined
      if (!char) {
        res.status(404).json({ error: '角色不存在' })
        return
      }
      const ledger = JSON.parse(char.ledger_json || '{}') as { states?: string[] }
      const states = ledger.states ?? []
      if (input.remove && input.state) {
        const idx = states.indexOf(input.state)
        if (idx >= 0) states.splice(idx, 1)
      } else if (input.state && !states.includes(input.state)) {
        states.push(input.state.slice(0, 120))
      }
      // v0.21.0（审查 P3 LOW）：状态数组上限 100——与 writeCharacterStates 一致，超出截断最早状态
      if (states.length > 100) states.splice(0, states.length - 100)
      db.prepare('UPDATE character SET ledger_json = ? WHERE id = ?').run(
        JSON.stringify({ ...ledger, states }),
        char.id
      )
      res.json({ ok: true, states })
    } catch (err) {
      next(err)
    }
  })

  router.post('/:novelId/memory/faction', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z.object({ name: z.string().min(1), state: z.string().max(120) }).parse(req.body)
      // v0.21.0（审查 P3 LOW）：factions_json 读改写原子化——BEGIN/COMMIT/ROLLBACK 包裹，
      // 防并发请求（记忆面修正与回灌 writeFactionStates）读到旧值互相覆盖
      db.exec('BEGIN')
      try {
        const world = db.prepare('SELECT factions_json FROM world WHERE novel_id = ?').get(novelId) as
          | { factions_json: string }
          | undefined
        if (!world) {
          db.exec('ROLLBACK')
          res.status(404).json({ error: '世界观未生成' })
          return
        }
        const factions = JSON.parse(world.factions_json || '[]') as Array<Record<string, unknown>>
        const target = factions.find((f) => f.name === input.name)
        if (!target) {
          db.exec('ROLLBACK')
          res.status(404).json({ error: '势力不存在' })
          return
        }
        target.currentState = input.state
        db.prepare("UPDATE world SET factions_json = ?, updated_at = datetime('now') WHERE novel_id = ?").run(
          JSON.stringify(factions),
          novelId
        )
        db.exec('COMMIT')
        res.json({ ok: true })
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    } catch (err) {
      next(err)
    }
  })
}
