import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

// P11-3：流派管理（genre_asset：全局预设 novel_id IS NULL + 自定义）

export function createGenresRouter(db: DatabaseSync): Router {
  const router = Router()

  // 流派列表（全局预设 + 该书自定义）
  router.get('/', (req, res) => {
    const novelId = Number(req.query.novelId ?? 0)
    const rows = db
      .prepare('SELECT id, name, novel_id FROM genre_asset WHERE novel_id IS NULL OR novel_id = ? ORDER BY id')
      .all(novelId || null) as Array<{ id: number; name: string; novel_id: number | null }>
    res.json({
      genres: rows.map((r) => ({
        id: r.id,
        name: r.name,
        novelId: r.novel_id,
        custom: r.novel_id !== null
      }))
    })
  })

  // 创建流派（novelId 为空 = 全局模板；非空 = 该书自定义）
  router.post('/', (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().min(1).max(30),
          novelId: z.number().int().positive().nullable().optional()
        })
        .parse(req.body)
      const name = input.name.trim()
      const novelId = input.novelId ?? null
      const dup = db
        .prepare('SELECT id FROM genre_asset WHERE name = ? AND (novel_id IS NULL OR novel_id = ?)')
        .get(name, novelId ?? 0) as { id: number } | undefined
      if (dup) {
        res.status(409).json({ error: `流派「${name}」已存在` })
        return
      }
      const result = db
        .prepare('INSERT INTO genre_asset (novel_id, name, genre_type) VALUES (?, ?, ?)')
        .run(novelId, name, name)
      res.status(201).json({ id: Number(result.lastInsertRowid), name, novelId, custom: novelId !== null })
    } catch (err) {
      next(err)
    }
  })

  return router
}
