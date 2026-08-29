// 重构计划 R3：scheduler 生命周期契约——取消终态不被 done 覆盖、全部失败不虚报 done、
// 意外异常逃逸兜底 failed 且进程存活、stopJobScheduler 后不再产生新 claim。
import { describe, expect, it, afterEach, vi } from 'vitest'

const { runDirectorPipelineMock, runProductionPipelineMock } = vi.hoisted(() => ({
  runDirectorPipelineMock: vi.fn(),
  runProductionPipelineMock: vi.fn()
}))
vi.mock('../server/src/services/director/pipeline', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, runDirectorPipeline: runDirectorPipelineMock }
})
vi.mock('../server/src/services/production/pipeline', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, runProductionPipeline: runProductionPipelineMock }
})

import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { startJobScheduler, stopJobScheduler } from '../server/src/services/jobs/scheduler'
import { enqueueDirectorJob, enqueueProductionJob, enqueueTypedJob } from '../server/src/services/jobs/repository'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function seedNovel(db: DatabaseSync): number {
  return Number(
    db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试', '调度器生命周期').lastInsertRowid
  )
}

function readJob(db: DatabaseSync, jobId: number): { status: string; error: string } {
  return db.prepare('SELECT status, error FROM job WHERE id = ?').get(jobId) as { status: string; error: string }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
  stopJobScheduler()
  runDirectorPipelineMock.mockReset()
  runProductionPipelineMock.mockReset()
})

describe('scheduler 生命周期（R3）', () => {
  it('取消后执行器收尾 done 被守卫拒绝——取消终态不被覆盖（P20 C1）', async () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    runDirectorPipelineMock.mockImplementation(async () => {
      // 执行中取消（导演循环外用户操作），随后管线正常结束
      await sleep(150)
    })
    const { jobId } = enqueueDirectorJob(db, novelId)

    startJobScheduler(db, 60_000)
    await sleep(60)
    db.prepare("UPDATE job SET status = 'cancelled' WHERE id = ?").run(jobId)
    await sleep(250)

    expect(readJob(db, jobId).status).toBe('cancelled')
    db.close()
  })

  it('production 全部章节失败 → job failed，不虚报 done（v0.24.3）', async () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    runProductionPipelineMock.mockResolvedValue({ total: 3, done: 0, failed: 3, qualityDebts: 0 })
    const { jobId } = enqueueProductionJob(db, novelId)

    startJobScheduler(db, 60_000)
    await sleep(120)

    const job = readJob(db, jobId)
    expect(job.status).toBe('failed')
    expect(job.error).toContain('全部章节失败')
    db.close()
  })

  it('执行器异常逃逸 → job failed 且调度器存活（下一 tick 仍可消费）', async () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    runDirectorPipelineMock.mockRejectedValueOnce(new Error('管线意外崩溃'))
    runDirectorPipelineMock.mockResolvedValueOnce(undefined)
    const first = enqueueDirectorJob(db, novelId)
    const second = enqueueDirectorJob(db, novelId + 1000)
    if (!('jobId' in first) || !('jobId' in second)) throw new Error('enqueue conflict unexpectedly')

    startJobScheduler(db, 40)
    await sleep(400)

    expect(readJob(db, first.jobId).status).toBe('failed')
    expect(readJob(db, first.jobId).error).toContain('管线意外崩溃')
    expect(readJob(db, second.jobId).status).toBe('done')
    db.close()
  })

  it('stopJobScheduler 后不再产生新 claim（queued 任务保持排队）', async () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    runDirectorPipelineMock.mockResolvedValue(undefined)
    const { jobId } = enqueueDirectorJob(db, novelId)

    startJobScheduler(db, 60_000)
    await sleep(100)
    stopJobScheduler()

    const later = enqueueTypedJob(db, 'refine-range', { novelId, from: 0, to: 0 })
    expect('jobId' in later).toBe(true)
    await sleep(120)
    expect(readJob(db, later.jobId as number).status).toBe('queued')

    // 重启后恢复消费
    startJobScheduler(db, 60_000)
    await sleep(150)
    expect(readJob(db, later.jobId as number).status).toBe('done')
    expect(readJob(db, jobId).status).toBe('done')
    db.close()
  })
})
