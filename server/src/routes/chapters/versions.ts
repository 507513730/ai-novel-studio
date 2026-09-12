// 章节执行路由：版本历史 / 快照 / 详情 / diff / 恢复
import type { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { rateLimit } from 'express-rate-limit'
import { diffLines } from '../../services/diff'
import { commitChapterSave } from '../../services/chapterSave'

export function registerChapterVersionRoutes(router: Router, db: DatabaseSync): void {
  const snapshotLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false })
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

  router.post('/:novelId/chapters/:chapterId/versions', snapshotLimit, (req, res, next) => {
    try {
      const chapterId = Number(req.params.chapterId)
      const novelId = Number(req.params.novelId)
      const input = z.object({ note: z.string().max(200).optional().default('手动快照'), content: z.string().max(500_000).optional() }).parse(req.body)
      const chapter = db
        .prepare('SELECT content FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { content: string } | undefined
      if (!chapter) {
        res.status(404).json({ error: 'chapter not found' })
        return
      }
      const result = db
        .prepare('INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, ?)')
        .run(chapterId, input.content ?? chapter.content, input.note)
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
        .prepare('SELECT id, content, note, created_at AS createdAt FROM chapter_version WHERE id = ? AND chapter_id = ?')
        .get(versionId, chapterId) as { id: number; content: string; note: string; createdAt: string } | undefined
      if (!row) {
        res.status(404).json({ error: 'version not found' })
        return
      }
      // v0.17.0（审查 M5）：单版本详情与列表端点字段一致（此前 created_at 直出）
      res.json({ version: row })
    } catch (err) {
      next(err)
    }
  })

  // ---------- v0.24.2（F3）：版本 diff（行级对比「版本 vs 当前」——恢复前检视） ----------
  router.get('/:novelId/chapters/:chapterId/versions/:versionId/diff', (req, res, next) => {
    try {
      const chapterId = Number(req.params.chapterId)
      const novelId = Number(req.params.novelId)
      const versionId = Number(req.params.versionId)
      const row = db
        .prepare('SELECT id, content, note, created_at AS createdAt FROM chapter_version WHERE id = ? AND chapter_id = ?')
        .get(versionId, chapterId) as { id: number; content: string; note: string; createdAt: string } | undefined
      if (!row) {
        res.status(404).json({ error: 'version not found' })
        return
      }
      const current = db
        .prepare('SELECT content FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { content: string } | undefined
      const diff = diffLines(row.content, current?.content ?? '')
      res.json({ versionId: row.id, note: row.note, createdAt: row.createdAt, ...diff })
    } catch (err) {
      next(err)
    }
  })

  router.post('/:novelId/chapters/:chapterId/versions/:versionId/restore', snapshotLimit, (req, res, next) => {
    try {
      const protocol = z.object({ expectedContent: z.string(), operationId: z.string().min(1).max(200) }).parse(req.body)
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
      if (!row.content.trim()) {
        res.status(400).json({ error: '不能恢复空正文版本' })
        return
      }
      const restoredWordCount = (row.content.match(/[\u4e00-\u9fff]/g) ?? []).length
      const result = commitChapterSave(db, novelId, chapterId, protocol, { kind: 'restore', versionId, ...protocol }, () => {
        const current = db
          .prepare('SELECT content FROM chapter WHERE id = ? AND novel_id = ?')
          .get(chapterId, novelId) as { content: string }
        if (current.content.trim()) {
          db.prepare("INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, '恢复前快照')").run(chapterId, current.content)
        }
        // 版本恢复按整章替换计数，与快照和回执同事务。
        db.prepare(
          "UPDATE chapter SET content = ?, word_count = ?, ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ? AND novel_id = ?"
        ).run(row.content, restoredWordCount, restoredWordCount, chapterId, novelId)
      })
      res.json({ ...result, content: row.content, wordCount: restoredWordCount })
    } catch (err) {
      next(err)
    }
  })
}
