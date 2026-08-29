// 章节执行路由：手动创建章节（P23 批3 N2，空章后续可生成/编辑）
import type { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

export function registerChapterCreateRoutes(router: Router, db: DatabaseSync): void {
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
}
