import { DatabaseSync } from 'node:sqlite'
import type { TaskType } from '../db/seed'

export interface UsageRecord {
  novelId: number | null
  taskType: TaskType | string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheHit: number
  cacheMiss: number
  costEstimate: number
  degraded: boolean
}

// 每 1M tokens 单价（USD），来源：DeepSeek 官方定价页（2026-08 核实，§3.1）
// key: `${provider}:${model}`；未知供应商用默认值兜底
const PRICING: Record<string, { hit: number; miss: number; out: number }> = {
  'DeepSeek:deepseek-v4-flash': { hit: 0.0028, miss: 0.14, out: 0.28 },
  'DeepSeek:deepseek-v4-pro': { hit: 0.003625, miss: 0.435, out: 0.87 }
}

const DEFAULT_PRICING = { hit: 0.1, miss: 0.5, out: 1.5 }

export function estimateCost(
  provider: string,
  model: string,
  _input: number,
  output: number,
  cacheHit: number,
  cacheMiss: number
): number {
  const p = PRICING[`${provider}:${model}`] ?? DEFAULT_PRICING
  return (cacheHit / 1e6) * p.hit + (cacheMiss / 1e6) * p.miss + (output / 1e6) * p.out
}

export function recordUsage(db: DatabaseSync, record: UsageRecord): void {
  const cost =
    record.costEstimate > 0
      ? record.costEstimate
      : estimateCost(
          record.provider,
          record.model,
          record.inputTokens,
          record.outputTokens,
          record.cacheHit,
          record.cacheMiss
        )
  db.prepare(
    `INSERT INTO usage_log
     (novel_id, task_type, provider, model, input_tokens, output_tokens, cache_hit, cache_miss, cost_estimate, degraded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.novelId,
    record.taskType,
    record.provider,
    record.model,
    record.inputTokens,
    record.outputTokens,
    record.cacheHit,
    record.cacheMiss,
    cost,
    record.degraded ? 1 : 0
  )
}
