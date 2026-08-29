// 重构计划 R4.3：整本生产幂等与熔断契约——
// ① kill 后恢复以正文产物判定跳过（不因旧 status 再次调用模型）；
// ② 普通失败继续下一章并计 failed；③ ConfigError 熔断整批且未尝试章节保持 planned。
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { generateChapterMock, callLlmJsonMock } = vi.hoisted(() => ({
  generateChapterMock: vi.fn(),
  callLlmJsonMock: vi.fn()
}))
vi.mock('../server/src/services/generate', () => ({ generateChapter: (...a: unknown[]) => generateChapterMock(...a) }))
vi.mock('../server/src/services/jsonSafe', () => ({ callLlmJson: (...a: unknown[]) => callLlmJsonMock(...a) }))

import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { ConfigError } from '../server/src/services/llm'
import { runProductionPipeline } from '../server/src/services/production/pipeline'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function seedNovelWithChapters(db: DatabaseSync, count: number): { novelId: number; chapterIds: number[] } {
  const novelId = Number(
    db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('灵感', '生产幂等').lastInsertRowid
  )
  const volumeId = Number(
    db.prepare('INSERT INTO volume (novel_id, title, order_index) VALUES (?, ?, ?)').run(novelId, '第一卷', 0).lastInsertRowid
  )
  const chapterIds: number[] = []
  for (let i = 1; i <= count; i++) {
    chapterIds.push(
      Number(
        db
          .prepare(
            "INSERT INTO chapter (novel_id, volume_id, title, content, status) VALUES (?, ?, ?, '', 'planned')"
          )
          .run(novelId, volumeId, `第${i}章`).lastInsertRowid
      )
    )
  }
  return { novelId, chapterIds }
}

const GOOD_GENERATION = { content: '好'.repeat(300), wordCount: 300, aborted: false, usage: { input: 0, output: 0, cacheHit: 0, cacheMiss: 0 } }

// mock 生成域成功路径的持久化副作用（真实 generateChapter 落库正文 = 产物）
function succeedWithContent(db: DatabaseSync): void {
  generateChapterMock.mockImplementation(async (_db: DatabaseSync, _novelId: number, chapterId: number) => {
    db.prepare("UPDATE chapter SET content = ?, status = 'written' WHERE id = ?").run(GOOD_GENERATION.content, chapterId)
    return GOOD_GENERATION
  })
}

beforeEach(() => {
  generateChapterMock.mockReset()
  callLlmJsonMock.mockReset()
  // 审核/回灌默认成功：高分免修 + 空回灌
  callLlmJsonMock.mockImplementation((_db: unknown, _t: string, _o: unknown, _p: unknown, label: string) => {
    if (label === 'production-review') return Promise.resolve({ score: 90, issues: [], needsFix: false })
    if (label === 'production-backfill') return Promise.resolve({ characterStates: [], newFacts: [] })
    return Promise.reject(new Error(`unexpected call: ${label}`))
  })
})

describe('整本生产幂等与熔断（R4.3）', () => {
  it('kill 后恢复：已有正文的章节不再调用模型；空章节继续生产', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = seedNovelWithChapters(db, 2)
    // 第 1 章已有正文（上一轮生产的产物）——即使 status 为 planned 也跳过
    db.prepare("UPDATE chapter SET content = '上一轮产物', status = 'planned' WHERE id = ?").run(chapterIds[0])
    succeedWithContent(db)

    const progress = await runProductionPipeline(db, novelId, () => {})

    expect(generateChapterMock).toHaveBeenCalledTimes(1)
    expect(generateChapterMock).toHaveBeenCalledWith(db, novelId, chapterIds[1])
    expect(progress.total).toBe(1)
    expect(progress.done).toBe(1)
    expect(progress.failed).toBe(0)
    db.close()
  })

  it('连续两轮生产：第二轮全部章节均为产物，零模型调用', async () => {
    const db = makeDb()
    const { novelId } = seedNovelWithChapters(db, 2)
    succeedWithContent(db)

    await runProductionPipeline(db, novelId, () => {})
    const callsAfterRound1 = generateChapterMock.mock.calls.length

    const progress = await runProductionPipeline(db, novelId, () => {})
    expect(progress.total).toBe(0)
    expect(generateChapterMock.mock.calls.length).toBe(callsAfterRound1)
    db.close()
  })

  it('普通失败继续下一章并计 failed；章节置 failed 不中断批次', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = seedNovelWithChapters(db, 2)
    generateChapterMock.mockRejectedValueOnce(new Error('供应商超时'))
    generateChapterMock.mockResolvedValue(GOOD_GENERATION)

    const progress = await runProductionPipeline(db, novelId, () => {})

    expect(progress.failed).toBe(1)
    expect(progress.done).toBe(2) // done=处理完成率（含失败章节，P20 C9）
    const failed = db.prepare('SELECT status FROM chapter WHERE id = ?').get(chapterIds[0]) as { status: string }
    const done = db.prepare('SELECT status FROM chapter WHERE id = ?').get(chapterIds[1]) as { status: string }
    expect(failed.status).toBe('failed')
    expect(done.status).toBe('reviewed')
    db.close()
  })

  it('ConfigError 熔断整批：上抛且未尝试章节保持 planned', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = seedNovelWithChapters(db, 3)
    generateChapterMock.mockRejectedValue(new ConfigError('key 解密失败'))

    await expect(runProductionPipeline(db, novelId, () => {})).rejects.toThrow(ConfigError)
    expect(generateChapterMock).toHaveBeenCalledTimes(1) // 首章即熔断，不逐章空转
    for (const cid of [chapterIds[1], chapterIds[2]]) {
      const row = db.prepare('SELECT status FROM chapter WHERE id = ?').get(cid) as { status: string }
      expect(row.status).toBe('planned')
    }
    db.close()
  })
})
