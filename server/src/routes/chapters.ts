import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { buildChapterWriteContext, buildChapterReviewContext, buildBackfillContext, buildFixContext } from '../services/context'
import { generateChapter } from '../services/generate'
import { callLlmJson } from '../services/jsonSafe'
import { writeCharacterStates } from '../services/ledger'
import { AI_ACTIONS, AI_INSERT_ACTIONS } from '../prompts'
import { getBoundStyleRules } from '../services/styleEngine'
import { updateSmartContext } from '../services/smartContext'

export function createChapterExecutionRouter(db: DatabaseSync): Router {
  const router = Router()

  // 审核（可复用：首次审核 + 修复后重审）
  const performReview = async (
    novelId: number,
    chapterId: number,
    content: string
  ): Promise<{
    score: number
    strengths: string[]
    issues: Array<{ severity: string; location: string; problem: string; suggestion: string }>
    needsFix: boolean
  }> => {
    const messages = buildChapterReviewContext(db, novelId, chapterId, content)
    const review = await callLlmJson<{
      score: number
      strengths: string[]
      issues: Array<{ severity: string; location: string; problem: string; suggestion: string }>
      needsFix: boolean
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
        if (typeof r.score !== 'number') return null
        return {
          score: r.score,
          strengths: Array.isArray(r.strengths) ? r.strengths.map(String) : [],
          issues: Array.isArray(r.issues)
            ? r.issues.map((i) => {
                const x = i as Record<string, unknown>
                return {
                  severity: String(x.severity ?? 'medium'),
                  location: String(x.location ?? ''),
                  problem: String(x.problem ?? ''),
                  suggestion: String(x.suggestion ?? '')
                }
              })
            : [],
          needsFix: Boolean(r.needsFix)
        }
      },
      'review'
    )
    // 记录质量债务（high/medium 问题）
    // P20（C7）：按章节+签名去重（同章重复审核不重复插）；修复时置 resolved
    const insertDebt = db.prepare(
      `INSERT OR IGNORE INTO quality_debt (chapter_id, issue, severity)
       SELECT ?, ?, ? WHERE NOT EXISTS (
         SELECT 1 FROM quality_debt WHERE chapter_id = ? AND issue = ? AND resolved = 0
       )`
    )
    for (const issue of review.issues) {
      if (issue.severity === 'high' || issue.severity === 'medium') {
        const sig = `${issue.location} ${issue.problem}`
        insertDebt.run(chapterId, sig, issue.severity, chapterId, sig)
      }
    }
    db.prepare(
      "UPDATE chapter SET review_json = ?, status = 'reviewed', updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(review), chapterId)
    return review
  }

  // ---------- P23 批3（N2）：手动创建章节（空章，后续可生成/编辑） ----------
  router.post('/:novelId/chapters', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({
          title: z.string().max(200).default(''),
          volumeId: z.number().int().positive().nullable().optional()
        })
        .parse(req.body ?? {})
      const novel = db.prepare('SELECT id FROM novel WHERE id = ?').get(novelId) as { id: number } | undefined
      if (!novel) {
        res.status(404).json({ error: 'novel not found' })
        return
      }
      if (input.volumeId) {
        const vol = db.prepare('SELECT id FROM volume WHERE id = ? AND novel_id = ?').get(input.volumeId, novelId) as
          | { id: number }
          | undefined
        if (!vol) {
          res.status(400).json({ error: '卷不存在' })
          return
        }
      }
      const rid = db
        .prepare(
          "INSERT INTO chapter (novel_id, volume_id, title, summary, goal_json, content, status) VALUES (?, ?, ?, '', '{}', '', 'planned')"
        )
        .run(novelId, input.volumeId ?? null, input.title || '未命名章节')
      res.status(201).json({ id: Number(rid.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // ---------- SSE 流式正文生成 ----------
  router.post('/:novelId/chapters/:chapterId/generate', async (req, res) => {
    // P20（S5）：参数 zod 校验（NaN/越界/超大 guidance 一律 400）
    const genInput = z
      .object({
        guidance: z.string().max(1000).optional()
      })
      .safeParse(req.body ?? {})
    if (!genInput.success) {
      res.status(400).json({ error: 'invalid request body' })
      return
    }
    const novelId = z.coerce.number().int().positive().safeParse(req.params.novelId)
    const chapterId = z.coerce.number().int().positive().safeParse(req.params.chapterId)
    if (!novelId.success || !chapterId.success) {
      res.status(400).json({ error: 'invalid chapter id' })
      return
    }

    const abort = new AbortController()
    let aborted = false
    // v0.7.2+（Node24 语义修复）：Node 24 的 IncomingMessage 'close' 在请求体读完即触发，
    // 用 req.on('close') 会让 SSE 生成被自己立即 abort（所有事件被吞、0 字产出）。
    // 改监听 res 流：仅当响应未正常结束时触发 abort（= 客户端真正断连/取消）。
    res.on('close', () => {
      if (!res.writableEnded) {
        aborted = true
        abort.abort()
      }
    })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (event: string, data: unknown): void => {
      if (aborted || res.writableEnded) return
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch {
        /* 连接已死：停止写入（P20 D1：不再抛未捕获异常） */
      }
    }

    try {
      // B1：include 过滤（用户勾选的注入段）
      const include = req.query.include
        ? String(req.query.include)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined
      const ctx = buildChapterWriteContext(db, novelId.data, chapterId.data, { include })
      send('context', { frozenHash: ctx.frozenHash, budgetUsed: ctx.budgetUsed, budgetLimit: ctx.budgetLimit })

      const result = await generateChapter(db, novelId.data, chapterId.data, {
        signal: abort.signal,
        onDelta: (text) => send('delta', { text }),
        onThinking: (text) => send('thinking', { delta: text }),
        include,
        guidance: genInput.data.guidance // P19 ①：单次引导
      })

      if (result.aborted) {
        send('aborted', { content: result.content, wordCount: result.wordCount })
      } else {
        send('done', {
          content: result.content,
          wordCount: result.wordCount,
          usage: result.usage
        })
      }
      res.end()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      db.prepare("UPDATE chapter SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(chapterId.data)
      send('error', { message })
      res.end()
    }
  })

  // ---------- 审核 ----------
  router.post('/:novelId/chapters/:chapterId/review', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const chapter = db
        .prepare('SELECT content, goal_json FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { content: string; goal_json: string } | undefined
      if (!chapter || !chapter.content) {
        res.status(400).json({ error: '章节无正文，先生成再审核' })
        return
      }
      // P19 ③：场景数下限校验（<3 场景 → 追加 high 级问题 + 质量债，参考项目 #103 同类）
      const goal = JSON.parse(chapter.goal_json || '{}') as { scenes?: unknown }
      const sceneCount = Array.isArray(goal.scenes) ? goal.scenes.length : 0
      const review = await performReview(novelId, chapterId, chapter.content)
      if (sceneCount > 0 && sceneCount < 3) {
        review.issues.push({
          severity: 'high',
          location: '全章结构',
          problem: `场景数不足（${sceneCount} 个 < 3），节奏拖沓或信息密度低`,
          suggestion: '拆分为至少 3 个场景：起（引入）→ 承（冲突推进）→ 转合（结果与钩子），或在现有场景内补充目标冲突'
        })
        review.needsFix = true
        db.prepare('INSERT INTO quality_debt (chapter_id, issue, severity) VALUES (?, ?, ?)').run(
          chapterId,
          `全章结构 场景数不足（${sceneCount}）`,
          'high'
        )
        db.prepare(
          "UPDATE chapter SET review_json = ?, status = 'reviewed', updated_at = datetime('now') WHERE id = ?"
        ).run(JSON.stringify(review), chapterId)
      }
      res.json({ review })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 修复（patch_first，限 2 轮） ----------
  router.post('/:novelId/chapters/:chapterId/fix', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const chapter = db
        .prepare('SELECT content, review_json, fix_history_json FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as
        | { content: string; review_json: string; fix_history_json: string }
        | undefined
      if (!chapter) {
        res.status(404).json({ error: 'chapter not found' })
        return
      }
      const review = JSON.parse(chapter.review_json || '{}') as {
        issues?: Array<{ severity: string; problem: string; suggestion: string }>
      }
      const fixHistory = JSON.parse(chapter.fix_history_json || '[]') as Array<{ round: number; issues: number; signature?: string }>
      if (fixHistory.length >= 2) {
        // P12 C1：轮数上限 → 登记质量债（不再自动重写）
        const issues = review.issues ?? []
        const sig = issues.slice(0, 3).map((i) => String(i.problem ?? '').slice(0, 30)).join('|')
        db.prepare(
          "INSERT INTO quality_debt (chapter_id, issue, severity, resolved) VALUES (?, ?, 'high', 0)"
        ).run(chapterId, `修复 2 轮未达标，建议人工修改或重规划。${sig ? `签名：${sig}` : ''}`)
        res.status(400).json({ error: '已修复 2 轮，超过上限，已登记质量债，建议人工修改或重规划' })
        return
      }
      const issues = review.issues ?? []
      // P12 C1：同签名防重复烧 LLM（上一轮同问题 → 直接登记债务）
      const sig = issues.slice(0, 3).map((i) => String(i.problem ?? '').slice(0, 30)).join('|')
      if (sig && fixHistory.length > 0 && fixHistory[fixHistory.length - 1]?.signature === sig) {
        db.prepare(
          "INSERT INTO quality_debt (chapter_id, issue, severity, resolved) VALUES (?, ?, 'high', 0)"
        ).run(chapterId, `同类问题修复后仍存在（签名：${sig}），登记质量债，建议人工修改或窗口重规划`)
        res.status(400).json({ error: '同类问题上一轮已修复但仍存在，已登记质量债，建议人工修改或重规划（避免重复消耗）' })
        return
      }
      const messages = buildFixContext(db, novelId, chapterId, chapter.content, issues)
      const fixed = await callLlmJson<{ content: string }>(
        db,
        'extraction',
        {
          novelId,
          messages,
          maxTokens: 8192
        },
        (obj) => {
          const r = obj as Record<string, unknown>
          if (typeof r.content === 'string' && r.content.length > 100) return { content: r.content }
          return null
        },
        'fix'
      )
      fixHistory.push({ round: fixHistory.length + 1, issues: issues.length, signature: sig })
      db.prepare(
        "UPDATE chapter SET content = ?, fix_history_json = ?, word_count = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(fixed.content, JSON.stringify(fixHistory), (fixed.content.match(/[\u4e00-\u9fff]/g) ?? []).length, chapterId)

      // 重审闭环（P1.5）：修复后自动重审，score≥75 或达轮数上限停止
      const rescore = await performReview(novelId, chapterId, fixed.content)
      const passed = rescore.score >= 75
      // P20（C7）：达标 → 该章未解决的债务标记 resolved（质量债可消费闭环）
      if (passed) {
        db.prepare(
          "UPDATE quality_debt SET resolved = 1, updated_at = datetime('now') WHERE chapter_id = ? AND resolved = 0"
        ).run(chapterId)
      }
      res.json({
        fixed: true,
        round: fixHistory.length,
        content: fixed.content,
        rescore: { score: rescore.score, needsFix: rescore.needsFix, passed }
      })
    } catch (err) {
      next(err)
    }
  })

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
      .prepare('SELECT id, content, chapter_id FROM fact WHERE novel_id = ? AND confirmed = 0')
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
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // ---------- A3 版本历史 ----------
  router.get('/:novelId/chapters/:chapterId/versions', (req, res) => {
    const chapterId = Number(req.params.chapterId)
    const novelId = Number(req.params.novelId)
    const exists = db
      .prepare('SELECT id FROM chapter WHERE id = ? AND novel_id = ?')
      .get(chapterId, novelId) as { id: number } | undefined
    if (!exists) {
      res.status(404).json({ error: 'chapter not found' })
      return
    }
    const rows = db
      .prepare(
        'SELECT id, content, note, created_at FROM chapter_version WHERE chapter_id = ? ORDER BY id DESC LIMIT 30'
      )
      .all(chapterId) as Array<{ id: number; content: string; note: string; created_at: string }>
    res.json({
      versions: rows.map((r) => ({
        id: r.id,
        note: r.note,
        createdAt: r.created_at,
        wordCount: (r.content.match(/[\u4e00-\u9fff]/g) ?? []).length,
        preview: r.content.slice(0, 80)
      }))
    })
  })

  router.post('/:novelId/chapters/:chapterId/versions', (req, res, next) => {
    try {
      const chapterId = Number(req.params.chapterId)
      const novelId = Number(req.params.novelId)
      const input = z.object({ note: z.string().optional().default('手动快照') }).parse(req.body)
      const chapter = db
        .prepare('SELECT content FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { content: string } | undefined
      if (!chapter) {
        res.status(404).json({ error: 'chapter not found' })
        return
      }
      const result = db
        .prepare('INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, ?)')
        .run(chapterId, chapter.content, input.note)
      res.status(201).json({ versionId: Number(result.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // ---------- P20（U1）：版本详情 / 恢复 ----------
  router.get('/:novelId/chapters/:chapterId/versions/:versionId', (req, res, next) => {
    try {
      const chapterId = Number(req.params.chapterId)
      const versionId = Number(req.params.versionId)
      const row = db
        .prepare('SELECT id, content, note, created_at FROM chapter_version WHERE id = ? AND chapter_id = ?')
        .get(versionId, chapterId) as { id: number; content: string; note: string; created_at: string } | undefined
      if (!row) {
        res.status(404).json({ error: 'version not found' })
        return
      }
      res.json({ version: row })
    } catch (err) {
      next(err)
    }
  })

  router.post('/:novelId/chapters/:chapterId/versions/:versionId/restore', (req, res, next) => {
    try {
      const chapterId = Number(req.params.chapterId)
      const novelId = Number(req.params.novelId)
      const versionId = Number(req.params.versionId)
      const row = db
        .prepare('SELECT content FROM chapter_version WHERE id = ? AND chapter_id = ?')
        .get(versionId, chapterId) as { content: string } | undefined
      if (!row) {
        res.status(404).json({ error: 'version not found' })
        return
      }
      // 当前内容先存为新版本（不丢改动），再替换
      const current = db
        .prepare('SELECT content, title FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { content: string; title: string } | undefined
      if (current && current.content.trim()) {
        db.prepare("INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, '恢复前快照')").run(
          chapterId,
          current.content
        )
      }
      db.prepare(
        "UPDATE chapter SET content = ?, word_count = ?, updated_at = datetime('now') WHERE id = ? AND novel_id = ?"
      ).run(row.content, (row.content.match(/[\u4e00-\u9fff]/g) ?? []).length, chapterId, novelId)
      res.json({ content: row.content, wordCount: (row.content.match(/[\u4e00-\u9fff]/g) ?? []).length })
    } catch (err) {
      next(err)
    }
  })

  // ---------- A1 选区 AI 操作（modify/insert/append） ----------
  router.post('/:novelId/chapters/:chapterId/ai-action', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const input = z
        .object({
          action: z.enum([...Object.keys(AI_ACTIONS), ...Object.keys(AI_INSERT_ACTIONS)] as [
            string,
            ...string[]
          ]),
          selection: z.string().optional().default(''),
          instruction: z.string().optional().default(''),
          cursorPosition: z.number().int().optional()
        })
        .parse(req.body)

      const chapter = db
        .prepare('SELECT title, content FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { title: string; content: string } | undefined
      if (!chapter) {
        res.status(404).json({ error: 'chapter not found' })
        return
      }

      const bound = getBoundStyleRules(db, novelId)
      const styleRules = bound ? [...bound.rules, ...bound.antiAiRules].join('\n') : ''
      const isInsert = input.action in AI_INSERT_ACTIONS
      const actionMeta = isInsert ? AI_INSERT_ACTIONS[input.action] : AI_ACTIONS[input.action]
      const selection = input.selection || ''
      const instruction = input.instruction ? `\n补充要求：${input.instruction}` : ''
      const styleBlock = styleRules ? `\n【本书写法规则（文风对齐时遵守）】\n${styleRules}` : ''

      let content = ''
      if (isInsert) {
        // insert/continue：给出选区上下文 + 光标前后文，插入到选区位置或文末
        const before = chapter.content.slice(0, input.cursorPosition ?? chapter.content.length)
        const after = chapter.content.slice(input.cursorPosition ?? chapter.content.length)
        content = `${actionMeta.prompt}${instruction}${styleBlock}\n\n【上文】\n${before.slice(-2000)}\n\n【下文（若有）】\n${after.slice(0, 500)}`
      } else {
        // modify：改写选中文字
        content = `${actionMeta.prompt}${instruction}${styleBlock}\n\n【选中文字】\n${selection}`
      }

      const result = await callLlmJson<{ content: string }>(
        db,
        'extraction',
        {
          novelId,
          messages: [
            {
              role: 'user',
              content: `${content}\n\n输出 JSON：{"content": "改写/生成的文字（只输出替换内容，不含任何解释）"}`
            }
          ],
          maxTokens: 4096
        },
        (obj) => {
          const r = obj as Record<string, unknown>
          return typeof r.content === 'string' && r.content.length > 0 ? { content: r.content } : null
        },
        `ai-action-${input.action}`
      )

      res.json({
        action: input.action,
        isInsert,
        content: result.content,
        appliedAt: input.cursorPosition ?? (isInsert ? chapter.content.length : undefined)
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}
