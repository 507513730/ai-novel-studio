import { DatabaseSync } from 'node:sqlite'
import { runDirectorPipeline } from './director'
import { runProductionPipeline, type ProductionProgress } from './production'
import { fixAllDebts } from './debtFix'
import { setActiveModelOverride } from './llm'
import { isJobCancelled, isJobAborted } from './jobQueue'
// v0.23.1（批次 D）：refine-range / solution-chapter 两个迁入 job 队列的重型端点
import { refineOne } from './planner'
import { runProductionChapter } from './solutionRunner'

// ============================================================
// 执行面隔离（PLAN 修正 #2 / P2）
// 独立 Scheduler 轮询 job 表：Web API 只下发命令（POST /jobs），
// 重型链路（导演/整本生产）在调度循环中执行，不阻塞普通 API
// ============================================================

// P20（M1）：job 看门狗——运行中且超 30 分钟无进展的 job 强制回收（防挂死 job 永久瘫痪调度器；
// v0.23.1 批次 B6：删除从未被消费的 JOB_TIMEOUT_MS 导出，时长以 watchdog SQL 的 '-30 minutes' 为准）

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
  // v0.23.1（批次 D）：迁入 job 队列的两个重型端点的载荷字段
  chapterId?: number
  solutionId?: number
}

// v0.20.0（NovelClaw 学习组）：运行轨迹——每次进度回调追加时间线（保留最新 300 条）
const TRACE_LIMIT = 300

