import { DatabaseSync } from 'node:sqlite'
import { runDirectorPipeline } from './director'
import { runProductionPipeline, type ProductionProgress } from './production'
import { setActiveModelOverride } from './llm'
import { isJobCancelled } from './jobQueue'

// ============================================================
// 执行面隔离（PLAN 修正 #2 / P2）
// 独立 Scheduler 轮询 job 表：Web API 只下发命令（POST /jobs），
// 重型链路（导演/整本生产）在调度循环中执行，不阻塞普通 API
// ============================================================

// P20（M1）：job 看门狗超时（超过该时长强制回收，防挂死 job 永久瘫痪调度器）
const JOB_TIMEOUT_MS = 30 * 60 * 1000

export interface JobRecord {
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
}

interface JobPayload {
  novelId: number
  mode?: 'auto' | 'supervised'
  chaptersPerVolume?: number
  modelOverride?: string
  from?: number
  to?: number
}

let running = false
let timer: ReturnType<typeof setInterval> | null = null

function claimNextJob(db: DatabaseSync): JobRecord | null {
  const row = db
    .prepare(
      `UPDATE job SET status = 'running', started_at = datetime('now'), updated_at = datetime('now')
       WHERE id = (SELECT id FROM job WHERE status = 'queued' ORDER BY id LIMIT 1)
       RETURNING id, type, status, progress, payload_json, result_json, error, created_at, updated_at, started_at`
    )
    .get() as JobRecord | undefined
  return row ?? null
}

// P20（M1）：看门狗——运行中且超时的 job 强制 failed（scheduler 恢复依赖其 finally 复位）
function watchdog(db: DatabaseSync): void {
  db.prepare(
    `UPDATE job SET status = 'failed', error = 'watchdog: job exceeded 30min', updated_at = datetime('now')
     WHERE status = 'running' AND started_at IS NOT NULL AND started_at < datetime('now', '-30 minutes')`
  ).run()
}

// P20（M2/C1）：结束 job 时尊重外部标记（cancelled/failed 不被覆盖为 done）
function finishJob(
  db: DatabaseSync,
  jobId: number,
  final: { progress?: number; resultJson?: string; error?: string; status?: string }
): void {
  const cur = db.prepare('SELECT status FROM job WHERE id = ?').get(jobId) as { status: string } | undefined
  if (cur && (cur.status === 'cancelled' || cur.status === 'failed')) return
  updateJob(db, jobId, final)
}

function updateJob(
  db: DatabaseSync,
  jobId: number,
  patch: { progress?: number; resultJson?: string; error?: string; status?: string }
): void {
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
  if (sets.length === 0) return
  db.prepare(`UPDATE job SET ${sets.join(', ')} WHERE id = ?`).run(...params, jobId)
}

async function processJob(db: DatabaseSync, job: JobRecord): Promise<void> {
  const payload = JSON.parse(job.payload_json) as JobPayload
  // P13 G1：换模型重试（活动覆盖，单例执行串行安全）
  setActiveModelOverride(payload.modelOverride ?? null)
  try {
    if (job.type === 'director') {
      await runDirectorPipeline(db, payload.novelId, payload.mode ?? 'auto', {
        chaptersPerVolume: payload.chaptersPerVolume ?? 20,
        jobId: job.id
      })
      finishJob(db, job.id, { progress: 100, status: 'done', resultJson: '{"ok":true}' })
    } else if (job.type === 'production') {
      await runProductionPipeline(
        db,
        payload.novelId,
        (p: ProductionProgress) => {
          // P20（C9）：进度含失败章节（处理完成率而非成功率）
          const ratio = p.total > 0 ? Math.round(((p.done + p.failed) / p.total) * 100) : 100
          updateJob(db, job.id, {
            progress: ratio,
            resultJson: JSON.stringify({
              current: p.currentChapter,
              action: p.currentAction,
              done: p.done,
              total: p.total,
              failed: p.failed,
              qualityDebts: p.qualityDebts
            })
          })
        },
        { from: payload.from, to: payload.to, jobId: job.id }
      )
      finishJob(db, job.id, { progress: 100, status: 'done' })
    } else {
      updateJob(db, job.id, { status: 'failed', error: `unknown job type: ${job.type}` })
    }
  } catch (err) {
    // P20（M2）：取消是正常终止，不是失败
    if (isJobCancelled(db, job.id)) {
      updateJob(db, job.id, { status: 'cancelled' })
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    updateJob(db, job.id, { status: 'failed', error: message })
  } finally {
    setActiveModelOverride(null)
  }
}

function tick(): void {
  try {
    // P20（M1）：看门狗每次 tick 巡检（不依赖 running 标志）
    watchdog(dbRef)
    if (running) return
    running = true
    try {
      // 单例调度：一次只处理一个 job（串行执行，防并发烧 token）
      const job = claimNextJob(dbRef)
      if (job) {
        void processJob(dbRef, job).finally(() => {
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

let dbRef: DatabaseSync

export function startScheduler(db: DatabaseSync, intervalMs = 1500): void {
  dbRef = db
  // 重启幂等（修正 #3）：遗留 running job 重置为 queued（进程被杀后状态残留）
  db.prepare(
    "UPDATE job SET status = 'queued', updated_at = datetime('now') WHERE status = 'running'"
  ).run()
  if (timer) clearInterval(timer)
  timer = setInterval(tick, intervalMs)
  // 立即跑一次，处理遗留 queued 任务（重启恢复）
  tick()
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function isSchedulerBusy(): boolean {
  return running
}

export { JOB_TIMEOUT_MS }
