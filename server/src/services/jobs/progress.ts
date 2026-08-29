// job 进度投影（重构计划 R3 / spec §3.2）：trace 时间线与进度百分比计算的唯一实现。
// trace 去重（同章节同动作不重复追加）+ 上限 300 条；百分比 = 处理完成率（含失败，P20 C9）。
import { DatabaseSync } from 'node:sqlite'

const TRACE_LIMIT = 300

interface TraceEntry {
  at: string
  done: number
  total: number
  chapter: string
  action: string
}

// 追加运行轨迹并返回合并后的 result_json 状态对象（读改写由调用方经 updateClaimedJob 落库）
export function traceAppend(db: DatabaseSync, jobId: number, state: Record<string, unknown>): Record<string, unknown> {
  const row = db.prepare('SELECT result_json FROM job WHERE id = ?').get(jobId) as
    | { result_json: string }
    | undefined
  let prev: { trace?: TraceEntry[] } = {}
  try {
    prev = row ? JSON.parse(row.result_json || '{}') : {}
  } catch {
    prev = {}
  }
  const trace = prev.trace ?? []
  const last = trace[trace.length - 1]
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

// 处理完成率（0-100）：total=0 视为 100
export function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 100
}
