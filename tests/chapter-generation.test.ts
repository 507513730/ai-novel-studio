import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { ConfigError } from '../server/src/services/llm'
import { claimChapter, failClaimedChapter } from '../server/src/services/chapterGeneration/state'
import type { ClaimedChapter } from '../server/src/services/chapterGeneration/types'
import { persistGeneratedChapter } from '../server/src/services/chapterGeneration/persistence'
import { setConstraints, type NovelConstraint } from '../server/src/services/constraintEngine'
import { postProcessGeneratedContent } from '../server/src/services/chapterGeneration/postProcess'
import { callLlmJson } from '../server/src/services/jsonSafe'

vi.mock('../server/src/services/jsonSafe', () => ({ callLlmJson: vi.fn() }))

const mockedCallLlmJson = vi.mocked(callLlmJson)

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

describe('chapter generation post processing', () => {
  beforeEach(() => {
    mockedCallLlmJson.mockReset()
  })

  it('replaces the protagonist name and returns no degradation without anti-AI rules', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 1)
    const constraint: NovelConstraint = {
      id: 'c-name',
      text: '主角必须叫 Jing',
      level: 'must',
      enabled: true,
      createdAt: '2026-08-25T00:00:00Z',
      keyword: 'Jing',
      replaceWith: 'Jing'
    }
    setConstraints(db, novelId, [constraint])
    db.prepare('INSERT INTO character (novel_id, name, profile_json) VALUES (?, ?, ?)').run(
      novelId,
      '惊蛰',
      JSON.stringify({ role: '主角' })
    )

    const result = await postProcessGeneratedContent(db, novelId, chapterIds[0], '惊蛰推开了门。')

    expect(result).toEqual({ content: 'Jing推开了门。', degradedReasons: [] })
    db.close()
  })

  it('keeps the original content and reports degradation when the rewrite is too short', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 1)
    db.prepare(
      'INSERT INTO style_asset (novel_id, name, features_json, samples_json, anti_ai_rules_json) VALUES (?, ?, ?, ?, ?)'
    ).run(
      novelId,
      '测试风格',
      JSON.stringify([{ id: 'f1', name: '节奏', description: '短句', enabled: true, category: 'rhythm' }]),
      '[]',
      JSON.stringify(['套话'])
    )
    mockedCallLlmJson.mockResolvedValue({ content: '短文' })
    const original = '套话套话套话套话套话，这是原文。'

    const result = await postProcessGeneratedContent(db, novelId, chapterIds[0], original)

    expect(result.content).toBe(original)
    expect(result.degradedReasons).toContain('anti-ai rewrite rejected: output too short')
    db.close()
  })

  it('records constraint violations against the generated chapter, not the latest chapter', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 3)
    const constraint: NovelConstraint = {
      id: 'c-ban',
      text: '全文禁止出现套话',
      level: 'must',
      enabled: true,
      createdAt: '2026-08-29T00:00:00Z',
      keyword: '套话'
    }
    setConstraints(db, novelId, [constraint])

    const result = await postProcessGeneratedContent(db, novelId, chapterIds[0], '开头一句套话。')

    expect(result.content).toBe('开头一句套话。')
    expect(result.degradedReasons).toEqual([])
    const debts = db.prepare('SELECT chapter_id, issue FROM quality_debt').all() as Array<{
      chapter_id: number
      issue: string
    }>
    expect(debts).toHaveLength(1)
    expect(debts[0].chapter_id).toBe(chapterIds[0])
    expect(debts[0].issue).toContain('c-ban')
    db.close()
  })
})
