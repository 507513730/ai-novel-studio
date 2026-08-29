import { DatabaseSync } from 'node:sqlite'
import { runDirectorPipeline } from './director'
import { runProductionPipeline, type ProductionProgress } from './production'
import { fixAllDebts } from './debtFix'
import { setActiveModelOverride } from './llm'
import { isJobCancelled, isJobAborted } from './jobQueue'
import { claimNextJob, updateClaimedJob, finishClaimedJob } from './jobs/repository'
import { parseJobPayload, JobPayloadError, type DirectorPayload, type ProductionPayload, type DebtFixPayload, type RefineRangePayload, type SolutionChapterPayload } from './jobs/payload'
import { resetStaleRunning } from './jobs/lifecycle'
import type { ClaimedJob } from './jobs/types'
// v0.23.1（批次 D）：refine-range / solution-chapter 两个迁入 job 队列的重型端点
import { refineOne } from './planner'
import { runProductionChapter } from './solutionRunner'

// ============================================================
// 执行面隔离（PLAN 修正 #2 / P2）
// 独立 Scheduler 轮询 job 表：Web API 只下发命令（POST /jobs），
// 重型链路（导演/整本生产）在调度循环中执行，不阻塞普通 API
// （重构计划 R2：抢占/更新/收尾改走 jobs/ 域 claim-token 守卫；R3 拆执行器映射）
// ============================================================

// P20（M1）：job 看门狗——运行中且超 30 分钟无进展的 job 强制回收（防挂死 job 永久瘫痪调度器；
// v0.23.1 批次 B6：删除从未被消费的 JOB_TIMEOUT_MS 导出，时长以 watchdog SQL 的 '-30 minutes' 为准）

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

// P20（M1）：看门狗——运行中且无进展超时的 job 强制 failed。
// v0.8.0（审查 #8）：以 updated_at 活跃度判定（每章 progress 回调会刷新 updated_at）——
// 活跃任务不会被误回收；只有真挂死（30 分钟无任何进展）才回收，且 processJob
// 通过 isJobAborted 在章节边界自检后停止继续写库。
// R2：置 failed 即失效旧 claim（守卫 status='running'），迟到协程的写入被拒绝。
function watchdog(db: DatabaseSync): void {
  db.prepare(
    `UPDATE job SET status = 'failed', error = 'watchdog: job stuck without progress for 30min', updated_at = datetime('now')
     WHERE status = 'running' AND started_at IS NOT NULL
       AND started_at < datetime('now', '-30 minutes')
       AND updated_at < datetime('now', '-30 minutes')`
  ).run()
}

async function processJob(db: DatabaseSync, claimed: ClaimedJob): Promise<void> {
  const job = claimed.job
  // 重构计划 R2：payload 在域边界一次 Zod 解析（强类型 + 语义化失败）——
  // 损坏/不合规 payload 只失败该 job，不抛未处理 rejection（v0.23.1 批次 A1 防御的域内化）
  let payload
  try {
    payload = parseJobPayload(job.type, job.payloadJson)
  } catch (err) {
    const message = err instanceof JobPayloadError ? err.message : 'corrupted payload_json (unparseable)'
    finishClaimedJob(db, claimed, { status: 'failed', error: message })
    return
  }
  // P13 G1：换模型重试（活动覆盖，单例执行串行安全）
  setActiveModelOverride(payload.modelOverride ?? null)
  try {
    if (job.type === 'director') {
      const p = payload as DirectorPayload
      await runDirectorPipeline(db, p.novelId, p.mode ?? 'auto', {
        chaptersPerVolume: p.chaptersPerVolume ?? 20,
        jobId: job.id
      })
      finishClaimedJob(db, claimed, { progress: 100, status: 'done', resultJson: '{"ok":true}' })
    } else if (job.type === 'production') {
      const p = payload as ProductionPayload
      const prodResult = await runProductionPipeline(
        db,
        p.novelId,
        (p: ProductionProgress) => {
          // P20（C9）：进度含失败章节（处理完成率而非成功率）
          const ratio = p.total > 0 ? Math.round(((p.done + p.failed) / p.total) * 100) : 100
          updateClaimedJob(db, claimed, {
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
        { from: p.from, to: p.to, jobId: job.id }
      )
      // v0.24.3（写书实战纠错）：全部章节失败时 job 不得虚报 done——
      // 任务 28 全 18 章失败仍显示"完成"，用户无从察觉（final.status 覆盖默认 done）
      if (prodResult.total > 0 && prodResult.done === 0 && prodResult.failed >= prodResult.total) {
        finishClaimedJob(db, claimed, {
          progress: 100,
          status: 'failed',
          error: `生产结束但全部章节失败（${prodResult.failed}/${prodResult.total}）——多为模型/网络级故障，请检查模型路由与 API Key 后重试`
        })
      } else {
        finishClaimedJob(db, claimed, { progress: 100, status: 'done' })
      }
    } else if (job.type === 'debt-fix') {
      // v0.10.0（批B/I2）：质量债自动修复（每章内部自限轮次，串行执行）
      const p = payload as DebtFixPayload
      await fixAllDebts(
        db,
        p.novelId,
        (done, total, current, action) => {
          const ratio = total > 0 ? Math.round((done / total) * 100) : 100
          updateClaimedJob(db, claimed, {
            progress: ratio,
            resultJson: JSON.stringify(traceAppend(db, job.id, { current, action, done, total }))
          })
        }
      )
      finishClaimedJob(db, claimed, { progress: 100, status: 'done' })
    } else if (job.type === 'refine-range') {
      // v0.23.1（批次 D2）：批量细化迁 job（此前 HTTP 请求内循环逐章 LLM）——
      // 幂等续跑语义保留（goal_json 已有 purpose 的章节跳过）；章间检查中止（取消/看门狗）
      const p = payload as RefineRangePayload
      const rows = db
        .prepare(
          `SELECT id, title, summary, goal_json FROM chapter
           WHERE novel_id = ? AND id BETWEEN ? AND ?
           ORDER BY id`
        )
        .all(p.novelId, Number(p.from ?? 0), Number(p.to ?? 0)) as Array<{
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
        updateClaimedJob(db, claimed, {
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
        updateClaimedJob(db, claimed, { status: 'cancelled' })
      } else {
        finishClaimedJob(db, claimed, {
          progress: 100,
          status: 'done',
          resultJson: JSON.stringify(traceAppend(db, job.id, { done, skipped }))
        })
      }
    } else if (job.type === 'solution-chapter') {
      // v0.23.1（批次 D1）：方案生产迁 job（此前 HTTP 请求内多步 LLM 流水线）——
      // 步骤边界感知取消；结果（字数/降级/步骤输出）入 resultJson 供前端轮询消费
      const p = payload as SolutionChapterPayload
      const r = await runProductionChapter(db, Number(p.solutionId), p.novelId, Number(p.chapterId), {
        isAborted: () => isJobAborted(db, job.id)
      })
      finishClaimedJob(db, claimed, {
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
      finishClaimedJob(db, claimed, { status: 'failed', error: `unknown job type: ${job.type}` })
    }
  } catch (err) {
    // P20（M2）：取消是正常终止，不是失败
    if (isJobCancelled(db, job.id)) {
      updateClaimedJob(db, claimed, { status: 'cancelled' })
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    finishClaimedJob(db, claimed, { status: 'failed', error: message })
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
      const claimed = claimNextJob(dbRef)
      if (claimed) {
        void processJob(dbRef, claimed)
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
  // 重启幂等（修正 #3 / R2）：遗留 running job 重置 queued 并清空旧 claim token（进程被杀后状态残留）
  resetStaleRunning(db)
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
