// 重构计划 R2：job 仓储契约——原子抢占 + claim token 唯一性、迟到协程拒绝、
// camelCase 行映射、json_extract novelId 精确查重（禁止 LIKE 前缀误伤，AGENTS #26）。
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { claimNextJob, updateClaimedJob, finishClaimedJob } from '../server/src/services/jobs/repository'
import { resetStaleRunning } from '../server/src/services/jobs/lifecycle'
import { enqueueDirectorJob } from '../server/src/services/jobQueue'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function insertJob(db: DatabaseSync, type: string, payload: Record<string, unknown>, status = 'queued'): number {
  const result = db
    .prepare(
      `INSERT INTO job (type, status, progress, payload_json) VALUES (?, ?, 0, ?)`
    )
    .run(type, status, JSON.stringify(payload))
  return Number(result.lastInsertRowid)
}

describe('claimNextJob', () => {
  it('抢占最旧 queued job：置 running + 记 started_at + 颁发唯一 claim token', () => {
    const db = makeDb()
    const first = insertJob(db, 'director', { novelId: 1 })
    const second = insertJob(db, 'director', { novelId: 2 })

    const claimed = claimNextJob(db)
    expect(claimed).not.toBeNull()
    expect(claimed!.job.id).toBe(first)
    expect(claimed!.job.status).toBe('running')
    expect(claimed!.claimToken).toBeTruthy()
    expect(claimed!.job.startedAt).toBeTruthy()
    expect(claimed!.job.claimToken).toBe(claimed!.claimToken)
    // camelCase 映射：不散布 snake_case 字段
    expect(claimed!.job.payloadJson).toBe('{"novelId":1}')

    // 第二次抢占拿到下一条，token 不同
    const claimed2 = claimNextJob(db)
    expect(claimed2!.job.id).toBe(second)
    expect(claimed2!.claimToken).not.toBe(claimed!.claimToken)
    db.close()
  })

  it('无 queued job 时返回 null；迟到协程（旧 token）的更新被拒绝', () => {
    const db = makeDb()
    expect(claimNextJob(db)).toBeNull()

    const id = insertJob(db, 'production', { novelId: 1 })
    const claimed = claimNextJob(db)!
    // 模拟迟到协程：用伪造旧 token 更新 → false，数据不变
    const stale = updateClaimedJob(db, { job: claimed.job, claimToken: 'stale-token' }, { progress: 50 })
    expect(stale).toBe(false)
    const row = db.prepare('SELECT progress FROM job WHERE id = ?').get(id) as { progress: number }
    expect(row.progress).toBe(0)
    db.close()
  })

  it('正确 claim token 可更新进度；收尾后再次收尾被拒（终态不被覆盖）', () => {
    const db = makeDb()
    insertJob(db, 'debt-fix', { novelId: 1 })
    const claimed = claimNextJob(db)!

    expect(updateClaimedJob(db, claimed, { progress: 40 })).toBe(true)
    expect(finishClaimedJob(db, claimed, { status: 'done', progress: 100 })).toBe(true)

    const row = db.prepare('SELECT status, progress FROM job WHERE id = ?').get(claimed.job.id) as {
      status: string
      progress: number
    }
    expect(row.status).toBe('done')
    expect(row.progress).toBe(100)
    expect(finishClaimedJob(db, claimed, { status: 'done', progress: 100 })).toBe(false)
    db.close()
  })

  it('watchdog 式置 failed 后，原 claim 的 done 收尾被拒（不虚报完成）', () => {
    const db = makeDb()
    insertJob(db, 'production', { novelId: 1 })
    const claimed = claimNextJob(db)!
    // watchdog：绕过 claim 直接置 failed（30 分钟无进展回收）
    db.prepare("UPDATE job SET status = 'failed', error = 'watchdog: stuck' WHERE id = ?").run(claimed.job.id)

    expect(finishClaimedJob(db, claimed, { status: 'done', progress: 100 })).toBe(false)
    const row = db.prepare('SELECT status, error FROM job WHERE id = ?').get(claimed.job.id) as {
      status: string
      error: string
    }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('watchdog')
    db.close()
  })

  it('重启恢复：遗留 running 重置 queued 并清空 claim token', () => {
    const db = makeDb()
    const id = insertJob(db, 'director', { novelId: 1 }, 'running')
    db.prepare("UPDATE job SET claim_token = 'orphan-token', started_at = datetime('now') WHERE id = ?").run(id)

    resetStaleRunning(db)

    const row = db.prepare('SELECT status, claim_token FROM job WHERE id = ?').get(id) as {
      status: string
      claim_token: string | null
    }
    expect(row.status).toBe('queued')
    expect(row.claim_token).toBeNull()
    db.close()
  })
})

describe('job 入队查重（json_extract novelId 精确匹配）', () => {
  it('novelId 12 与 123 不互相误伤（LIKE 前缀匹配回归）', () => {
    const db = makeDb()
    const first = enqueueDirectorJob(db, 12)
    expect('jobId' in first).toBe(true)
    const conflicting = enqueueDirectorJob(db, 12)
    expect('conflict' in conflicting).toBe(true)
    const other = enqueueDirectorJob(db, 123)
    expect('jobId' in other).toBe(true)
    db.close()
  })
})
