import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { generateSettingBrief } from '../services/settingBrief'
import { callLlmJson } from '../services/jsonSafe'
import { JSON_FORMAT } from '../prompts'
import { getSystemPrompt } from '../prompts/promptAsset'

interface DirectionScheme {
  title: string
  sellingPoint: string
  genre: string
  coreSetting: string
  mainline: string
  first30: string
  readerFeeling: string
}

// v0.17.0（审查 M7）：解析统一使用 planner.ts（此前本地副本与 planner 漂移：≥1 vs ≥2）
// 类型适配：planner 返回 scheme 为 Record，按 DirectionScheme 消费
import { parseDirections as plannerParseDirections } from '../services/planner'
const parseDirections = plannerParseDirections as unknown as (
  obj: unknown
) => Array<{ id: string; scheme: DirectionScheme }> | null

function parseTitles(obj: unknown): string[] | null {
  if (!obj || typeof obj !== 'object') return null
  const arr = (obj as { titles?: unknown }).titles
  if (!Array.isArray(arr) || arr.length === 0) return null
  const titles = arr.map((t) => String((t as { title?: unknown }).title ?? '')).filter(Boolean)
  return titles.length > 0 ? titles : null
}

export // v0.17.0（LOW）：安全 JSON 解析（损坏数据兜底返回默认形状）
function safeParseJson(v: unknown, fallback: unknown = null): unknown {
  try {
    return JSON.parse(String(v ?? ''))
  } catch {
    return fallback
  }
}

