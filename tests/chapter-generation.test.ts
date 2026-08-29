import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { ConfigError } from '../server/src/services/llm'
import { claimChapter, failClaimedChapter } from '../server/src/services/chapterGeneration/state'
import type { ClaimedChapter } from '../server/src/services/chapterGeneration/types'
import { persistGeneratedChapter } from '../server/src/services/chapterGeneration/persistence'

// 重构计划 R1（spec §4.1）：锁定章节生成域的状态与持久化契约——
// 原子抢占、ConfigError 恢复抢占前状态、短事务一致落库、空正文不建版本、守卫失配回滚。

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function makeNovelWithChapters(db: DatabaseSync, chapterCount: number): { novelId: number; chapterIds: number[] } {
  const novelId = Number(
    db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试灵感', '章节生成契约测试').lastInsertRowid
  )
  const volumeId = Number(
    db.prepare('INSERT INTO volume (novel_id, title, order_index) VALUES (?, ?, ?)').run(novelId, '第一卷', 0)
      .lastInsertRowid
  )
  const chapterIds: number[] = []
  for (let i = 1; i <= chapterCount; i++) {
    chapterIds.push(
      Number(
        db
          .prepare(
            "INSERT INTO chapter (novel_id, volume_id, title, summary, goal_json, content, status) VALUES (?, ?, ?, ?, ?, '', 'planned')"
          )
          .run(novelId, volumeId, `第${i}章`, `摘要${i}`, '{}').lastInsertRowid
      )
    )
  }
  return { novelId, chapterIds }
}

function readStatus(db: DatabaseSync, chapterId: number): string {
  return (db.prepare('SELECT status FROM chapter WHERE id = ?').get(chapterId) as { status: string }).status
}

function readChapter(db: DatabaseSync, chapterId: number): {
  content: string
  word_count: number
  ai_words: number
  human_words: number
  status: string
} {
  return db.prepare('SELECT content, word_count, ai_words, human_words, status FROM chapter WHERE id = ?').get(chapterId) as {
    content: string
    word_count: number
    ai_words: number
    human_words: number
    status: string
  }
}

function readLatestVersion(db: DatabaseSync, chapterId: number): { content: string; note: string } | undefined {
  return db
    .prepare('SELECT content, note FROM chapter_version WHERE chapter_id = ? ORDER BY id DESC LIMIT 1')
    .get(chapterId) as { content: string; note: string } | undefined
}

describe('chapter generation state and persistence contracts', () => {
  it('atomically claims a planned chapter and rejects a second claim', () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 1)

    const claimed: ClaimedChapter = claimChapter(db, novelId, chapterIds[0])

    expect(claimed.previousStatus).toBe('planned')
    expect(readStatus(db, chapterIds[0])).toBe('generating')
    expect(() => claimChapter(db, novelId, chapterIds[0])).toThrow(/正在生成/)
    db.close()
  })

  it('restores the claimed status for ConfigError but marks ordinary failures as failed', () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 2)
    const configClaim = claimChapter(db, novelId, chapterIds[0])
    const ordinaryClaim = claimChapter(db, novelId, chapterIds[1])

    failClaimedChapter(db, configClaim, new ConfigError('供应商未配置'))
    failClaimedChapter(db, ordinaryClaim, new Error('生成失败'))

    expect(readStatus(db, chapterIds[0])).toBe('planned')
    expect(readStatus(db, chapterIds[1])).toBe('failed')
    db.close()
  })

  it('persists final generated content and creates an AI version', () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 1)
    const claim = claimChapter(db, novelId, chapterIds[0])

    persistGeneratedChapter(db, claim, { content: '天地玄黄', aborted: false })

    expect(readChapter(db, chapterIds[0])).toEqual({
      content: '天地玄黄',
      word_count: 4,
      ai_words: 4,
      human_words: 0,
      status: 'written'
    })
    expect(readLatestVersion(db, chapterIds[0])).toEqual({ content: '天地玄黄', note: 'AI 生成' })
    expect(readLatestVersion(db, chapterIds[0])?.content).toBe(readChapter(db, chapterIds[0]).content)
    db.close()
  })

  it('marks an aborted partial body with the interrupted AI version note', () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 1)
    const claim = claimChapter(db, novelId, chapterIds[0])

    persistGeneratedChapter(db, claim, { content: '天地', aborted: true })

    expect(readLatestVersion(db, chapterIds[0])).toEqual({ content: '天地', note: 'AI 生成（中止）' })
    expect(readChapter(db, chapterIds[0]).status).toBe('written')
    db.close()
  })

  it('does not create a version for empty output and marks the claim failed', () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 1)
    const claim = claimChapter(db, novelId, chapterIds[0])

    persistGeneratedChapter(db, claim, { content: '', aborted: false })

    expect(readStatus(db, chapterIds[0])).toBe('failed')
    expect(readLatestVersion(db, chapterIds[0])).toBeUndefined()
    db.close()
  })

  it('rejects an empty output when the claim is no longer generating', () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 1)
    const claim = claimChapter(db, novelId, chapterIds[0])
    db.prepare("UPDATE chapter SET status='planned' WHERE id=? AND novel_id=?").run(claim.id, claim.novelId)

    expect(() => persistGeneratedChapter(db, claim, { content: '  ', aborted: false })).toThrow(/不处于生成状态/)
    expect(readLatestVersion(db, chapterIds[0])).toBeUndefined()
    expect(readChapter(db, chapterIds[0])).toMatchObject({ content: '', status: 'planned' })
    db.close()
  })

  it('rolls back the version when the guarded chapter update fails', () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 1)
    const claim = claimChapter(db, novelId, chapterIds[0])
    db.exec(
      `CREATE TRIGGER reject_chapter_write BEFORE UPDATE OF content ON chapter
       WHEN NEW.id = ${claim.id}
       BEGIN SELECT RAISE(ABORT, 'forced chapter update failure'); END`
    )

    expect(() => persistGeneratedChapter(db, claim, { content: '天地玄黄', aborted: false })).toThrow(
      /forced chapter update failure/
    )
    expect(readLatestVersion(db, chapterIds[0])).toBeUndefined()
    expect(readChapter(db, chapterIds[0])).toMatchObject({ content: '', status: 'generating' })
    db.close()
  })
})
