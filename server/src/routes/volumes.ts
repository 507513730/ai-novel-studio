import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { callLlmJson } from '../services/jsonSafe'
import { JSON_FORMAT } from '../prompts'
// v0.23.1（批次 B1）：卷/节拍/章节清单 prompt+解析收敛 planner（此前三处内联副本，
// 节拍 prompt 缺 genreTemplate、章节清单缺 prevVolumeHook——功能漂移已实际发生）
// v0.23.1（批次 D2）：refineOne 迁 planner（单章端点与批量 job 队列共用）
import {
  refineOne,
  generateVolumesPrompt,
  parseVolumes,
  generateBeatsPrompt,
  parseBeats,
  generateChaptersPrompt,
  parseChaptersPlan,
  getGenreTemplate,
  getPrevVolumeHook
} from '../services/planner'
import { enqueueTypedJob } from '../services/jobQueue'

export function createVolumesRouter(db: DatabaseSync): Router {
  const router = Router()

  // ---------- volumes ----------
  router.get('/:novelId/volumes', (req, res) => {
    const novelId = Number(req.params.novelId)
    const rows = db
      .prepare(
        'SELECT id, title, strategy_json, skeleton_json, order_index FROM volume WHERE novel_id = ? ORDER BY order_index'
      )
      .all(novelId) as Array<Record<string, unknown>>
    res.json({
      volumes: rows.map((r) => ({
        id: r.id,
        title: r.title,
        orderIndex: r.order_index,
        strategy: JSON.parse(String(r.strategy_json ?? '{}')),
        skeleton: JSON.parse(String(r.skeleton_json ?? '{}'))
      }))
    })
  })

  router.post('/:novelId/volumes', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z.object({ title: z.string().min(1) }).parse(req.body)
      const maxOrder = db
        .prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM volume WHERE novel_id = ?')
        .get(novelId) as { m: number }
      const result = db
        .prepare('INSERT INTO volume (novel_id, title, order_index) VALUES (?, ?, ?)')
        .run(novelId, input.title, maxOrder.m + 1)
      res.status(201).json({ id: Number(result.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:novelId/volumes/:volId', (req, res) => {
    // v0.17.0（LOW）：存在性检查（此前无检查恒返 ok:true）
    const vol = db
      .prepare('SELECT id FROM volume WHERE id = ? AND novel_id = ?')
      .get(Number(req.params.volId), Number(req.params.novelId))
    if (!vol) {
      res.status(404).json({ error: '卷不存在' })
      return
    }
    db.prepare('DELETE FROM volume WHERE id = ? AND novel_id = ?').run(
      Number(req.params.volId),
      Number(req.params.novelId)
    )
    res.json({ ok: true })
  })

  // P13 G4：卷战略评审（单轮 LLM：评分/风险/建议，写入 strategy_json.critique；失败静默降级）
  router.post('/:novelId/volumes/:volId/critique', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const volId = Number(req.params.volId)
      const vol = db
        .prepare('SELECT title, strategy_json FROM volume WHERE id = ? AND novel_id = ?')
        .get(volId, novelId) as { title: string; strategy_json: string } | undefined
      if (!vol) {
        res.status(404).json({ error: '卷不存在' })
        return
      }
      const novel = db.prepare('SELECT framing_json, title FROM novel WHERE id = ?').get(novelId) as
        | { framing_json: string; title: string }
        | undefined
      const critique = await callLlmJson<{ score: number; risks: string[]; suggestion: string }>(
        db,
        'extraction',
        {
          novelId,
          messages: [
            {
              role: 'user',
              content: `你是卷战略评审编辑。评审以下卷战略是否符合整本书的框架与网文节奏。\n${JSON_FORMAT}\n\n书名：${novel?.title ?? ''}\n书级合约：${novel?.framing_json ?? ''}\n卷：${vol.title}\n卷战略：${vol.strategy_json}\n\n请输出 {"score": 0-100, "risks": ["风险1","风险2"], "suggestion": "改进建议（100字内）"}`
            }
          ],
          maxTokens: 1024
        },
        (obj) => {
          const r = obj as Record<string, unknown>
          if (typeof r.score !== 'number') return null
          return {
            score: Math.min(100, Math.max(0, r.score)),
            risks: Array.isArray(r.risks) ? r.risks.map(String) : [],
            suggestion: String(r.suggestion ?? '')
          }
        },
        'volumes-critique'
      )
      const strategy = JSON.parse(vol.strategy_json || '{}') as Record<string, unknown>
      strategy.critique = critique
      db.prepare("UPDATE volume SET strategy_json = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(strategy),
        volId
      )
      res.json({ critique })
    } catch (err) {
      next(err)
    }
  })

  // AI 生成整本卷规划（含每卷章数，用户可改）
  router.post('/:novelId/volumes/generate', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({ chaptersPerVolume: z.number().int().min(5).max(40).default(20), guidance: z.string().max(1000).optional() })
        .parse(req.body)
      const novel = db.prepare('SELECT framing_json, title FROM novel WHERE id = ?').get(novelId) as
        | { framing_json: string; title: string }
        | undefined
      const characters = db
        .prepare("SELECT name, profile_json FROM character WHERE novel_id = ? AND status = 'roster' LIMIT 12")
        .all(novelId) as Array<{ name: string; profile_json: string }>
      const volumePlan = await callLlmJson<
        Array<{ title: string; theme: string; coreConflict: string; keyEvents: string[]; endingHook: string }>
      >(
        db,
        'extraction',
        {
          novelId,
          guidance: input.guidance,
          messages: [
            {
              role: 'user',
              content: generateVolumesPrompt(
                novel?.title ?? '',
                novel?.framing_json ?? '',
                characters
                  .map((c) => {
                    const profile = JSON.parse(c.profile_json) as { identity?: string }
                    return `${c.name}：${profile.identity ?? ''}`
                  })
                  .join('；'),
                input.chaptersPerVolume
              )
            }
          ],
          maxTokens: 4096
        },
        parseVolumes,
        'volumes'
      )

      db.exec('BEGIN')
      try {
        for (let i = 0; i < volumePlan.length; i++) {
          const v = volumePlan[i]
          db.prepare(
            'INSERT INTO volume (novel_id, title, strategy_json, skeleton_json, order_index) VALUES (?, ?, ?, ?, ?)'
          ).run(
            novelId,

            v.title,
            JSON.stringify({
              theme: v.theme,
              coreConflict: v.coreConflict,
              chaptersPerVolume: input.chaptersPerVolume
            }),
            JSON.stringify({ keyEvents: v.keyEvents, endingHook: v.endingHook }),
            i
          )
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      res.json({ volumes: volumePlan, chaptersPerVolume: input.chaptersPerVolume })
    } catch (err) {
      next(err)
    }
  })

  // ---------- beats ----------
  router.get('/:novelId/volumes/:volId/beats', (req, res) => {
    const volId = Number(req.params.volId)
    const rows = db
      .prepare('SELECT id, title, summary, order_index FROM beat WHERE volume_id = ? ORDER BY order_index')
      .all(volId) as Array<Record<string, unknown>>
    res.json({
      beats: rows.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        orderIndex: r.order_index
      }))
    })
  })

  // AI 生成卷内节奏板
  router.post('/:novelId/volumes/:volId/beats/generate', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const volId = Number(req.params.volId)
      const volume = db
        .prepare('SELECT title, strategy_json, skeleton_json FROM volume WHERE id = ?')
        .get(volId) as
        | { title: string; strategy_json: string; skeleton_json: string }
        | undefined
      if (!volume) {
        res.status(404).json({ error: 'volume not found' })
        return
      }
      const strategy = JSON.parse(volume.strategy_json) as { chaptersPerVolume: number }
      // v0.23.1（批次 B1）：节拍 prompt 走 planner 超集——手动路由此前缺流派模板注入（漂移修复）
      const beats = await callLlmJson<
        Array<{ title: string; purpose: string; emotionCurve: string; scenes: string[] }>
      >(
        db,
        'extraction',
        {
          novelId,
          guidance: (req.body as { guidance?: string } | undefined)?.guidance,
          messages: [
            {
              role: 'user',
              content: generateBeatsPrompt(
                volume.title,
                volume.strategy_json,
                volume.skeleton_json,
                strategy.chaptersPerVolume ?? 20,
                getGenreTemplate(db, novelId)
              )
            }
          ],
          maxTokens: 4096
        },
        parseBeats,
        'beats'
      )
      db.exec('BEGIN')
      try {
        for (let i = 0; i < beats.length; i++) {
          db.prepare('INSERT INTO beat (volume_id, title, summary, order_index) VALUES (?, ?, ?, ?)').run(
            volId,
            beats[i].title,
            JSON.stringify({
              purpose: beats[i].purpose,
              emotionCurve: beats[i].emotionCurve,
              scenes: beats[i].scenes
            }),
            i
          )
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      res.json({ beats })
    } catch (err) {
      next(err)
    }
  })

  // ---------- chapters (planning) ----------
  router.get('/:novelId/chapters', (req, res) => {
    const novelId = Number(req.params.novelId)
    const rows = db
      .prepare(
        `SELECT c.id, c.title, c.summary, c.goal_json, c.status, c.word_count,
                c.ai_words, c.human_words,
                c.volume_id, c.beat_id, v.title AS volume_title, b.title AS beat_title
         FROM chapter c
         LEFT JOIN volume v ON v.id = c.volume_id
         LEFT JOIN beat b ON b.id = c.beat_id
         WHERE c.novel_id = ? ORDER BY c.id`
      )
      .all(novelId) as Array<Record<string, unknown>>
    res.json({
      chapters: rows.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        goal: JSON.parse(String(r.goal_json ?? '{}')),
        status: r.status,
        wordCount: r.word_count,
        // v0.19.0：字数分离（人类/AI 累计）
        aiWords: Number(r.ai_words ?? 0),
        humanWords: Number(r.human_words ?? 0),
        volumeId: r.volume_id,
        beatId: r.beat_id,
        volumeTitle: r.volume_title,
        beatTitle: r.beat_title
      }))
    })
  })

  // ---------- chapter detail（P9 A1：正文按需加载，列表不携带 content） ----------
  router.get('/:novelId/chapters/:chapterId', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const row = db
        .prepare(
          `SELECT c.id, c.title, c.summary, c.goal_json, c.status, c.word_count, c.ai_words, c.human_words, c.content
           FROM chapter c WHERE c.id = ? AND c.novel_id = ?`
        )
        .get(chapterId, novelId) as
        | { id: number; title: string; summary: string | null; goal_json: string; status: string; word_count: number; ai_words: number; human_words: number; content: string }
        | undefined
      if (!row) {
        res.status(404).json({ error: '章节不存在' })
        return
      }
      res.json({
        chapter: {
          id: row.id,
          title: row.title,
          summary: row.summary,
          goal: JSON.parse(String(row.goal_json ?? '{}')),
          status: row.status,
          wordCount: row.word_count,
          // v0.19.0：字数分离（人类/AI 累计）
          aiWords: Number(row.ai_words ?? 0),
          humanWords: Number(row.human_words ?? 0),
          content: row.content ?? ''
        }
      })
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:novelId/chapters/:chapterId', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const input = z
        .object({
          title: z.string().min(1).optional(),
          summary: z.string().optional(),
          goal: z.unknown().optional(),
          // v0.9.0（审查 #19）：章节状态机枚举校验
          // v0.17.0（审查 M13）：移除 'generating'——内部态不允许客户端手动置（防卡死状态机）
          status: z
            .enum(['planned', 'imported', 'written', 'reviewed', 'done', 'failed'])
            .optional(),
          content: z.string().optional(),
          // v0.19.0：人类/AI 字数分离——编辑器按来源累计，保存时上报增量
          aiWordsDelta: z.number().int().nonnegative().optional(),
          humanWordsDelta: z.number().int().nonnegative().optional()
        })
        .parse(req.body)
      const sets: string[] = []
      const params: Array<string | number> = []
      if (input.title !== undefined) {
        sets.push('title = ?')
        params.push(input.title)
      }
      if (input.summary !== undefined) {
        sets.push('summary = ?')
        params.push(input.summary)
      }
      if (input.goal !== undefined) {
        sets.push('goal_json = ?')
        params.push(JSON.stringify(input.goal))
      }
      if (input.status !== undefined) {
        sets.push('status = ?')
        params.push(input.status)
      }
      if (input.content !== undefined) {
        // v0.17.0（审查 M13）：空内容保护——拒绝用空串覆盖正文（避免误清空）
        if (input.content.trim() === '') {
          res.status(400).json({ error: 'content 不能为空（如需清空请删除章节）' })
          return
        }
        sets.push('content = ?')
        params.push(input.content)
        sets.push('word_count = ?')
        params.push((input.content.match(/[\u4e00-\u9fff]/g) ?? []).length)
      }
      // v0.19.0：字数分离增量累计（仅累加，不覆盖）
      if (input.aiWordsDelta !== undefined && input.aiWordsDelta > 0) {
        sets.push('ai_words = ai_words + ?')
        params.push(input.aiWordsDelta)
      }
      if (input.humanWordsDelta !== undefined && input.humanWordsDelta > 0) {
        sets.push('human_words = human_words + ?')
        params.push(input.humanWordsDelta)
      }
      sets.push("updated_at = datetime('now')")
      db.prepare(`UPDATE chapter SET ${sets.join(', ')} WHERE id = ? AND novel_id = ?`).run(
        ...params,
        chapterId,
        novelId
      )
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // AI 为卷生成章节清单（章节名多样，修正 #6）
  router.post('/:novelId/volumes/:volId/chapters/generate', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const volId = Number(req.params.volId)
      const volume = db
        .prepare('SELECT title, strategy_json, skeleton_json FROM volume WHERE id = ?')
        .get(volId) as
        | { title: string; strategy_json: string; skeleton_json: string }
        | undefined
      if (!volume) {
        res.status(404).json({ error: 'volume not found' })
        return
      }
      // P13 G5：节拍板门禁（无节奏板不拆章）
      const beatCount = (db.prepare('SELECT COUNT(*) AS c FROM beat WHERE volume_id = ?').get(volId) as { c: number }).c
      if (beatCount === 0) {
        res.status(400).json({ error: '请先生成该卷节奏板（节拍板是拆章的依据）' })
        return
      }
      const strategy = JSON.parse(volume.strategy_json) as { chaptersPerVolume: number }
      const count = strategy.chaptersPerVolume ?? 20
      const beats = db
        .prepare('SELECT id, title, summary FROM beat WHERE volume_id = ? ORDER BY order_index')
        .all(volId) as Array<{ id: number; title: string; summary: string }>

      const chapterPlan = await callLlmJson<
        Array<{ title: string; summary: string; goal: string; beatId: number | null }>
      >(
        db,
        'extraction',
        {
          novelId,
          guidance: (req.body as { guidance?: string } | undefined)?.guidance,
          messages: [
            {
              role: 'user',
              // v0.23.1（批次 B1）：章节清单 prompt/解析走 planner 超集——
              // 手动路由此前缺上一卷结尾钩子注入（漂移修复），解析器双份合一
              content: generateChaptersPrompt(
                volume.title,
                volume.strategy_json,
                JSON.stringify(beats),
                count,
                { skeletonJson: volume.skeleton_json, prevVolumeHook: getPrevVolumeHook(db, novelId, volId) }
              )
            }
          ],
          maxTokens: 8192
        },
        (obj) => parseChaptersPlan(obj, beats),
        'chapters-plan'
      )

      db.exec('BEGIN')
      try {
        for (const cp of chapterPlan) {
          db.prepare(
            'INSERT INTO chapter (novel_id, volume_id, beat_id, title, summary, goal_json, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(novelId, volId, cp.beatId, cp.title, cp.summary, JSON.stringify({ goal: cp.goal }), 'planned')
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      res.json({ chapters: chapterPlan })
    } catch (err) {
      next(err)
    }
  })

  // 单章细化（目标/场景）
  router.post('/:novelId/chapters/:chapterId/refine', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const chapter = db
        .prepare('SELECT title, summary, goal_json FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { title: string; summary: string; goal_json: string } | undefined
      if (!chapter) {
        res.status(404).json({ error: 'chapter not found' })
        return
      }
      const refined = await refineOne(db, chapterId, chapter)
      res.json({ goal: refined })
    } catch (err) {
      next(err)
    }
  })

  // P12 A4：批量细化（范围 [from,to]，幂等续跑：已细化的章节跳过）
  // v0.23.1（批次 D2/#8/#23）：迁 job 队列——此前在 HTTP 请求内循环逐章调 LLM
  // （40 章 × 2048 token 可挂数分钟：长连接挂死风险 + 无取消/无进度）
  router.post('/:novelId/chapters/refine-range', (req, res) => {
    const novelId = Number(req.params.novelId)
    const parsed = z
      .object({
        from: z.number().int().positive(),
        to: z.number().int().positive()
      })
      .safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request body' })
      return
    }
    if (parsed.data.to < parsed.data.from) {
      res.status(400).json({ error: 'to 必须 ≥ from' })
      return
    }
    const enq = enqueueTypedJob(db, 'refine-range', {
      novelId,
      from: parsed.data.from,
      to: parsed.data.to
    })
    if ('conflict' in enq) {
      res.status(409).json({ error: '已有批量细化任务在队列中/执行中' })
      return
    }
    res.status(202).json({ jobId: enq.jobId })
  })

  return router
}
