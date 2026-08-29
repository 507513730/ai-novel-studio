// 章节生成持久化域（spec §3.1 / §4.1）：正文、版本、字数与最终状态收尾的唯一入口。
// 契约：短事务内一致写入；空正文不建版本；守卫失配（changes≠1）即整体回滚。
import { DatabaseSync } from 'node:sqlite'
import type { ClaimedChapter, PersistedGeneration } from './types'

function countChineseChars(content: string): number {
  return (content.match(/[\u4e00-\u9fff]/g) ?? []).length
}

export function persistGeneratedChapter(
  db: DatabaseSync,
  claim: ClaimedChapter,
  generation: PersistedGeneration
): { wordCount: number } {
  const content = generation.content
  const wordCount = countChineseChars(content)

  db.exec('BEGIN')
  try {
    if (!content.trim()) {
      // v0.17.0（审查 H2）：空内容显式置 failed（此前跳过 UPDATE → 永久卡 'generating'）
      const result = db.prepare(
        "UPDATE chapter SET status='failed', updated_at=datetime('now') WHERE id=? AND novel_id=? AND status='generating'"
      ).run(claim.id, claim.novelId)
      if (Number(result.changes) !== 1) throw new Error('章节不处于生成状态')
      db.exec('COMMIT')
      return { wordCount: 0 }
    }

    db.prepare('INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, ?)').run(
      claim.id,
      content,
      generation.aborted ? 'AI 生成（中止）' : 'AI 生成'
    )
    // v0.22.0（审查 N1·本地设计决策）：整章替换→覆盖语义（非累加，防重生膨胀）。
    // 覆盖使 ai_words==当前内容 AI 字数；human_words=0（整章替换丢弃先前人工编辑）。
    const result = db
      .prepare(
        "UPDATE chapter SET content=?, word_count=?, status='written', ai_words=?, human_words=0, updated_at=datetime('now') WHERE id=? AND novel_id=? AND status='generating'"
      )
      .run(content, wordCount, wordCount, claim.id, claim.novelId)
    if (Number(result.changes) === 0) throw new Error('章节不处于生成状态')

    db.exec('COMMIT')
    return { wordCount }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
