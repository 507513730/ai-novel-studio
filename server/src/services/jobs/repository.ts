// job 仓储（重构计划 R2 / spec §3.2）：入队、抢占、更新、收尾的唯一数据访问入口。
// 行映射统一 camelCase；上层禁止接触 snake_case 行类型。
import { DatabaseSync } from 'node:sqlite'
import { markRunning, applyPatchToClaimed, completeClaimed } from './lifecycle'
import type { ClaimedJob, JobPatch, JobRecord } from './types'

interface JobRow {
  id: number
  type: string
  status: string
  progress: number
  payload_json: string
  result_json: string
  error: string
  created_at: string
  updated_at: string
  started_at: string | null
  claim_token: string | null
}

function mapJobRow(row: unknown): JobRecord {
  const r = row as JobRow
  return {
    id: Number(r.id),
    type: r.type,
    status: r.status,
    progress: Number(r.progress),
    payloadJson: r.payload_json,
    resultJson: r.result_json,
    error: r.error ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at ?? null,
    claimToken: r.claim_token ?? null
  }
}

const JOB_COLUMNS =
  'id, type, status, progress, payload_json, result_json, error, created_at, updated_at, started_at, claim_token'

// 原子抢占：取最旧 queued job 置 running 并绑定本次 claim token（每次 claim 唯一）。
// SELECT 与 markRunning 两步在并发下可能竞争同一行——守卫使后者败方 changes=0，返回 null 即可。
export function claimNextJob(db: DatabaseSync): ClaimedJob | null {
  const candidate = db
    .prepare(
      `SELECT id FROM job WHERE status = 'queued' ORDER BY id LIMIT 1`
    )
    .get() as { id: number } | undefined
  if (!candidate) return null

  let token: string
  try {
    token = markRunning(db, candidate.id)
  } catch {
    return null
  }
  const row = db.prepare(`SELECT ${JOB_COLUMNS} FROM job WHERE id = ?`).get(candidate.id)
  return { job: mapJobRow(row), claimToken: token }
}

// 运行态中途更新（进度/trace）。守卫失配（旧 claim / 非 running）返回 false，调用方应停止写入。
export function updateClaimedJob(db: DatabaseSync, claimed: ClaimedJob, patch: JobPatch): boolean {
  return applyPatchToClaimed(db, claimed.job.id, claimed.claimToken, patch)
}

// 收尾：done/failed + 最终进度/结果。守卫失配返回 false——取消/watchdog 终态不被覆盖（P20 M2/C1）。
export function finishClaimedJob(
  db: DatabaseSync,
  claimed: ClaimedJob,
  final: { status: 'done' | 'failed'; progress?: number; resultJson?: string; error?: string }
): boolean {
  return completeClaimed(db, claimed.job.id, claimed.claimToken, final)
}

// ---------- 入队（原子查重：同类型 + json_extract('$.novelId') 精确匹配 + 活跃态） ----------

export interface EnqueueResult {
  jobId: number
}

export function enqueueDirectorJob(
  db: DatabaseSync,
  novelId: number,
  opts: { mode?: 'auto' | 'supervised'; chaptersPerVolume?: number } = {}
): EnqueueResult | { conflict: true } {
  const result = db
    .prepare(
      `INSERT INTO job (type, status, progress, payload_json)
       SELECT 'director', 'queued', 0, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM job
         WHERE type = 'director' AND status IN ('queued','running')
           AND json_extract(payload_json, '$.novelId') = ?
       )`
    )
    .run(
      JSON.stringify({
        novelId,
        mode: opts.mode ?? 'auto',
        chaptersPerVolume: opts.chaptersPerVolume ?? 20
      }),
      novelId
    )
  if (Number(result.changes) === 0) return { conflict: true }
  return { jobId: Number(result.lastInsertRowid) }
}

export function enqueueProductionJob(
  db: DatabaseSync,
  novelId: number,
  range?: { from: number; to: number }
): EnqueueResult | { conflict: true } {
  const result = db
    .prepare(
      `INSERT INTO job (type, status, progress, payload_json)
       SELECT 'production', 'queued', 0, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM job
         WHERE type = 'production' AND status IN ('queued','running')
           AND json_extract(payload_json, '$.novelId') = ?
       )`
    )
    .run(
      JSON.stringify({ novelId, ...(range ? { from: range.from, to: range.to } : {}) }),
      novelId
    )
  if (Number(result.changes) === 0) return { conflict: true }
  return { jobId: Number(result.lastInsertRowid) }
}

// v0.10.0（批B/I2）/ R5：质量债修复入队（automation 路由与 production 收尾共用，消除两处复制 SQL）
export function enqueueDebtFixJob(db: DatabaseSync, novelId: number): EnqueueResult | { conflict: true } {
  const result = db
    .prepare(
      `INSERT INTO job (type, status, progress, payload_json)
       SELECT 'debt-fix', 'queued', 0, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM job WHERE type = 'debt-fix' AND status IN ('queued','running')
           AND json_extract(payload_json, '$.novelId') = ?
       )`
    )
    .run(JSON.stringify({ novelId }), novelId)
  if (Number(result.changes) === 0) return { conflict: true }
  return { jobId: Number(result.lastInsertRowid) }
}

export function enqueueTypedJob(
  db: DatabaseSync,
  type: 'refine-range' | 'solution-chapter',
  payload: Record<string, unknown> & { novelId: number }
): EnqueueResult | { conflict: true } {
  const result = db
    .prepare(
      `INSERT INTO job (type, status, progress, payload_json)
       SELECT ?, 'queued', 0, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM job
         WHERE type = ? AND status IN ('queued','running')
           AND json_extract(payload_json, '$.novelId') = ?
       )`
    )
    .run(type, JSON.stringify(payload), type, payload.novelId)
  if (Number(result.changes) === 0) return { conflict: true }
  return { jobId: Number(result.lastInsertRowid) }
}

// ---------- 取消/中止感知（原 jobQueue.ts 读助手迁移，R9.2） ----------
// P20（M2/C1）：运行中任务取消感知（导演/生产循环每阶段/每章检查）
export function isJobCancelled(db: DatabaseSync, jobId: number): boolean {
  const row = db.prepare('SELECT status FROM job WHERE id = ?').get(jobId) as { status: string } | undefined
  return row?.status === 'cancelled'
}

// v0.8.0（审查 #8）：执行中止感知——取消（cancelled）或 watchdog 超时回收（failed + watchdog: 前缀）都中止
// watchdog 只改状态不中止执行 → 此前"假 failed"后流水线继续写库；现在每章/阶段边界自检后退出
export function isJobAborted(db: DatabaseSync, jobId: number): boolean {
  const row = db
    .prepare('SELECT status, error FROM job WHERE id = ?')
    .get(jobId) as { status: string; error: string } | undefined
  if (!row) return true // 行不存在（被清理）＝视为中止
  if (row.status === 'cancelled') return true
  return row.status === 'failed' && String(row.error).startsWith('watchdog:')
}
