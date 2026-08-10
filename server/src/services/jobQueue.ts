import { DatabaseSync } from 'node:sqlite'

// ============================================================
// 命令队列公共函数（P2.1 修复 #2）
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
  // P2.2 修复 #3：json_extract 精确匹配（禁止 LIKE 前缀误匹配，如 12 vs 123）
  const existing = db
    .prepare(
      "SELECT id FROM job WHERE type = 'director' AND status IN ('queued','running') AND json_extract(payload_json, '$.novelId') = ?"
    )
    .get(novelId) as { id: number } | undefined
  if (existing) return { conflict: true }

  const result = db
    .prepare(
      "INSERT INTO job (type, status, progress, payload_json) VALUES ('director', 'queued', 0, ?)"
    )
    .run(
      JSON.stringify({
        novelId,
        mode: opts.mode ?? 'auto',
        chaptersPerVolume: opts.chaptersPerVolume ?? 20
      })
    )
  return { jobId: Number(result.lastInsertRowid) }
}
