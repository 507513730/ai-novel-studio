// 重构计划 R4.3：整本生产幂等与熔断契约——
// ① kill 后恢复以正文产物判定跳过（不因旧 status 再次调用模型）；
// ② 普通失败继续下一章并计 failed；③ ConfigError 熔断整批且未尝试章节保持 planned。
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { generateChapterMock, callLlmJsonMock, runProductionChapterMock } = vi.hoisted(() => ({
  generateChapterMock: vi.fn(),
  runProductionChapterMock: vi.fn(),
  callLlmJsonMock: vi.fn()
}))
vi.mock('../server/src/services/chapterGeneration/orchestrator', () => ({ generateChapter: (...a: unknown[]) => generateChapterMock(...a) }))
vi.mock('../server/src/services/jsonSafe', () => ({ callLlmJson: (...a: unknown[]) => callLlmJsonMock(...a) }))
vi.mock('../server/src/services/solutionRunner', () => ({ runProductionChapter: (...a: unknown[]) => runProductionChapterMock(...a) }))

import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { ConfigError } from '../server/src/services/llm/errors'
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
  runProductionChapterMock.mockReset()
  callLlmJsonMock.mockReset()
  // 审核/回灌默认成功：高分免修 + 空回灌
  callLlmJsonMock.mockImplementation((_db: unknown, _t: string, _o: unknown, _p: unknown, label: string) => {
    if (label === 'production-review') return Promise.resolve({ score: 90, issues: [], needsFix: false })
    if (label === 'production-backfill') return Promise.resolve({ characterStates: [], newFacts: [] })
    return Promise.reject(new Error(`unexpected call: ${label}`))
  })
})

