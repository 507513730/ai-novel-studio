// job 生命周期（重构计划 R2 / spec §4.2）：合法转换的唯一事实源。
//   queued → running（claim，生成唯一 claim_token）
//   running → done | failed | cancelled
//   queued → cancelled
// 所有运行态写入以 id + claim_token + status='running' 为守卫——迟到协程（旧 token
// 或已被 watchdog/取消改变状态）的写入 changes=0，天然拒绝，不会覆盖新 claim 或终态。
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { JobPatch, JobStatus } from './types'

// queued → running：生成并写入本次 claim 的 token
export function markRunning(db: DatabaseSync, jobId: number): string {
  const token = randomUUID()
  const result = db
    .prepare(
      `UPDATE job SET status = 'running', started_at = datetime('now'), updated_at = datetime('now'), claim_token = ?
       WHERE id = ? AND status = 'queued'`
    )
    .run(token, jobId)
  if (Number(result.changes) !== 1) throw new Error(`job ${jobId} 不处于可抢占状态（queued）`)
  return token
}

// running 态的中途更新（进度/trace/状态）。守卫失配返回 false（迟到协程）。
export function applyPatchToClaimed(
  db: DatabaseSync,
  jobId: number,
  claimToken: string,
  patch: JobPatch
): boolean {
  const sets: string[] = []
  const params: Array<string | number> = []
  if (patch.progress !== undefined) {
    sets.push('progress = ?')
    params.push(patch.progress)
  }
  if (patch.resultJson !== undefined) {
    sets.push('result_json = ?')
    params.push(patch.resultJson)
  }
  if (patch.error !== undefined) {
    sets.push('error = ?')
    params.push(patch.error)
  }
  if (patch.status !== undefined) {
    sets.push('status = ?')
    params.push(patch.status)
  }
  sets.push("updated_at = datetime('now')")
  const result = db
    .prepare(
      `UPDATE job SET ${sets.join(', ')} WHERE id = ? AND claim_token = ? AND status = 'running'`
    )
    .run(...params, jobId, claimToken)
  return Number(result.changes) > 0
}

// running → 终态（done/failed）。守卫即"终态不被覆盖"语义（P20 M2/C1）：
// job 已被取消/watchdog 置 failed 后 status != 'running'，写入被拒。
export function completeClaimed(
  db: DatabaseSync,
  jobId: number,
  claimToken: string,
  final: { status: Extract<JobStatus, 'done' | 'failed'>; progress?: number; resultJson?: string; error?: string }
): boolean {
  return applyPatchToClaimed(db, jobId, claimToken, { ...final })
}

// queued|running → cancelled（用户取消不受 claim 限制，但终态不可取消）
export function cancelActiveJob(db: DatabaseSync, jobId: number): boolean {
  const result = db
    .prepare(
      "UPDATE job SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status IN ('queued','running')"
    )
    .run(jobId)
  return Number(result.changes) > 0
}

// 重启恢复：遗留 running（进程被杀，claim 已失效）重置 queued 并清空 token。
export function resetStaleRunning(db: DatabaseSync): void {
  db.prepare(
    "UPDATE job SET status = 'queued', claim_token = NULL, updated_at = datetime('now') WHERE status = 'running'"
  ).run()
}