function traceAppend(db: DatabaseSync, jobId: number, state: Record<string, unknown>): Record<string, unknown> {
  const row = db.prepare('SELECT result_json FROM job WHERE id = ?').get(jobId) as
    | { result_json: string }
    | undefined
  let prev: { trace?: Array<{ at: string; done: number; total: number; chapter: string; action: string }> } = {}
  try {
    prev = row ? JSON.parse(row.result_json || '{}') : {}
  } catch {
    prev = {}
  }
  const trace = prev.trace ?? []
  const last = trace[trace.length - 1]
  // 去重：同章节同动作不重复追加（防高频刷屏）
  if (last && last.chapter === String(state.current ?? '') && last.action === String(state.action ?? '')) {
    return { ...state, trace }
  }
  trace.push({
    at: new Date().toISOString().slice(11, 19),
    chapter: String(state.current ?? ''),
    action: String(state.action ?? ''),
    done: Number(state.done ?? 0),
    total: Number(state.total ?? 0)
  })
  if (trace.length > TRACE_LIMIT) trace.splice(0, trace.length - TRACE_LIMIT)
  return { ...state, trace }
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

// P20（M1）：看门狗——运行中且无进展超时的 job 强制 failed。
// v0.8.0（审查 #8）：以 updated_at 活跃度判定（每章 progress 回调会刷新 updated_at）——
// 活跃任务不会被误回收；只有真挂死（30 分钟无任何进展）才回收，且 processJob
// 通过 isJobAborted 在章节边界自检后停止继续写库
function watchdog(db: DatabaseSync): void {
  db.prepare(
    `UPDATE job SET status = 'failed', error = 'watchdog: job stuck without progress for 30min', updated_at = datetime('now')
     WHERE status = 'running' AND started_at IS NOT NULL
       AND started_at < datetime('now', '-30 minutes')
       AND updated_at < datetime('now', '-30 minutes')`
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
  // v0.23.1（批次 A1）：payload 解析移入防御——损坏的 payload_json 此前在 try 块外抛出，
  // 叠加 tick 的 void 链无 .catch 会成为未处理 rejection（Node 默认 crash 整个 server 进程）
  let payload: JobPayload
  try {
    payload = JSON.parse(job.payload_json) as JobPayload
  } catch {
    updateJob(db, job.id, { status: 'failed', error: 'corrupted payload_json (unparseable)' })
    return
  }
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
      const prodResult = await runProductionPipeline(
        db,
        payload.novelId,
        (p: ProductionProgress) => {
          // P20（C9）：进度含失败章节（处理完成率而非成功率）
          const ratio = p.total > 0 ? Math.round(((p.done + p.failed) / p.total) * 100) : 100
          updateJob(db, job.id, {
            progress: ratio,
            resultJson: JSON.stringify(traceAppend(db, job.id, {
              current: p.currentChapter,
              action: p.currentAction,
              done: p.done,
              total: p.total,
              failed: p.failed,
              qualityDebts: p.qualityDebts
            }))
          })
        },
        { from: payload.from, to: payload.to, jobId: job.id }
      )
      // v0.24.3（写书实战纠错）：全部章节失败时 job 不得虚报 done——
      // 任务 28 全 18 章失败仍显示"完成"，用户无从察觉（finishJob 的 final.status 覆盖默认 done）
      if (prodResult.total > 0 && prodResult.done === 0 && prodResult.failed >= prodResult.total) {
        finishJob(db, job.id, {
          progress: 100,
          status: 'failed',
          error: `生产结束但全部章节失败（${prodResult.failed}/${prodResult.total}）——多为模型/网络级故障，请检查模型路由与 API Key 后重试`
        })
      } else {
        finishJob(db, job.id, { progress: 100, status: 'done' })
      }
    } else if (job.type === 'debt-fix') {
      // v0.10.0（批B/I2）：质量债自动修复（每章内部自限轮次，串行执行）
      await fixAllDebts(
        db,
        payload.novelId,
        (done, total, current, action) => {
          const ratio = total > 0 ? Math.round((done / total) * 100) : 100
          updateJob(db, job.id, {
            progress: ratio,
            resultJson: JSON.stringify(traceAppend(db, job.id, { current, action, done, total }))
          })
        }
      )
      finishJob(db, job.id, { progress: 100, status: 'done' })
    } else if (job.type === 'refine-range') {
      // v0.23.1（批次 D2）：批量细化迁 job（此前 HTTP 请求内循环逐章 LLM）——
      // 幂等续跑语义保留（goal_json 已有 purpose 的章节跳过）；章间检查中止（取消/看门狗）
      const rows = db
        .prepare(
          `SELECT id, title, summary, goal_json FROM chapter
           WHERE novel_id = ? AND id BETWEEN ? AND ?
           ORDER BY id`
        )
        .all(payload.novelId, Number(payload.from ?? 0), Number(payload.to ?? 0)) as Array<{
        id: number
        title: string
        summary: string
        goal_json: string
      }>
      const done: number[] = []
      const skipped: number[] = []
      let aborted = false
      for (const row of rows) {
        if (isJobAborted(db, job.id)) {
          aborted = true
          break
        }
        let purposeful = false
        try {
          const g = JSON.parse(String(row.goal_json ?? '{}')) as { purpose?: unknown }
          purposeful = typeof g.purpose === 'string' && g.purpose.trim().length >= 4
        } catch {
          purposeful = false
        }
        if (purposeful) {
          skipped.push(row.id)
        } else {
          await refineOne(db, row.id, { title: row.title, summary: row.summary, goal_json: row.goal_json })
          done.push(row.id)
        }
        updateJob(db, job.id, {
          progress: rows.length > 0 ? Math.round(((done.length + skipped.length) / rows.length) * 100) : 100,
          resultJson: JSON.stringify(
            traceAppend(db, job.id, {
              current: row.title,
              action: '细化',
              done: done.length,
              total: rows.length,
              skipped: skipped.length
            })
          )
        })
      }
      if (aborted) {
        updateJob(db, job.id, { status: 'cancelled' })
      } else {
        finishJob(db, job.id, {
          progress: 100,
          status: 'done',
          resultJson: JSON.stringify(traceAppend(db, job.id, { done, skipped }))
        })
      }
    } else if (job.type === 'solution-chapter') {
      // v0.23.1（批次 D1）：方案生产迁 job（此前 HTTP 请求内多步 LLM 流水线）——
      // 步骤边界感知取消；结果（字数/降级/步骤输出）入 resultJson 供前端轮询消费
      const r = await runProductionChapter(db, Number(payload.solutionId), payload.novelId, Number(payload.chapterId), {
        isAborted: () => isJobAborted(db, job.id)
      })
      finishJob(db, job.id, {
        progress: 100,
        status: 'done',
        resultJson: JSON.stringify({
          wordCount: r.wordCount,
          title: r.title,
          degraded: r.degraded,
          outputs: r.outputs.map((o) => ({ role: o.role, ok: o.ok }))
        })
      })
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
        void processJob(dbRef, job)
          .catch((err) => {
            // v0.23.1（批次 A1）：双层防御——processJob 内部各路径已 try/catch，此处兜底意外逃逸
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

let dbRef: DatabaseSync

export function startScheduler(db: DatabaseSync, intervalMs = 1500): void {
  dbRef = db
  // 重启幂等（修正 #3）：遗留 running job 重置为 queued（进程被杀后状态残留）
  db.prepare(
    "UPDATE job SET status = 'queued', updated_at = datetime('now') WHERE status = 'running'"
  ).run()
  // v0.17.0（审查 H3）：遗留 generating 章节同样重置（此前只重置 job——章节永久拒生成）
  db.prepare(
    "UPDATE chapter SET status = 'planned', updated_at = datetime('now') WHERE status = 'generating'"
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
