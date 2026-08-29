// 重构计划 R2：job 生命周期契约——合法转换（queued→running→done|failed|cancelled、
// queued→cancelled）、终态不可取消、守卫失配（迟到协程）拒绝。
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { markRunning, applyPatchToClaimed, completeClaimed, cancelActiveJob } from '../server/src/services/jobs/lifecycle'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function insertJob(db: DatabaseSync, status: string): number {
  const result = db
    .prepare(`INSERT INTO job (type, status, progress, payload_json) VALUES ('director', ?, 0, '{"novelId":1}')`)
    .run(status)
  return Number(result.lastInsertRowid)
}

describe('job 生命周期', () => {
  it('queued → running：markRunning 颁发 token；二次 markRunning 同行被拒', () => {
    const db = makeDb()
    const id = insertJob(db, 'queued')

    const token = markRunning(db, id)
    expect(token).toBeTruthy()
    const row = db.prepare('SELECT status, claim_token FROM job WHERE id = ?').get(id) as {
      status: string
      claim_token: string
    }
    expect(row.status).toBe('running')
    expect(row.claim_token).toBe(token)

    expect(() => markRunning(db, id)).toThrow(/不处于可抢占状态/)
    db.close()
  })

  it('queued → cancelled：合法；done → cancelled：拒绝（终态不可取消）', () => {
    const db = makeDb()
    const queuedId = insertJob(db, 'queued')
    const doneId = insertJob(db, 'done')

    expect(cancelActiveJob(db, queuedId)).toBe(true)
    expect((db.prepare('SELECT status FROM job WHERE id = ?').get(queuedId) as { status: string }).status).toBe(
      'cancelled'
    )
    expect(cancelActiveJob(db, doneId)).toBe(false)
    db.close()
  })

  it('running → cancelled：合法（用户取消运行中任务）', () => {
    const db = makeDb()
    const id = insertJob(db, 'queued')
    const token = markRunning(db, id)

    expect(cancelActiveJob(db, id)).toBe(true)
    // 取消后原 claim 的收尾被拒——取消终态不被覆盖（P20 C1）
    expect(completeClaimed(db, id, token, { status: 'done' })).toBe(false)
    db.close()
  })

  it('running → done|failed：completeClaimed 守卫（错误 token 拒绝）', () => {
    const db = makeDb()
    const id = insertJob(db, 'queued')
    const token = markRunning(db, id)

    expect(completeClaimed(db, id, 'wrong-token', { status: 'done' })).toBe(false)
    expect(completeClaimed(db, id, token, { status: 'failed', error: 'boom' })).toBe(true)
    const row = db.prepare('SELECT status, error FROM job WHERE id = ?').get(id) as {
      status: string
      error: string
    }
    expect(row.status).toBe('failed')
    expect(row.error).toBe('boom')
    db.close()
  })

  it('applyPatchToClaimed：running 态可更新进度；状态不再 running 后拒绝', () => {
    const db = makeDb()
    const id = insertJob(db, 'queued')
    const token = markRunning(db, id)

    expect(applyPatchToClaimed(db, id, token, { progress: 25 })).toBe(true)
    db.prepare("UPDATE job SET status = 'cancelled' WHERE id = ?").run(id)
    expect(applyPatchToClaimed(db, id, token, { progress: 50 })).toBe(false)
    const row = db.prepare('SELECT progress FROM job WHERE id = ?').get(id) as { progress: number }
    expect(row.progress).toBe(25)
    db.close()
  })
})
