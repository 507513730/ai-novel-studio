// 重构计划 R3：scheduler 恢复与故障注入——watchdog 按当前 claim 回收、
// 旧 claim 迟到失败不能覆盖新 claim、重启恢复 running→queued 清 token。
import { describe, expect, it, afterEach, vi } from 'vitest'

const { runDirectorPipelineMock } = vi.hoisted(() => ({
  runDirectorPipelineMock: vi.fn()
}))
vi.mock('../server/src/services/director', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, runDirectorPipeline: runDirectorPipelineMock }
})

import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { startScheduler, stopScheduler } from '../server/src/services/scheduler'
import { enqueueDirectorJob } from '../server/src/services/jobQueue'
import { finishClaimedJob, updateClaimedJob } from '../server/src/services/jobs/repository'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function readJob(db: DatabaseSync, jobId: number): { status: string; error: string; claim_token: string | null } {
  return db.prepare('SELECT status, error, claim_token FROM job WHERE id = ?').get(jobId) as {
    status: string
    error: string
    claim_token: string | null
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
  stopScheduler()
  runDirectorPipelineMock.mockReset()
})

describe('scheduler 恢复与故障注入（R3）', () => {
  it('watchdog 回收 30 分钟无进展的 running job；旧 claim 随后的写入被拒', async () => {
    const db = makeDb()
    const novelId = Number(
      db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试', '看门狗').lastInsertRowid
    )
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    runDirectorPipelineMock.mockImplementation(() => gate)
    const { jobId } = enqueueDirectorJob(db, novelId)

    startScheduler(db, 40)
    await sleep(80)
    // job 已被 claim（running）；把 started_at/updated_at 回拨 31 分钟模拟挂死
    db.prepare(
      "UPDATE job SET started_at = datetime('now', '-31 minutes'), updated_at = datetime('now', '-31 minutes') WHERE id = ?"
    ).run(jobId)
    await sleep(120)

    const stuck = readJob(db, jobId)
    expect(stuck.status).toBe('failed')
    expect(stuck.error).toContain('watchdog')

    // 迟到协程（旧 claim）报告完成/进度均被拒
    const staleRow = db.prepare('SELECT id, type, status, progress, payload_json, result_json, error, created_at, updated_at, started_at, claim_token FROM job WHERE id = ?').get(jobId)
    const staleClaim = { job: staleRow as never, claimToken: 'revoked-token' }
    expect(finishClaimedJob(db, staleClaim, { status: 'done', progress: 100 })).toBe(false)
    expect(updateClaimedJob(db, staleClaim, { progress: 10 })).toBe(false)
    expect(readJob(db, jobId).status).toBe('failed')

    release()
    await sleep(100)
    db.close()
  })

  it('重启恢复：遗留 running 重置 queued 清 token，随后被重新 claim 执行为 done', async () => {
    const db = makeDb()
    const novelId = Number(
      db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试', '重启恢复').lastInsertRowid
    )
    runDirectorPipelineMock.mockResolvedValue(undefined)
    const { jobId } = enqueueDirectorJob(db, novelId)

    // 模拟 kill：job 卡在 running 且持有已失效 token
    db.prepare("UPDATE job SET status = 'running', claim_token = 'dead-token', started_at = datetime('now') WHERE id = ?").run(jobId)

    startScheduler(db, 60_000)
    await sleep(150)

    const job = readJob(db, jobId)
    expect(job.status).toBe('done')
    expect(job.claim_token).not.toBe('dead-token')
    expect(job.claim_token).not.toBeNull()
    db.close()
  })

  it('watchdog 回收后重排队：claim B 重新执行，claim A 迟到失败不能覆盖 B', async () => {
    const db = makeDb()
    const novelId = Number(
      db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试', '迟到协程').lastInsertRowid
    )
    // 第一代执行者挂死（可控放行），第二代立即完成
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    runDirectorPipelineMock.mockImplementationOnce(() => gate)
    runDirectorPipelineMock.mockResolvedValueOnce(undefined)
    const { jobId } = enqueueDirectorJob(db, novelId)

    startScheduler(db, 40)
    await sleep(80)
    // claim A 执行中回拨时间戳 → watchdog 回收
    db.prepare(
      "UPDATE job SET started_at = datetime('now', '-31 minutes'), updated_at = datetime('now', '-31 minutes') WHERE id = ?"
    ).run(jobId)
    await sleep(150)
    expect(readJob(db, jobId).status).toBe('failed')

    // 放行挂死协程（其收尾将被守卫拒绝），等待运行锁释放
    release()
    await sleep(150)

    // 重排队（retry 语义：queued + 清 token）→ 下一 tick claim B 重新执行
    db.prepare("UPDATE job SET status = 'queued', progress = 0, error = '', claim_token = NULL WHERE id = ?").run(jobId)
    await sleep(200)
    expect(readJob(db, jobId).status).toBe('done')

    // claim A 迟到失败不得覆盖 claim B 的 done
    const lateRow = db
      .prepare(
        'SELECT id, type, status, progress, payload_json, result_json, error, created_at, updated_at, started_at, claim_token FROM job WHERE id = ?'
      )
      .get(jobId)
    const lateClaim = { job: lateRow as never, claimToken: 'old-claim-a-token' }
    expect(finishClaimedJob(db, lateClaim, { status: 'failed', error: 'claim A 迟到失败' })).toBe(false)

    const job = readJob(db, jobId)
    expect(job.status).toBe('done')
    expect(job.error).not.toContain('claim A')
    db.close()
  })
})
