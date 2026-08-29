// job 调度器（重构计划 R3 / spec §3.2）：只负责轮询、claim、watchdog、执行器调用与运行锁。
// 五类任务的业务循环全部在 executors.ts 注册表；本文件不含任何业务分支。
import type { DatabaseSync } from 'node:sqlite'
import { setActiveModelOverride } from '../llm'
import { isJobCancelled, isJobAborted } from '../jobQueue'
import { claimNextJob, updateClaimedJob, finishClaimedJob } from './repository'
import { resetStaleRunning } from './lifecycle'
import { parseJobPayload, JobPayloadError } from './payload'
import { EXECUTORS } from './executors'
import type { ClaimedJob } from './types'
import type { JobExecutorContext } from './executors'

// P20（M1）：watchdog 按当前 claim 回收——running 且 30 分钟无进展的 job 置 failed；
// status 一旦离开 running，旧 claim 的所有写入即被 id+claim_token+status='running' 守卫拒绝
// （活跃任务每章/阶段 progress 会刷新 updated_at，不会被误回收；v0.8.0 审查 #8）
function watchdog(db: DatabaseSync): void {
  db.prepare(
    `UPDATE job SET status = 'failed', error = 'watchdog: job stuck without progress for 30min', updated_at = datetime('now')
     WHERE status = 'running' AND started_at IS NOT NULL
       AND started_at < datetime('now', '-30 minutes')
       AND updated_at < datetime('now', '-30 minutes')`
  ).run()
}

let running = false
let active = false
let timer: ReturnType<typeof setInterval> | null = null
let dbRef: DatabaseSync

function buildContext(claim: ClaimedJob): JobExecutorContext {
  return {
    db: dbRef,
    claim,
    // 执行器在安全边界（章/阶段/步骤间）观察中止：任务取消/watchdog 回收/调度器停止
    isAborted: () => !active || isJobAborted(dbRef, claim.job.id),
    reportProgress: (patch) => updateClaimedJob(dbRef, claim, patch)
  }
}

async function dispatch(claim: ClaimedJob): Promise<void> {
  const job = claim.job
  // payload 在域边界一次 Zod 解析（R2）：损坏/不合规只失败该 job，不抛未处理 rejection
  let payload
  try {
    payload = parseJobPayload(job.type, job.payloadJson)
  } catch (err) {
    const message = err instanceof JobPayloadError ? err.message : 'corrupted payload_json (unparseable)'
    finishClaimedJob(dbRef, claim, { status: 'failed', error: message })
    return
  }

  // 运行期 type 与 payload 的对应关系由 parseJobPayload 的判别联合保证，
  // 此处分发签名收窄为 never-payload（各执行器内部按注册表键持有强类型）
  const executor = EXECUTORS[job.type as keyof typeof EXECUTORS] as
    | ((ctx: JobExecutorContext, payload: never) => Promise<void>)
    | undefined
  if (!executor) {
    finishClaimedJob(dbRef, claim, { status: 'failed', error: `unknown job type: ${job.type}` })
    return
  }

  // P13 G1：换模型重试（活动覆盖，单例执行串行安全；finally 清理防泄漏到普通请求）
  setActiveModelOverride(payload.modelOverride ?? null)
  try {
    await executor(buildContext(claim), payload as never)
  } catch (err) {
    // P20（M2）：取消是正常终止，不是失败；其余意外逃逸兜底为 failed（v0.23.1 批次 A1 双层防御）
    if (isJobCancelled(dbRef, job.id)) {
      updateClaimedJob(dbRef, claim, { status: 'cancelled' })
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    finishClaimedJob(dbRef, claim, { status: 'failed', error: message })
  } finally {
    setActiveModelOverride(null)
  }
}

function tick(): void {
  try {
    watchdog(dbRef)
    if (running || !active) return
    running = true
    try {
      // 单例调度：一次只处理一个 job（串行执行，防并发烧 token）
      const claim = claimNextJob(dbRef)
      if (claim) {
        void dispatch(claim)
          .catch((err) => {
            console.error('[scheduler] processJob unexpected error:', err)
          })
          .finally(() => {
            running = false
          })
      } else {
        running = false
      }
    } catch {
      running = false
    }
  } catch {
    /* ignore */
  }
}

// 重启幂等（修正 #3 / R2）：遗留 running job 重置 queued 并清空旧 claim token；
// 遗留 generating 章节重置 planned 并清空 generation_token（v0.17.0 H3 / R4.1）
export function startJobScheduler(db: DatabaseSync, intervalMs = 1500): void {
  dbRef = db
  resetStaleRunning(db)
  db.prepare(
    "UPDATE chapter SET status = 'planned', generation_token = NULL, updated_at = datetime('now') WHERE status = 'generating'"
  ).run()
  if (timer) clearInterval(timer)
  active = true
  timer = setInterval(tick, intervalMs)
  // 立即跑一次，处理遗留 queued 任务（重启恢复）
  tick()
}

// 清除 timer 并停止接受新 claim；当前执行器在下一安全边界经 isAborted 观察到停止
export function stopJobScheduler(): void {
  active = false
  if (timer) clearInterval(timer)
  timer = null
}

export function isJobSchedulerBusy(): boolean {
  return running
}
