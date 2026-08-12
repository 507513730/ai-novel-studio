import { DatabaseSync } from 'node:sqlite'

// ============================================================
// 命令队列公共函数（P2.1 修复 #2 + P20）
// Web API 与 Creative Hub 共用：导演命令统一走 job 表 + scheduler
// （执行面隔离，防并发跑导演）
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
  // P20（M8）：查重+插入合并为单条 SQL（原子，多实例不双排）
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
  if (result.changes === 0) return { conflict: true }
  return { jobId: Number(result.lastInsertRowid) }
}

// P20（M2/C1）：运行中任务取消感知（导演/生产循环每阶段/每章检查）
export function isJobCancelled(db: DatabaseSync, jobId: number): boolean {
  const row = db.prepare("SELECT status FROM job WHERE id = ?").get(jobId) as { status: string } | undefined
  return row?.status === 'cancelled'
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
