import { DatabaseSync } from 'node:sqlite'
import { enqueueDirectorJob as enqueueDirector, enqueueProductionJob as enqueueProduction, enqueueTypedJob as enqueueTyped } from './jobs/repository'

// ============================================================
// 命令队列兼容入口（重构计划 R2）：实现已迁至 services/jobs/ 域
// （repository = 入队/抢占/收尾唯一入口），此处仅保留既有公共签名转发。
// ============================================================

export interface EnqueueOptions {
  mode?: 'auto' | 'supervised'
  chaptersPerVolume?: number
}

export function enqueueDirectorJob(
  db: DatabaseSync,
  novelId: number,
  opts: EnqueueOptions = {}
): { jobId: number } | { conflict: true } {
  return enqueueDirector(db, { novelId, mode: opts.mode, chaptersPerVolume: opts.chaptersPerVolume })
}

// P20（M2/C1）：运行中任务取消感知（导演/生产循环每阶段/每章检查）
export function isJobCancelled(db: DatabaseSync, jobId: number): boolean {
  const row = db.prepare("SELECT status FROM job WHERE id = ?").get(jobId) as { status: string } | undefined
  return row?.status === 'cancelled'
}

// v0.23.1（批次 D1/D2）：通用类型入队（refine-range / solution-chapter 迁 job 队列用）
export type TypedJobType = 'refine-range' | 'solution-chapter'

export function enqueueTypedJob(
  db: DatabaseSync,
  type: TypedJobType,
  payload: Record<string, unknown> & { novelId: number }
): { jobId: number } | { conflict: true } {
  return enqueueTyped(db, type, payload)
}

// v0.24.2（F4）：整本生产入队（production 型，原子查重）——自动化路由与方案整本入口共用
export function enqueueProductionJob(
  db: DatabaseSync,
  novelId: number,
  range?: { from: number; to: number }
): { jobId: number } | { conflict: true } {
  return enqueueProduction(db, novelId, range)
}

// v0.8.0（审查 #8）：执行中止感知——取消（cancelled）或 watchdog 超时回收（failed + watchdog: 前缀）都中止
// watchdog 只改状态不中止执行 → 此前"假 failed"后流水线继续写库；现在每章/阶段边界自检后退出
export function isJobAborted(db: DatabaseSync, jobId: number): boolean {
  const row = db
    .prepare("SELECT status, error FROM job WHERE id = ?")
    .get(jobId) as { status: string; error: string } | undefined
  if (!row) return true // 行不存在（被清理）＝视为中止
  if (row.status === 'cancelled') return true
  return row.status === 'failed' && String(row.error).startsWith('watchdog:')
}
