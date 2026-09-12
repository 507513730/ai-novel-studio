// 章节生成状态域（spec §3.1 / R4.1）：抢占与失败恢复的唯一入口。
// 抢占原子置 generating 并颁发章节级 generation_token；收尾必须携带该 token——
// 新一轮抢占覆盖 token 后，旧协程的失败处理被守卫拒绝（不得触碰新 claim 的数据）。
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { ConfigError } from '../llm/errors'
import type { ClaimedChapter } from './types'
import { ChapterSaveConflict } from '../chapterSave'

export function claimChapter(db: DatabaseSync, novelId: number, chapterId: number, expectedContent?: string): ClaimedChapter {
  const row = db
    .prepare('SELECT id, status, content FROM chapter WHERE id = ? AND novel_id = ?')
    .get(chapterId, novelId) as { id: number; status: string; content: string } | undefined

  if (!row) throw new Error('chapter not found')
  if (expectedContent !== undefined && row.content !== expectedContent) throw new ChapterSaveConflict('CHAPTER_CONTENT_CONFLICT')

  // P2.2 修复 #4：原子抢占（防同章并发生成 → 双写/双倍费用）
  const generationToken = randomUUID()
  const result = db
    .prepare(
      "UPDATE chapter SET status='generating', generation_token=?, updated_at=datetime('now') WHERE id=? AND novel_id=? AND status NOT IN ('generating') AND content=?"
    )
    .run(generationToken, chapterId, novelId, row.content)

  if (result.changes === 0) {
    if (expectedContent !== undefined) throw new ChapterSaveConflict('CHAPTER_CONTENT_CONFLICT')
    throw new Error('章节正在生成中（或状态不允许），请等待完成')
  }

  return { id: row.id, novelId, previousStatus: row.status, generationToken, initialContent: row.content }
}

// v0.24.3（写书实战纠错）：ConfigError 时章节并未真正尝试生成，恢复抢占前状态而非误标 failed。
// R4.1：携带 generation_token 守卫——token 已被新一轮抢占覆盖时静默跳过（新 claim 的数据不可触碰）。
export function failClaimedChapter(db: DatabaseSync, claim: ClaimedChapter, error: unknown): void {
  const status = error instanceof ConfigError ? claim.previousStatus : 'failed'
  db.prepare(
    "UPDATE chapter SET status=?, updated_at=datetime('now') WHERE id=? AND novel_id=? AND generation_token=? AND status='generating'"
  ).run(status, claim.id, claim.novelId, claim.generationToken)
}
