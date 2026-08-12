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

// P20（C2）：模型名归一化匹配——供应商回显名（response.model）常与配置名有大小写/别名差异，
// 精确匹配失败会落 DEFAULT_PRICING（虚高 3.5~35 倍）。归一后精确 + 前缀匹配。
function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_]/g, '')
}

const PRICING_NORM: Array<{ n: string; p: { hit: number; miss: number; out: number } }> = Object.entries(
  PRICING
).map(([k, p]) => ({ n: normKey(k), p }))

function findPricing(provider: string, model: string): { hit: number; miss: number; out: number } {
  const key = normKey(`${provider}:${model}`)
  for (const e of PRICING_NORM) {
    if (e.n === key) return e.p
  }
  // v0.9.0（审查 D）：前缀匹配只允许"配置名是 key 的前缀"（主从关系）——
  // 此前双向 startsWith 会让 "deepseek:deepseek-v4-flash-latest" 命中 flash 低价、
  // "deepseek:deepseek-v4"（不存在）也命中 flash（成本估算错配）
  for (const e of PRICING_NORM) {
    if (key.startsWith(e.n) && key.length > e.n.length) return e.p
  }
  return DEFAULT_PRICING
}

export function estimateCost(
  provider: string,
  model: string,
  _input: number,
  output: number,
  cacheHit: number,
  cacheMiss: number
): number {
  const p = findPricing(provider, model)
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
