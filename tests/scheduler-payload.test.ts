// v0.23.1（批次 A1）：scheduler 损坏 payload 防御——JSON.parse 在 try 外抛出 + tick 无 .catch
// 此前会成为未处理 rejection（Node 默认 crash 进程）；修复后 job 应被置 failed 而进程存活
import { describe, expect, it, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { startJobScheduler, stopJobScheduler } from '../server/src/services/jobs/scheduler'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

afterEach(() => {
  stopJobScheduler()
})

describe('scheduler 损坏 payload 防御（批次 A1）', () => {
  it('payload_json 损坏的 job 被置 failed，不产生未处理 rejection', async () => {
    const db = makeDb()
    db.prepare(
      "INSERT INTO job (type, status, progress, payload_json, result_json, error, created_at, updated_at) VALUES ('director', 'queued', 0, '{corrupted!!!', '{}', '', datetime('now'), datetime('now'))"
    ).run()
    const jobId = (db.prepare('SELECT id FROM job LIMIT 1').get() as { id: number }).id

    // 未处理 rejection 会让 vitest 直接报错（unhandled rejection 监听）
    startJobScheduler(db, 60_000) // 启动即 tick 一次：claim → processJob → 损坏 payload 路径
    await new Promise((r) => setTimeout(r, 50))

    const row = db.prepare('SELECT status, error FROM job WHERE id = ?').get(jobId) as {
      status: string
      error: string
    }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('corrupted payload_json')
  })

  it('合法但未知类型的 job 仍走 unknown type 失败路径', async () => {
    const db = makeDb()
    db.prepare(
      "INSERT INTO job (type, status, progress, payload_json, result_json, error, created_at, updated_at) VALUES ('mystery-type', 'queued', 0, '{\"novelId\":1}', '{}', '', datetime('now'), datetime('now'))"
    ).run()

    startJobScheduler(db, 60_000)
    await new Promise((r) => setTimeout(r, 50))

    const row = db.prepare('SELECT status, error FROM job LIMIT 1').get() as {
      status: string
      error: string
    }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('unknown job type')
  })
})
