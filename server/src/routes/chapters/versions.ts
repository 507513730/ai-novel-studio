// 章节执行路由：版本历史 / 快照 / 详情 / diff / 恢复
import type { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { diffLines } from '../../services/diff'

export function registerChapterVersionRoutes(router: Router, db: DatabaseSync): void {
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
      // v0.22.0（审查 N1·本地设计决策）：版本恢复=整章替换→覆盖计数器（恢复内容归 AI，"不重复计"语义）
      const restoredWordCount = (row.content.match(/[\u4e00-\u9fff]/g) ?? []).length
      db.prepare(
        "UPDATE chapter SET content = ?, word_count = ?, ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ? AND novel_id = ?"
      ).run(row.content, restoredWordCount, restoredWordCount, chapterId, novelId)
      res.json({ content: row.content, wordCount: restoredWordCount })
    } catch (err) {
      next(err)
    }
  })
}