describe('整本生产幂等与熔断（R4.3）', () => {
  it('方案等待期间人工保存后方案失败，默认生成回退拒绝原基线', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = seedNovelWithChapters(db, 1)
    const steps = JSON.stringify([{ agentId: 1, role: '正文', stage: 'whole_book' }])
    const solutionId = Number(db.prepare("INSERT INTO solution(name,steps_json,enabled) VALUES('生产方案',?,1)").run(steps).lastInsertRowid)
    db.prepare('UPDATE novel SET current_solution_id=? WHERE id=?').run(solutionId, novelId)
    const actual = await vi.importActual<typeof import('../server/src/services/chapterGeneration/orchestrator')>('../server/src/services/chapterGeneration/orchestrator')
    generateChapterMock.mockImplementation(actual.generateChapter)
    runProductionChapterMock.mockImplementation(async () => {
      await Promise.resolve()
      db.prepare("UPDATE chapter SET content='人工稿', status='written' WHERE id=?").run(chapterIds[0])
      throw new Error('方案失败')
    })
    try {
      const progress = await runProductionPipeline(db, novelId, () => {})
      expect(runProductionChapterMock).toHaveBeenCalledTimes(1)
      expect(generateChapterMock).toHaveBeenCalledWith(db, novelId, chapterIds[0], { expectedContent: '' })
      expect(progress.failed).toBe(1)
      expect(progress.currentAction).toBe('正文已修改，停止生成重试')
      expect(db.prepare('SELECT content,status,generation_token FROM chapter WHERE id=?').get(chapterIds[0])).toMatchObject({ content: '人工稿', status: 'written', generation_token: null })
      expect(callLlmJsonMock).not.toHaveBeenCalled()
    } finally { db.close() }
  })

  it('低字数重试等待期间人工保存，真实生成入口拒绝旧基线且不重新抢占', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = seedNovelWithChapters(db, 1)
    const actual = await vi.importActual<typeof import('../server/src/services/chapterGeneration/orchestrator')>('../server/src/services/chapterGeneration/orchestrator')
    generateChapterMock.mockImplementationOnce(async () => {
      db.prepare("UPDATE chapter SET content='短稿', status='written' WHERE id=?").run(chapterIds[0])
      return { ...GOOD_GENERATION, content: '短稿', wordCount: 2 }
    }).mockImplementationOnce(actual.generateChapter)
    try {
      const progress = await runProductionPipeline(db, novelId, p => {
        if (p.currentAction === '生成重试（第 1 次不达标）') db.prepare("UPDATE chapter SET content='人工稿', status='written' WHERE id=?").run(chapterIds[0])
      })
      expect(progress.failed).toBe(1)
      expect(progress.currentAction).toBe('正文已修改，停止生成重试')
      expect(generateChapterMock).toHaveBeenLastCalledWith(db, novelId, chapterIds[0], { expectedContent: '短稿' })
      expect(db.prepare('SELECT content,status,generation_token FROM chapter WHERE id=?').get(chapterIds[0])).toMatchObject({ content: '人工稿', status: 'written', generation_token: null })
      expect(callLlmJsonMock).not.toHaveBeenCalled()
    } finally { db.close() }
  })

  it('生产修复迟到不覆盖人工稿，候选落库并停止回灌', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = seedNovelWithChapters(db, 1)
    succeedWithContent(db)
    callLlmJsonMock.mockImplementation(async (_db: unknown, _t: string, _o: unknown, _p: unknown, label: string) => {
      if (label === 'production-review') return { score: 20, issues: [{ severity: 'high', problem: '矛盾', suggestion: '修改' }], needsFix: true }
      if (label === 'production-patch') {
        db.prepare('UPDATE chapter SET content=? WHERE id=?').run('人工修订', chapterIds[0])
        return { patches: [{ target: GOOD_GENERATION.content, replacement: '新'.repeat(300) }] }
      }
      if (label === 'production-rescore') return { score: 90 }
      throw new Error(`unexpected call: ${label}`)
    })
    try {
      await runProductionPipeline(db, novelId, () => {})
      expect(db.prepare('SELECT content FROM chapter WHERE id=?').get(chapterIds[0])?.content).toBe('人工修订')
      expect(db.prepare('SELECT content FROM chapter_version WHERE chapter_id=?').get(chapterIds[0])?.content).toBe('新'.repeat(300))
      expect(callLlmJsonMock.mock.calls.some(args => args[4] === 'production-backfill')).toBe(false)
    } finally { db.close() }
  })

  it('生成域报告冲突时不再重试模型或审核', async () => {
    const db = makeDb()
    const { novelId } = seedNovelWithChapters(db, 1)
    generateChapterMock.mockResolvedValue({ ...GOOD_GENERATION, persisted: false, wordCount: 1, candidateVersionId: 1 })
    try {
      const progress = await runProductionPipeline(db, novelId, () => {})
      expect(progress.failed).toBe(1)
      expect(generateChapterMock).toHaveBeenCalledTimes(1)
      expect(callLlmJsonMock).not.toHaveBeenCalled()
    } finally { db.close() }
  })

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
    generateChapterMock.mockImplementation(async (_db: DatabaseSync, _n: number, chapterId: number) => {
      // 模拟生成域的 written 落库（守卫写回依赖该状态）
      db.prepare("UPDATE chapter SET content = ?, status = 'written' WHERE id = ?").run(GOOD_GENERATION.content, chapterId)
      return GOOD_GENERATION
    })

    const progress = await runProductionPipeline(db, novelId, () => {})

    expect(progress.failed).toBe(1)
    expect(progress.done).toBe(2) // done=处理完成率（含失败章节，P20 C9）
    const failed = db.prepare('SELECT status FROM chapter WHERE id = ?').get(chapterIds[0]) as { status: string }
    const done = db.prepare('SELECT status FROM chapter WHERE id = ?').get(chapterIds[1]) as { status: string }
    expect(failed.status).toBe('failed')
    expect(done.status).toBe('reviewed')
    db.close()
  })

  it('失败置状态不覆盖 generating claim（R0-F6 守卫）', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = seedNovelWithChapters(db, 1)
    generateChapterMock.mockRejectedValue(new Error('boom'))
    // 模拟：生成失败落定前，该章已被新一轮生成抢占
    db.prepare("UPDATE chapter SET status = 'generating', generation_token = 'new-claim' WHERE id = ?").run(chapterIds[0])

    const progress = await runProductionPipeline(db, novelId, () => {})

    expect(progress.failed).toBe(1)
    const row = db.prepare('SELECT status FROM chapter WHERE id = ?').get(chapterIds[0]) as { status: string }
    expect(row.status).toBe('generating')
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