export function createNovelsRouter(db: DatabaseSync): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT n.id, n.title, n.inspiration, n.status, n.framing_json, n.last_opened_at,
                (SELECT COUNT(*) FROM chapter c WHERE c.novel_id = n.id AND c.status IN ('done','reviewed','written')) AS chapters_done,
                (SELECT COUNT(*) FROM chapter c WHERE c.novel_id = n.id) AS chapters_total,
                (SELECT COUNT(*) FROM character ch WHERE ch.novel_id = n.id) AS characters
         FROM novel n WHERE n.id != 0 ORDER BY COALESCE(n.last_opened_at, n.updated_at) DESC`
      )
      .all() as Array<Record<string, unknown>>
    res.json({
      novels: rows.map((r) => ({
        id: r.id,
        title: r.title,
        inspiration: r.inspiration,
        status: r.status,
        chaptersDone: r.chapters_done,
        chaptersTotal: r.chapters_total,
        characters: r.characters,
        // P27 1-3：最近使用
        lastOpenedAt: r.last_opened_at ?? null
      }))
    })
  })

  router.post('/', (req, res, next) => {
    try {
      const input = z.object({ inspiration: z.string().min(1).max(2000) }).parse(req.body)
      const result = db
        .prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)')
        .run(input.inspiration, '未命名小说')
      db.prepare('INSERT INTO world (novel_id) VALUES (?)').run(Number(result.lastInsertRowid))
      res.status(201).json({ id: Number(result.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id)
    // P27 1-3：记录最近打开时间
    db.prepare("UPDATE novel SET last_opened_at = datetime('now') WHERE id = ?").run(id)
    const row = db.prepare('SELECT * FROM novel WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) {
      res.status(404).json({ error: 'novel not found' })
      return
    }
    // P10：各阶段完成度计数（工作台步骤导航状态徽章）
    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM character WHERE novel_id = ?) AS characters,
           (SELECT COUNT(*) FROM volume WHERE novel_id = ?) AS volumes,
           (SELECT COUNT(*) FROM chapter WHERE novel_id = ?) AS chapters,
           (SELECT COUNT(*) FROM book_analysis WHERE novel_id = ?) AS analyses,
           (SELECT COUNT(*) FROM style_asset WHERE novel_id = ?) AS styles,
           (SELECT COUNT(*) FROM agent WHERE enabled = 1) AS agents,
           (SELECT COUNT(*) FROM world WHERE novel_id = ? AND (manual_json != '{}' OR factions_json != '[]' OR map_json != '{}')) AS world_done`
      )
      .get(id, id, id, id, id, id) as Record<string, number>
    res.json({
      novel: {
        id: row.id,
        title: row.title,
        inspiration: row.inspiration,
        status: row.status,
        genre: row.genre,
        // v0.17.0（LOW）：safeParseJson 兜底（损坏 JSON 不炸详情页）
        direction: safeParseJson(row.direction_json),
        titleGroup: safeParseJson(row.title_group_json),
        framing: safeParseJson(row.framing_json),
        guidance: String(row.guidance ?? ''),
        // v0.9.0（审查 #13）：绑定值回传（此前 GET 不回传，UI 无法回显绑定状态）
        currentSolutionId: row.current_solution_id ?? null,
        // v0.15.0：创作约束回传（工作区「创作约束」tab 维护）
        // v0.17.0（LOW）：safeParseJson 兜底（损坏 JSON 不炸详情页）
        constraints: safeParseJson(row.constraints_json),
        charactersCount: counts.characters,
        volumesCount: counts.volumes,
        chaptersCount: counts.chapters,
        analysesCount: counts.analyses,
        stylesCount: counts.styles,
        agentsCount: counts.agents,
        worldDone: counts.world_done > 0
      }
    })
  })

  router.patch('/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z
        .object({
          title: z.string().min(1).optional(),
          // v0.9.0（审查 #19）：状态机枚举校验（此前任意字符串可写坏状态机，章节永不计数/不导出）
          status: z
            .enum(['draft', 'directions', 'framed', 'macro', 'planned', 'producing', 'done'])
            .optional(),
          direction: z.unknown().optional(),
          titleGroup: z.unknown().optional(),
          framing: z.unknown().optional(),
          genre: z.string().optional(),
          guidance: z.string().max(2000).optional(),
          // v0.15.0：创作约束列表（[{id,text,level,enabled,keyword?,replaceWith?}]）
          constraints: z.array(z.unknown()).optional(),
          // P30：书级生产方案绑定（production pipeline 逐章走流水线）
          currentSolutionId: z.number().int().positive().nullable().optional()
        })
        .parse(req.body)
      const sets: string[] = []
      const params: Array<string | number | null> = []
      if (input.title !== undefined) {
        sets.push('title = ?')
        params.push(input.title)
      }
      if (input.status !== undefined) {
        sets.push('status = ?')
        params.push(input.status)
      }
      if (input.direction !== undefined) {
        sets.push('direction_json = ?')
        params.push(JSON.stringify(input.direction))
      }
      if (input.titleGroup !== undefined) {
        sets.push('title_group_json = ?')
        params.push(JSON.stringify(input.titleGroup))
      }
      if (input.framing !== undefined) {
        sets.push('framing_json = ?')
        params.push(JSON.stringify(input.framing))
      }
      if (input.genre !== undefined) {
        sets.push('genre = ?')
        params.push(input.genre)
      }
      if (input.guidance !== undefined) {
        sets.push('guidance = ?')
        params.push(input.guidance)
      }
      if (input.constraints !== undefined) {
        // v0.15.0：约束校验（text 必填、level 枚举）
        for (const c of input.constraints) {
          const item = c as { text?: unknown; level?: unknown }
          if (typeof item.text !== 'string' || item.text.trim() === '') {
            res.status(400).json({ error: 'constraint.text is required' })
            return
          }
          if (item.level !== 'must' && item.level !== 'should') {
            res.status(400).json({ error: "constraint.level must be 'must' or 'should'" })
            return
          }
        }
        sets.push('constraints_json = ?')
        params.push(JSON.stringify(input.constraints))
      }
      if (input.currentSolutionId !== undefined) {
        // v0.9.0（审查 #13）：绑定校验——不存在/已停用的方案静默绑定会让整本生产无提示走默认生成
        if (input.currentSolutionId !== null) {
          const sol = db
            .prepare('SELECT id, enabled FROM solution WHERE id = ?')
            .get(input.currentSolutionId) as { id: number; enabled: number } | undefined
          if (!sol) {
            res.status(404).json({ error: `production solution #${input.currentSolutionId} not found` })
            return
          }
          if (!sol.enabled) {
            res.status(409).json({ error: 'production solution is disabled' })
            return
          }
        }
        sets.push('current_solution_id = ?')
        params.push(input.currentSolutionId)
      }
      if (sets.length === 0) {
        res.json({ ok: true })
        return
      }
      sets.push("updated_at = datetime('now')")
      db.prepare(`UPDATE novel SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // 「帝路十章」写书修复：生成书级设定简报（导演各阶段注入参考设定）
  router.post('/:id/setting-brief', async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const novel = db.prepare('SELECT id FROM novel WHERE id = ?').get(id)
      if (!novel) {
        res.status(404).json({ error: 'novel not found' })
        return
      }
      const brief = await generateSettingBrief(db, id)
      if (!brief) {
        res.status(400).json({ error: '知识库无设定资料（需 ≥100 字），无法生成简报' })
        return
      }
      res.json({ brief })
    } catch (err) {
      next(err)
    }
  })

  // E1：删除小说（级联清所有关联数据）
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id)
    const exists = db.prepare('SELECT id FROM novel WHERE id = ?').get(id) as { id: number } | undefined
    if (!exists) {
      res.status(404).json({ error: 'novel not found' })
      return
    }
    // 外键 CASCADE 会处理 character/chapter/volume/world/foreshadow/fact；job 是独立表需手动清
    // 批1-#6（v0.7.2）：先置 cancelled 不删行——调度器/流水线依赖 job 行感知取消（isJobCancelled），
    // 直接 DELETE 会让运行中的导演/整本生产失去取消感知，继续对已删书逐章烧 LLM 并 FK 失败
    db.prepare(
      `UPDATE job SET status = 'cancelled', updated_at = datetime('now')
       WHERE json_extract(payload_json, '$.novelId') = ? AND status IN ('queued', 'running')`
    ).run(id)
    db.prepare('DELETE FROM novel WHERE id = ?').run(id)
    res.json({ ok: true })
  })

  // 生成 2 套整本方向方案（P13 G6：directionId 定向重做单套）
  router.post('/:id/directions', async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z.object({ directionId: z.string().optional(), guidance: z.string().max(1000).optional() }).parse(req.body ?? {})
      const novel = db.prepare('SELECT inspiration, direction_json FROM novel WHERE id = ?').get(id) as
        | { inspiration: string; direction_json: string }
        | undefined
      if (!novel) {
        res.status(404).json({ error: 'novel not found' })
        return
      }
      const existing = JSON.parse(novel.direction_json || '[]') as Array<{ id: string; scheme: DirectionScheme }>
      const targetIndex = input.directionId ? existing.findIndex((d) => d.id === input.directionId) : -1
      if (input.directionId && targetIndex < 0) {
        res.status(404).json({ error: '方向方案不存在' })
        return
      }
      const contextLine = input.directionId && targetIndex >= 0
        ? `（该方案需保留整体框架，重做其细节：原方案标题「${existing[targetIndex].scheme.title}」）`
        : ''
      const result = await callLlmJson<Array<{ id: string; scheme: DirectionScheme }>>(
        db,
        'extraction',
        {
          novelId: id,
          guidance: input.guidance,
          messages: [
            {
              role: 'user',
              content: `${getSystemPrompt('direction')}\n${JSON_FORMAT}\n\n灵感：${novel.inspiration}${contextLine}\n\n请输出 {"directions": [2 套方案]}，每套含 title/sellingPoint/genre/coreSetting/mainline/first30/readerFeeling。`
            }
          ],
          maxTokens: 4096
        },
        parseDirections,
        'directions'
      )
      let finalDirections = result
      if (input.directionId && targetIndex >= 0) {
        // 定向重做：保留其他方案，替换目标方案（保留原 id 稳定引用）
        const regenerated = result[0]
        finalDirections = existing.map((d, i) => (i === targetIndex ? { id: d.id, scheme: regenerated.scheme } : d))
        // 避免与未重做的方案同标题冲突，允许 LLM 换名
        if (regenerated.scheme.title === existing[targetIndex].scheme.title && result[1]) {
          finalDirections = existing.map((d, i) => (i === targetIndex ? { id: d.id, scheme: result[1].scheme } : d))
        }
      }
      db.prepare(
        "UPDATE novel SET direction_json = ?, status = 'directions', updated_at = datetime('now') WHERE id = ?"
      ).run(JSON.stringify(finalDirections), id)
      res.json({ directions: finalDirections, replaced: input.directionId ? true : false })
    } catch (err) {
      next(err)
    }
  })

  // 为指定方向方案生成书名组
  router.post('/:id/titles', async (req, res, next) => {
    try {
      const novelId = Number(req.params.id)
      const input = z.object({ direction: z.unknown() }).parse(req.body)
      const result = await callLlmJson<string[]>(
        db,
        'extraction',
        {
          novelId,
          messages: [
            {
              role: 'user',
              content: `${getSystemPrompt('titles')}\n${JSON_FORMAT}\n\n方向方案：${JSON.stringify(input.direction, null, 2)}\n\n请输出 {"titles": [{"title": "书名", "reason": "理由"}]}，共 10 个。`
            }
          ],
          maxTokens: 2048
        },
        parseTitles,
        'titles'
      )
      res.json({ titles: result })
    } catch (err) {
      next(err)
    }
  })

  // 生成项目设定（framing）
  router.post('/:id/framing', async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z
        .object({
          title: z.string().optional(),
          direction: z.unknown().optional(),
          notes: z.string().optional().default(''),
          guidance: z.string().max(1000).optional()
        })
        .parse(req.body)
      const novel = db.prepare('SELECT inspiration FROM novel WHERE id = ?').get(id) as
        | { inspiration: string }
        | undefined
      // v0.9.0（审查 #18）：不存在的小说直接 404（此前解引用空对象抛 TypeError → 500）
      if (!novel) {
        res.status(404).json({ error: 'novel not found' })
        return
      }
      const row = db.prepare('SELECT direction_json FROM novel WHERE id = ?').get(id) as {
        direction_json: string
      }
      const direction = input.direction ?? JSON.parse(row.direction_json ?? '[]')
      const framing = await callLlmJson<Record<string, unknown>>(
        db,
        'extraction',
        {
          novelId: id,
          guidance: input.guidance,
          messages: [
            {
              role: 'user',
              content: `${getSystemPrompt('planning')}\n${JSON_FORMAT}\n\n灵感：${novel?.inspiration ?? ''}\n方向：${JSON.stringify(direction)}\n补充：${input.notes}\n\n请输出 {"summary": "故事梗概", "sellingPoint": "卖点", "readerFeeling": "目标读者感受", "first30Promise": "前30章承诺"}`
            }
          ],
          maxTokens: 2048
        },
        (obj) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null),
        'framing'
      )
      if (input.title) {
        db.prepare(
          "UPDATE novel SET title = ?, framing_json = ?, status = 'framed', updated_at = datetime('now') WHERE id = ?"
        ).run(input.title, JSON.stringify(framing), id)
      } else {
        db.prepare(
          "UPDATE novel SET framing_json = ?, status = 'framed', updated_at = datetime('now') WHERE id = ?"
        ).run(JSON.stringify(framing), id)
      }
      res.json({ framing })
    } catch (err) {
      next(err)
    }
  })

  // P13 G7：字段级 AI 重写（只重写单字段，其余保留）
  router.post('/:id/framing/field', async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z.object({ field: z.enum(['summary', 'sellingPoint', 'readerFeeling', 'first30Promise']), guidance: z.string().max(1000).optional() }).parse(req.body)
      const novel = db.prepare('SELECT inspiration, framing_json FROM novel WHERE id = ?').get(id) as
        | { inspiration: string; framing_json: string }
        | undefined
      if (!novel) {
        res.status(404).json({ error: 'novel not found' })
        return
      }
      const framing = JSON.parse(novel.framing_json || '{}') as Record<string, unknown>
      const FIELD_LABEL: Record<string, string> = {
        summary: '故事梗概',
        sellingPoint: '卖点',
        readerFeeling: '读者感受',
        first30Promise: '前30章承诺'
      }
      const result = await callLlmJson<{ value: string }>(
        db,
        'extraction',
        {
          novelId: id,
          guidance: input.guidance,
          messages: [
            {
              role: 'user',
              content: `${getSystemPrompt('planning')}\n${JSON_FORMAT}\n\n灵感：${novel.inspiration}\n当前 framing：${JSON.stringify(framing, null, 2)}\n\n只重写「${FIELD_LABEL[input.field]}」字段（80-200字），其余字段保持原样。\n\n请输出 {"value": "重写后的${FIELD_LABEL[input.field]}"}`
            }
          ],
          maxTokens: 1024
        },
        (obj) => {
          const r = obj as Record<string, unknown>
          if (typeof r.value !== 'string' || r.value.trim().length < 20) return null
          return { value: r.value.trim() }
        },
        'framing-field'
      )
      framing[input.field] = result.value
      db.prepare("UPDATE novel SET framing_json = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(framing),
        id
      )
      res.json({ framing })
    } catch (err) {
      next(err)
    }
  })

  // 生成故事宏观规划
  router.post('/:id/macro', async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const novel = db.prepare('SELECT framing_json, title FROM novel WHERE id = ?').get(id) as
        | { framing_json: string; title: string }
        | undefined
      if (!novel) {
        res.status(404).json({ error: 'novel not found' })
        return
      }
      const macro = await callLlmJson<Record<string, unknown>>(
        db,
        'extraction',
        {
          novelId: id,
          guidance: (req.body as { guidance?: string } | undefined)?.guidance,
          messages: [
            {
              role: 'user',
              content: `${getSystemPrompt('macro')}\n${JSON_FORMAT}\n\n书名：${novel.title}\n设定：${novel.framing_json}\n\n请输出 {"storyEngine": "故事引擎（核心张力）", "longConflict": "长期对立", "payoffSummary": "推进与兑现摘要", "theme": "主题"}`
            }
          ],
          maxTokens: 2048
        },
        (obj) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null),
        'macro'
      )
      const current = JSON.parse(novel.framing_json || '{}') as Record<string, unknown>
      db.prepare("UPDATE novel SET framing_json = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify({ ...current, macro }),
        id
      )
      res.json({ macro })
    } catch (err) {
      next(err)
    }
  })

  return router
}
