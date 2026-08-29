// 导演检查点（重构计划 R4.2 / spec §3.3）：只保存当前位置、用户决策、熔断计数与展示状态。
// 阶段完成与否的事实源是 artifacts.ts（产物落库判定），checkpoint.progress 仅为展示缓存。
import { DatabaseSync } from 'node:sqlite'
import type { DirectorStage } from './stages'

export interface DirectorCheckpoint {
  stage: DirectorStage
  progress: Record<string, boolean>
  decisions: string[] // 决策路径去重（熔断）
  replanCount: number
  mode: 'auto' | 'supervised'
  chaptersPerVolume?: number // P2.2 🟡10：保留用户配置
  lastError?: string
  displayStatus: string
  blockingReason?: string
  resumeAction?: string
}

export interface DirectorTask {
  id: number
  novelId: number
  stage: DirectorStage
  status: 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
  mode: 'auto' | 'supervised'
  checkpoint: DirectorCheckpoint
}

export function loadDirectorTask(db: DatabaseSync, novelId: number): DirectorTask | null {
  const row = db
    .prepare('SELECT * FROM director_followup WHERE novel_id = ? ORDER BY id DESC LIMIT 1')
    .get(novelId) as
    | { id: number; novel_id: number; stage: string; checkpoint_json: string; status: string; model_route_id: number | null }
    | undefined
  if (!row) return null
  const checkpoint = JSON.parse(row.checkpoint_json) as DirectorCheckpoint
  return {
    id: row.id,
    novelId: row.novel_id,
    stage: checkpoint.stage ?? (row.stage as DirectorStage),
    status: row.status as DirectorTask['status'],
    mode: checkpoint.mode ?? 'auto',
    checkpoint
  }
}

export function saveDirectorTask(db: DatabaseSync, task: DirectorTask): void {
  const existing = db
    .prepare('SELECT id FROM director_followup WHERE novel_id = ? ORDER BY id DESC LIMIT 1')
    .get(task.novelId) as { id: number } | undefined
  const json = JSON.stringify(task.checkpoint)
  if (existing) {
    db.prepare(
      "UPDATE director_followup SET stage = ?, checkpoint_json = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(task.stage, json, task.status, existing.id)
  } else {
    db.prepare(
      'INSERT INTO director_followup (novel_id, stage, checkpoint_json, status) VALUES (?, ?, ?, ?)'
    ).run(task.novelId, task.stage, json, task.status)
  }
}

export function directorProgress(db: DatabaseSync, novelId: number): DirectorTask | null {
  return loadDirectorTask(db, novelId)
}
