import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { callLlmJson } from '../services/jsonSafe'
import { JSON_FORMAT, CHAPTER_TITLE_RULE } from '../prompts'
import { getSystemPrompt } from '../prompts/promptAsset'

// P12 A4：单章细化（单章端点与批量端点共用；质量门禁：关键字段非空）
async function refineOne(
  db: DatabaseSync,
  chapterId: number,
  chapter: { title: string; summary: string; goal_json: string }
): Promise<Record<string, unknown>> {
  const novelId = (db.prepare('SELECT novel_id FROM chapter WHERE id = ?').get(chapterId) as { novel_id: number })
    .novel_id
  const refined = await callLlmJson<Record<string, unknown>>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: `你是章节细化师。请细化本章任务单：${CHAPTER_TITLE_RULE}\n${JSON_FORMAT}\n\n章节：${chapter.title}\n摘要：${chapter.summary}\n初步目标：${chapter.goal_json}\n\n请输出 {"purpose": "本章推进目的（非空）", "boundary": "本章边界（非空）", "tasks": ["任务1","任务2"], "scenes": ["场景1","场景2"], "ending": "结尾钩子（非空）"}`
        }
      ],
      maxTokens: 2048
    },
    (obj) => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
      const r = obj as Record<string, unknown>
      if (typeof r.purpose !== 'string' || r.purpose.trim().length < 4) return null
      if (typeof r.boundary !== 'string' || r.boundary.trim().length < 4) return null
      if (typeof r.ending !== 'string' || r.ending.trim().length < 4) return null
      if (!Array.isArray(r.tasks) || r.tasks.length === 0) return null
      if (!Array.isArray(r.scenes) || r.scenes.length === 0) return null
      return {
        purpose: String(r.purpose),
        boundary: String(r.boundary),
        tasks: r.tasks.map(String),
        scenes: r.scenes.map(String),
        ending: String(r.ending)
      }
    },
    'refine'
  )
  db.prepare("UPDATE chapter SET goal_json = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(refined),
    chapterId
  )
  return refined
}

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
              content: `${getSystemPrompt('volumes')}\n${JSON_FORMAT}\n\n书名：${novel?.title ?? ''}\n书级合约：${novel?.framing_json ?? ''}\n角色：${characters
                .map((c) => {
                  const profile = JSON.parse(c.profile_json) as { identity?: string }
                  return `${c.name}：${profile.identity ?? ''}`
                })
                .join('；')}\n每卷 ${input.chaptersPerVolume} 章，全书 3-5 卷。\n\n请输出 {"volumes": [{"title","theme","coreConflict","keyEvents":[],"endingHook"}]}`
            }
          ],
          maxTokens: 4096
        },
        (obj) => {
          const arr = (obj as { volumes?: unknown }).volumes
          if (!Array.isArray(arr) || arr.length === 0) return null
          const out: Array<{
            title: string
            theme: string
            coreConflict: string
            keyEvents: string[]
            endingHook: string
          }> = []
          for (const v of arr) {
            const r = v as Record<string, unknown>
            if (!r.title) return null
            out.push({
              title: String(r.title),
              theme: String(r.theme ?? ''),
              coreConflict: String(r.coreConflict ?? ''),
              keyEvents: Array.isArray(r.keyEvents) ? r.keyEvents.map(String) : [],
              endingHook: String(r.endingHook ?? '')
            })
          }
          return out
        },
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
              content: `${getSystemPrompt('beats')}\n${JSON_FORMAT}\n\n卷名：${volume.title}\n卷战略：${volume.strategy_json}\n卷骨架：${volume.skeleton_json}\n卷内 ${strategy.chaptersPerVolume ?? 20} 章。\n\n请输出 {"beats": [{"title","purpose","emotionCurve","scenes":[]}]}，6-12 个 beat。`
            }
          ],
          maxTokens: 4096
        },
        (obj) => {
          const arr = (obj as { beats?: unknown }).beats
          if (!Array.isArray(arr) || arr.length === 0) return null
          const out: Array<{ title: string; purpose: string; emotionCurve: string; scenes: string[] }> = []
          for (const b of arr) {
            const r = b as Record<string, unknown>
            if (!r.title) return null
            out.push({
              title: String(r.title),
              purpose: String(r.purpose ?? ''),
              emotionCurve: String(r.emotionCurve ?? ''),
              scenes: Array.isArray(r.scenes) ? r.scenes.map(String) : []
            })
          }
          return out
        },
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
          `SELECT c.id, c.title, c.summary, c.goal_json, c.status, c.word_count, c.content
           FROM chapter c WHERE c.id = ? AND c.novel_id = ?`
        )
        .get(chapterId, novelId) as
        | { id: number; title: string; summary: string | null; goal_json: string; status: string; word_count: number; content: string }
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
          status: z
            .enum(['planned', 'imported', 'generating', 'written', 'reviewed', 'done', 'failed'])
            .optional(),
          content: z.string().optional()
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
        sets.push('content = ?')
        params.push(input.content)
        sets.push('word_count = ?')
        params.push((input.content.match(/[\u4e00-\u9fff]/g) ?? []).length)
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
              content: `${getSystemPrompt('chapters')}\n${JSON_FORMAT}\n${CHAPTER_TITLE_RULE}\n\n卷名：${volume.title}\n卷战略：${volume.strategy_json}\n卷骨架：${volume.skeleton_json}\n节奏板：${JSON.stringify(beats)}\n本章节数：${count}。\n\n请输出 {"chapters": [{"title","summary","goal"}]}，正好 ${count} 章，按节奏板顺序分配 beat（字段可加 "beatIndex"）。`
            }
          ],
          maxTokens: 8192
        },
        (obj) => {
          const arr = (obj as { chapters?: unknown }).chapters
          if (!Array.isArray(arr) || arr.length === 0) return null
          const out: Array<{ title: string; summary: string; goal: string; beatId: number | null }> = []
          for (const c of arr) {
            const r = c as Record<string, unknown>
            if (!r.title) return null
            const beatIndex = Number(r.beatIndex ?? -1)
            out.push({
              title: String(r.title),
              summary: String(r.summary ?? ''),
              goal: String(r.goal ?? ''),
              beatId: beatIndex >= 0 && beats[beatIndex] ? beats[beatIndex].id : null
            })
          }
          return out
        },
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
  router.post('/:novelId/chapters/refine-range', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({
          from: z.number().int().positive(),
          to: z.number().int().positive()
        })
        .parse(req.body)
      if (input.to < input.from) {
        res.status(400).json({ error: 'to 必须 ≥ from' })
        return
      }
      const rows = db
        .prepare(
          `SELECT id, title, summary, goal_json FROM chapter
           WHERE novel_id = ? AND id BETWEEN ? AND ?
           ORDER BY id`
        )
        .all(novelId, input.from, input.to) as Array<{ id: number; title: string; summary: string; goal_json: string }>
      const done: number[] = []
      const skipped: number[] = []
      for (const row of rows) {
        // 幂等判定：goal_json 已有完整任务单（purpose 非空）则跳过
        const g = JSON.parse(String(row.goal_json ?? '{}')) as Record<string, unknown>
        if (typeof g.purpose === 'string' && g.purpose.trim().length >= 4) {
          skipped.push(row.id)
          continue
        }
        await refineOne(db, row.id, { title: row.title, summary: row.summary, goal_json: row.goal_json })
        done.push(row.id)
      }
      res.json({ done, skipped })
    } catch (err) {
      next(err)
    }
  })

  return router
}
