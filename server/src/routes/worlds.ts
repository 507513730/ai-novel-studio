import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { callLlmJson } from '../services/jsonSafe'
import { buildWebContextBlock } from '../services/webSearch'
// v0.23.1（批次 B1）：世界观三步 + 角色两批 prompt/解析收敛 planner（此前内联五份，webCtx 细节独有）
import {
  generateWorldManualPrompt,
  parseWorldManual,
  generateWorldFactionsPrompt,
  parseWorldFactions,
  generateWorldMapPrompt,
  parseWorldMap,
  generateCharsCorePrompt,
  generateCharsExtendedPrompt,
  parseCharacters
} from '../services/planner'

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
      // v0.18.0：联网查找开关开启时——用灵感/设定自动搜索 Wikipedia 注入世界观参考（零 key）
      const webCtx = await buildWebContextBlock(db, `${novel.inspiration || '小说'}`.slice(0, 60))

      const manual = await callLlmJson<Record<string, string>>(
        db,
        'extraction',
        {
          novelId,
          guidance: (req.body as { guidance?: string } | undefined)?.guidance,
          messages: [
            {
              role: 'user',
              content: generateWorldManualPrompt(base, webCtx)
            }
          ],
          maxTokens: 2048
        },
        parseWorldManual,
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
              content: generateWorldFactionsPrompt(base, manual)
            }
          ],
          maxTokens: 2048
        },
        parseWorldFactions,
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
              content: generateWorldMapPrompt(base)
            }
          ],
          maxTokens: 2048
        },
        parseWorldMap,
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

      const core = await callLlmJson<Char[]>(
        db,
        'extraction',
        {
          novelId,
          guidance: (req.body as { guidance?: string } | undefined)?.guidance,
          messages: [
            {
              role: 'user',
              // v0.23.1（批次 B1）：角色两批 prompt/解析收敛 planner（与导演链同源）
              content: generateCharsCorePrompt(base)
            }
          ],
          maxTokens: 4096
        },
        parseCharacters,
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
              content: generateCharsExtendedPrompt(base, core.map((c) => ({ name: c.name, role: c.role })))
            }
          ],
          maxTokens: 4096
        },
        parseCharacters,
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
