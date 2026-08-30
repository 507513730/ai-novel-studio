// 章节生成持久化域（spec §3.1 / §4.1 / R4.1）：正文、版本、字数与最终状态收尾的唯一入口。
// 契约：短事务内一致写入；守卫 = id+novel_id+generation_token+status='generating'——
// token 被新一轮抢占覆盖（或状态离开 generating）时抛 stale claim 错误且不修改任何数据；
// 空正文不建版本；任何失败整体回滚。
// note/title 变体（R4.3）：方案流水线产出的版本注释与标题覆盖也经此唯一入口落库。
import { DatabaseSync } from 'node:sqlite'
import { countCJKChars } from '../shared/text'
import type { ClaimedChapter, PersistedGeneration } from './types'


export function persistGeneratedChapter(
  db: DatabaseSync,
  claim: ClaimedChapter,
  generation: PersistedGeneration
): { wordCount: number } {
  const content = generation.content
  const wordCount = countCJKChars(content)
  const GUARD = "id=? AND novel_id=? AND generation_token=? AND status='generating'"
  const guardParams = [claim.id, claim.novelId, claim.generationToken] as const
  const note = generation.note ?? (generation.aborted ? 'AI 生成（中止）' : 'AI 生成')

  db.exec('BEGIN')
  try {
    if (!content.trim()) {
      // v0.17.0（审查 H2）：空内容显式置 failed（此前跳过 UPDATE → 永久卡 'generating'）
      const result = db.prepare(
        `UPDATE chapter SET status='failed', updated_at=datetime('now') WHERE ${GUARD}`
      ).run(...guardParams)
      if (Number(result.changes) !== 1) throw staleClaimError()
      db.exec('COMMIT')
      return { wordCount: 0 }
    }

    db.prepare('INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, ?)').run(
      claim.id,
      content,
      note
    )
    // v0.22.0（审查 N1·本地设计决策）：整章替换→覆盖语义（非累加，防重生膨胀）。
    // 覆盖使 ai_words==当前内容 AI 字数；human_words=0（整章替换丢弃先前人工编辑）。
    // title（R4.3）：方案流水线产出附标题时 CASE-WHEN 非空覆盖。
    const result =
      generation.title !== undefined
        ? db
            .prepare(
              `UPDATE chapter SET title = CASE WHEN ? != '' THEN ? ELSE title END, content=?, word_count=?, status='written', ai_words=?, human_words=0, updated_at=datetime('now') WHERE ${GUARD}`
            )
            .run(generation.title, generation.title, content, wordCount, wordCount, ...guardParams)
        : db
            .prepare(
              `UPDATE chapter SET content=?, word_count=?, status='written', ai_words=?, human_words=0, updated_at=datetime('now') WHERE ${GUARD}`
            )
            .run(content, wordCount, wordCount, ...guardParams)
    if (Number(result.changes) === 0) throw staleClaimError()

    db.exec('COMMIT')
    return { wordCount }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function staleClaimError(): Error {
  return new Error('章节生成会话已失效（章节不处于可写生成状态或已被新一轮生成抢占）')
}

// v1.0 后续（A1 多候选分支生成）：写一条候选版本快照，不触碰章节 content/status。
// architecture-guard 约定 chapter_version 的 INSERT 仅允许在 persistence.ts（本章节生成域）与
// versions 路由——候选快照也须经此唯一入口，避免域外直写。
export function persistCandidateVersion(db: DatabaseSync, chapterId: number, content: string, note: string): number {
  return Number(db.prepare('INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, ?)').run(chapterId, content, note).lastInsertRowid)
}
