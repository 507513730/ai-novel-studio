// job 执行器映射（重构计划 R3 / spec §3.2）：job type → 执行器的显式注册表。
// 每个执行器只负责自己的业务循环与收尾（done / 业务性 failed / cancelled）；
// 意外异常逃逸由 jobs/scheduler 的统一兜底转为 failed。未知类型在分发层立即失败。
import type { DatabaseSync } from 'node:sqlite'
import { runDirectorPipeline } from '../director'
import { runProductionPipeline, type ProductionProgress } from '../production'
import { fixAllDebts } from '../debtFix'
import { refineOne } from '../planner'
import { runProductionChapter } from '../solutionRunner'
import { updateClaimedJob, finishClaimedJob } from './repository'
import { traceAppend, pct } from './progress'
import type { ClaimedJob, JobPatch, JobType } from './types'
import type {
  DebtFixPayload,
  DirectorPayload,
  ProductionPayload,
  RefineRangePayload,
  SolutionChapterPayload
} from './payload'

export interface JobExecutorContext {
  db: DatabaseSync
  claim: ClaimedJob
  isAborted: () => boolean
  // 进度上报（内部走 updateClaimedJob——迟到协程守卫失配返回 false，执行器应停止后续写库）
  reportProgress: (patch: JobPatch) => boolean
}

export type JobExecutor<P> = (ctx: JobExecutorContext, payload: P) => Promise<void>

const directorExecutor: JobExecutor<DirectorPayload> = async ({ db, claim }, payload) => {
  await runDirectorPipeline(db, payload.novelId, payload.mode ?? 'auto', {
    chaptersPerVolume: payload.chaptersPerVolume ?? 20,
    jobId: claim.job.id
  })
  finishClaimedJob(db, claim, { progress: 100, status: 'done', resultJson: '{"ok":true}' })
}

const productionExecutor: JobExecutor<ProductionPayload> = async ({ db, claim, reportProgress }, payload) => {
  const prodResult = await runProductionPipeline(db, payload.novelId, (p: ProductionProgress) => {
    // P20（C9）：进度含失败章节（处理完成率而非成功率）
    reportProgress({
      progress: pct(p.done + p.failed, p.total),
      resultJson: JSON.stringify(
        traceAppend(db, claim.job.id, {
          current: p.currentChapter,
          action: p.currentAction,
          done: p.done,
          total: p.total,
          failed: p.failed,
          qualityDebts: p.qualityDebts
        })
      )
    })
  }, { from: payload.from, to: payload.to, jobId: claim.job.id })
  // v0.24.3（写书实战纠错）：全部章节失败时 job 不得虚报 done——
  // 任务 28 全 18 章失败仍显示"完成"，用户无从察觉（final.status 覆盖默认 done）
  if (prodResult.total > 0 && prodResult.done === 0 && prodResult.failed >= prodResult.total) {
    finishClaimedJob(db, claim, {
      progress: 100,
      status: 'failed',
      error: `生产结束但全部章节失败（${prodResult.failed}/${prodResult.total}）——多为模型/网络级故障，请检查模型路由与 API Key 后重试`
    })
  } else {
    finishClaimedJob(db, claim, { progress: 100, status: 'done' })
  }
}

const debtFixExecutor: JobExecutor<DebtFixPayload> = async ({ db, claim, reportProgress }, payload) => {
  // v0.10.0（批B/I2）：质量债自动修复（每章内部自限轮次，串行执行）
  await fixAllDebts(db, payload.novelId, (done, total, current, action) => {
    reportProgress({
      progress: pct(done, total),
      resultJson: JSON.stringify(traceAppend(db, claim.job.id, { current, action, done, total }))
    })
  })
  finishClaimedJob(db, claim, { progress: 100, status: 'done' })
}

const refineRangeExecutor: JobExecutor<RefineRangePayload> = async ({ db, claim, isAborted, reportProgress }, payload) => {
  // v0.23.1（批次 D2）：批量细化迁 job（此前 HTTP 请求内循环逐章 LLM）——
  // 幂等续跑语义保留（goal_json 已有 purpose 的章节跳过）；章间检查中止（取消/看门狗/调度器停止）
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
    if (isAborted()) {
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
    reportProgress({
      progress: pct(done.length + skipped.length, rows.length),
      resultJson: JSON.stringify(
        traceAppend(db, claim.job.id, {
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
    updateClaimedJob(db, claim, { status: 'cancelled' })
  } else {
    finishClaimedJob(db, claim, {
      progress: 100,
      status: 'done',
      resultJson: JSON.stringify(traceAppend(db, claim.job.id, { done, skipped }))
    })
  }
}

const solutionChapterExecutor: JobExecutor<SolutionChapterPayload> = async ({ db, claim, isAborted }, payload) => {
  // v0.23.1（批次 D1）：方案生产迁 job（此前 HTTP 请求内多步 LLM 流水线）——
  // 步骤边界感知取消；结果（字数/降级/步骤输出）入 resultJson 供前端轮询消费
  const r = await runProductionChapter(db, Number(payload.solutionId), payload.novelId, Number(payload.chapterId), {
    isAborted
  })
  finishClaimedJob(db, claim, {
    progress: 100,
    status: 'done',
    resultJson: JSON.stringify({
      wordCount: r.wordCount,
      title: r.title,
      degraded: r.degraded,
      outputs: r.outputs.map((o) => ({ role: o.role, ok: o.ok }))
    })
  })
}

export type PayloadOf<K extends JobType> =
  K extends 'director'
    ? DirectorPayload
    : K extends 'production'
      ? ProductionPayload
      : K extends 'debt-fix'
        ? DebtFixPayload
        : K extends 'refine-range'
          ? RefineRangePayload
          : SolutionChapterPayload

// 显式注册表：全部 job type 必须映射；分发层查不到即未知类型失败
export const EXECUTORS: { [K in JobType]: JobExecutor<PayloadOf<K>> } = {
  director: directorExecutor,
  production: productionExecutor,
  'debt-fix': debtFixExecutor,
  'refine-range': refineRangeExecutor,
  'solution-chapter': solutionChapterExecutor
}
