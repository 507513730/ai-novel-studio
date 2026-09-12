import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export class ChapterSaveConflict extends Error {
  constructor(public readonly code: 'CHAPTER_CONTENT_CONFLICT' | 'OPERATION_ID_REUSED') {
    super(code === 'CHAPTER_CONTENT_CONFLICT' ? '正文已修改，请保留本地编辑并重新比较' : '操作编号已用于其他保存请求')
  }
}

export function commitChapterSave(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  input: { expectedContent: string; operationId: string },
  request: unknown,
  write: () => void
): { ok: true; replayed: boolean; currentContent: string } {
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  db.exec('BEGIN IMMEDIATE')
  try {
    const current = db.prepare('SELECT content FROM chapter WHERE id=? AND novel_id=?').get(chapterId, novelId) as { content: string } | undefined
    if (!current) throw new Error('chapter not found')
    const receipt = db.prepare('SELECT request_hash FROM chapter_save_receipt WHERE chapter_id=? AND operation_id=?').get(chapterId, input.operationId) as { request_hash: string } | undefined
    if (receipt && receipt.request_hash !== requestHash) throw new ChapterSaveConflict('OPERATION_ID_REUSED')
    if (!receipt) {
      if (current.content !== input.expectedContent) throw new ChapterSaveConflict('CHAPTER_CONTENT_CONFLICT')
      write()
      db.prepare('INSERT INTO chapter_save_receipt (chapter_id, operation_id, request_hash) VALUES (?, ?, ?)').run(chapterId, input.operationId, requestHash)
    }
    const saved = db.prepare('SELECT content FROM chapter WHERE id=? AND novel_id=?').get(chapterId, novelId) as { content: string }
    db.exec('COMMIT')
    return { ok: true, replayed: Boolean(receipt), currentContent: saved.content }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
