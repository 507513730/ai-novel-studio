import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { callLlmJson } from '../services/jsonSafe'
import { JSON_FORMAT } from '../prompts'
import { getSystemPrompt } from '../prompts/promptAsset'

export function createWorldsRouter(db: DatabaseSync): Router {
  const router = Router()

  router.get('/:novelId/world', (req, res) => {
    const novelId = Number(req.params.novelId)
    const row = db.prepare('SELECT * FROM world WHERE novel_id = ?').get(novelId) as
      | Record<string, unknown>
      | undefined
    if (!row) {
      res.status(404).json({ error: 'world not found' })
      return
    }
    res.json({
      world: {
        manual: JSON.parse(String(row.manual_json ?? '{}')),
        factions: JSON.parse(String(row.factions_json ?? '[]')),
        map: JSON.parse(String(row.map_json ?? '{}')),
        timeline: JSON.parse(String(row.timeline_json ?? '[]'))
      }
    })
  })

  router.patch('/:novelId/world', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({
          manual: z.unknown().optional(),
          factions: z.unknown().optional(),
          map: z.unknown().optional(),
          timeline: z.unknown().optional()
        })
        .parse(req.body)
      const current = db.prepare('SELECT * FROM world WHERE novel_id = ?').get(novelId) as
        | Record<string, unknown>
        | undefined
      if (!current) {
        res.status(404).json({ error: 'world not found' })
        return
      }
      db.prepare(
        "UPDATE world SET manual_json = ?, factions_json = ?, map_json = ?, timeline_json = ?, updated_at = datetime('now') WHERE novel_id = ?"
      ).run(
        input.manual !== undefined ? JSON.stringify(input.manual) : String(current.manual_json),
        input.factions !== undefined ? JSON.stringify(input.factions) : String(current.factions_json),
        input.map !== undefined ? JSON.stringify(input.map) : String(current.map_json),
        input.timeline !== undefined ? JSON.stringify(input.timeline) : String(current.timeline_json),
        novelId
      )
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // AI 生成世界观骨架（大 JSON 拆步：手册 → 势力 → 地图，防截断）
  router.post('/:novelId/world/generate', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const novel = db.prepare('SELECT framing_json, inspiration FROM novel WHERE id = ?').get(novelId) as
        | { framing_json: string; inspiration: string }
        | undefined
      if (!novel) {
        res.status(404).json({ error: 'novel not found' })
        return
      }
      const base = `书名设定：${novel.framing_json}\n灵感：${novel.inspiration}`

      const manual = await callLlmJson<Record<string, string>>(
        db,
        'extraction',
        {
          novelId,
          guidance: (req.body as { guidance?: string } | undefined)?.guidance,
          messages: [
            {
              role: 'user',
              content: `${getSystemPrompt('world')}\n${JSON_FORMAT}\n\n${base}\n\n第一步请只输出世界观手册（力量体系、核心规则、社会结构、历史脉络），格式 {"category": "描述"}，4-6 个 category，每项 50-120 字。`
            }
          ],
          maxTokens: 2048
        },
        (obj) => {
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            const rec = obj as Record<string, unknown>
            if (Object.keys(rec).length >= 2) return rec as Record<string, string>
          }
          return null
        },
        'world-manual'
      )

      const factions = await callLlmJson<Array<{ name: string; desc: string; stance: string }>>(
        db,
        'extraction',
        {
          novelId,
          messages: [
            {
              role: 'user',
              content: `${getSystemPrompt('world')}\n${JSON_FORMAT}\n\n${base}\n\n世界观手册：${JSON.stringify(manual)}\n\n第二步请输出势力清单，格式 {"factions": [{"name": "势力名", "desc": "描述", "stance": "立场"}]}，4-8 个势力。`
            }
          ],
          maxTokens: 2048
        },
        (obj) => {
          const arr = (obj as { factions?: unknown }).factions
          if (!Array.isArray(arr) || arr.length === 0) return null
          return arr.map((f) => {
            const r = f as Record<string, unknown>
            return { name: String(r.name ?? ''), desc: String(r.desc ?? ''), stance: String(r.stance ?? '') }
          })
        },
        'world-factions'
      )

      const map = await callLlmJson<Record<string, string>>(
        db,
        'extraction',
        {
          novelId,
          messages: [
            {
              role: 'user',
              content: `${getSystemPrompt('world')}\n${JSON_FORMAT}\n\n${base}\n\n第三步请输出关键地点清单，格式 {"place": "描述"}，3-5 个地点，每项 30-80 字。`
            }
          ],
          maxTokens: 2048
        },
        (obj) => (obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, string>) : null),
        'world-map'
      )

      db.prepare(
        "UPDATE world SET manual_json = ?, factions_json = ?, map_json = ?, updated_at = datetime('now') WHERE novel_id = ?"
      ).run(JSON.stringify(manual), JSON.stringify(factions), JSON.stringify(map), novelId)

      res.json({ manual, factions, map })
    } catch (err) {
      next(err)
    }
  })

  // ---------- characters ----------
  router.get('/:novelId/characters', (req, res) => {
    const novelId = Number(req.params.novelId)
    const rows = db
      .prepare(
        'SELECT id, name, status, profile_json, ledger_json FROM character WHERE novel_id = ? ORDER BY id'
      )
      .all(novelId) as Array<Record<string, unknown>>
    res.json({
      characters: rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        profile: JSON.parse(String(r.profile_json ?? '{}')),
        ledger: JSON.parse(String(r.ledger_json ?? '{}'))
      }))
    })
  })

  router.post('/:novelId/characters', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({
          name: z.string().min(1),
          profile: z.unknown().default({}),
          status: z.enum(['roster', 'pending']).default('pending')
        })
        .parse(req.body)
      const result = db
        .prepare(
          'INSERT INTO character (novel_id, name, profile_json, status) VALUES (?, ?, ?, ?)'
        )
        .run(novelId, input.name, JSON.stringify(input.profile), input.status)
      res.status(201).json({ id: Number(result.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:novelId/characters/:charId', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const charId = Number(req.params.charId)
      const input = z
        .object({
          name: z.string().min(1).optional(),
          profile: z.unknown().optional(),
          status: z.enum(['roster', 'pending']).optional()
        })
        .parse(req.body)
      const sets: string[] = []
      const params: Array<string | number> = []
      if (input.name !== undefined) {
        sets.push('name = ?')
        params.push(input.name)
      }
      if (input.profile !== undefined) {
        sets.push('profile_json = ?')
        params.push(JSON.stringify(input.profile))
      }
      if (input.status !== undefined) {
        sets.push('status = ?')
        params.push(input.status)
      }
      sets.push("updated_at = datetime('now')")
      db.prepare(`UPDATE character SET ${sets.join(', ')} WHERE id = ? AND novel_id = ?`).run(
        ...params,
        charId,
        novelId
      )
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:novelId/characters/:charId', (req, res) => {
    db.prepare('DELETE FROM character WHERE id = ? AND novel_id = ?').run(
      Number(req.params.charId),
      Number(req.params.novelId)
    )
    res.json({ ok: true })
  })

  // AI 生成角色阵容（分两批：核心 + 扩展，防大 JSON 截断）
  router.post('/:novelId/characters/generate', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const novel = db.prepare('SELECT framing_json FROM novel WHERE id = ?').get(novelId) as
        | { framing_json: string }
        | undefined
      const world = db
        .prepare('SELECT manual_json, factions_json FROM world WHERE novel_id = ?')
        .get(novelId) as { manual_json: string; factions_json: string } | undefined
      const base = `书级合约：${novel?.framing_json ?? ''}\n世界观：${world ? world.manual_json + world.factions_json : ''}`

      type Char = {
        name: string
        role: string
        identity: string
        personality: string
        goal: string
        weakness: string
        relation: string
      }

      const parseChars = (obj: unknown): Char[] | null => {
        const arr = (obj as { characters?: unknown }).characters
        if (!Array.isArray(arr) || arr.length === 0) return null
        const out: Char[] = []
        for (const c of arr) {
          const r = c as Record<string, unknown>
          if (!r.name) return null
          out.push({
            name: String(r.name),
            role: String(r.role ?? ''),
            identity: String(r.identity ?? ''),
            personality: String(r.personality ?? ''),
            goal: String(r.goal ?? ''),
            weakness: String(r.weakness ?? ''),
            relation: String(r.relation ?? '')
          })
        }
        return out
      }

      const core = await callLlmJson<Char[]>(
        db,
        'extraction',
        {
          novelId,
          guidance: (req.body as { guidance?: string } | undefined)?.guidance,
          messages: [
            {
              role: 'user',
              content: `${getSystemPrompt('characters')}\n${JSON_FORMAT}\n\n${base}\n\n第一步：请只输出核心阵容（主角 + 2-3 个重要配角 + 1-2 个反派），共 4-6 个角色。格式 {"characters": [{"name","role","identity","personality","goal","weakness","relation"}]}`
            }
          ],
          maxTokens: 4096
        },
        parseChars,
        'characters-core'
      )

      const extended = await callLlmJson<Char[]>(
        db,
        'extraction',
        {
          novelId,
          messages: [
            {
              role: 'user',
              content: `${getSystemPrompt('characters')}\n${JSON_FORMAT}\n\n${base}\n\n核心阵容：${JSON.stringify(core.map((c) => ({ name: c.name, role: c.role })))}\n\n第二步：请输出扩展配角与功能性角色（同门/同僚/市井人物/宿敌爪牙等），共 3-5 个，与核心阵容不重复。格式同上 {"characters": [...]}`
            }
          ],
          maxTokens: 4096
        },
        parseChars,
        'characters-extended'
      )

      const characters = [...core, ...extended]
      const insert = db.prepare(
        'INSERT INTO character (novel_id, name, profile_json, status) VALUES (?, ?, ?, ?)'
      )
      db.exec('BEGIN')
      try {
        for (const c of characters) {
          insert.run(
            novelId,

            c.name,
            JSON.stringify({
              role: c.role,
              identity: c.identity,
              personality: c.personality,
              goal: c.goal,
              weakness: c.weakness,
              relation: c.relation
            }),
            'pending'
          )
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      res.json({ characters })
    } catch (err) {
      next(err)
    }
  })

  return router
}
