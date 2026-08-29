// job 域 payload 校验（重构计划 R2 / spec §3.2）：在域边界做一次 Zod 解析，
// 执行器接收强类型对象；损坏/不合规 payload 形成语义化失败（JobPayloadError），
// 由调用方标记该 job failed——不抛未处理 rejection，不影响 scheduler 进程。
import { z } from 'zod'
import type { JobType } from './types'

export class JobPayloadError extends Error {}

// 公共基础：novelId 供查重/进度投影消费；modelOverride 供换模型重试（P13 G1，
// 重试端点写入 payload.modelOverride，必须穿过解析保留——优先级语义在 llm 候选构建层）
const basePayloadSchema = z.object({
  novelId: z.number(),
  modelOverride: z.string().optional()
})

const directorPayloadSchema = basePayloadSchema.extend({
  mode: z.enum(['auto', 'supervised']).optional(),
  chaptersPerVolume: z.number().int().optional()
})

const productionPayloadSchema = basePayloadSchema.extend({
  from: z.number().optional(),
  to: z.number().optional()
})

const debtFixPayloadSchema = basePayloadSchema

const refineRangePayloadSchema = basePayloadSchema.extend({
  from: z.number().optional(),
  to: z.number().optional()
})

const solutionChapterPayloadSchema = basePayloadSchema.extend({
  solutionId: z.number(),
  chapterId: z.number()
})

export interface DirectorPayload {
  novelId: number
  modelOverride?: string
  mode?: 'auto' | 'supervised'
  chaptersPerVolume?: number
}

export interface ProductionPayload {
  novelId: number
  modelOverride?: string
  from?: number
  to?: number
}

export interface DebtFixPayload {
  novelId: number
  modelOverride?: string
}

export interface RefineRangePayload {
  novelId: number
  modelOverride?: string
  from?: number
  to?: number
}

export interface SolutionChapterPayload {
  novelId: number
  modelOverride?: string
  solutionId: number
  chapterId: number
}

export type JobPayload =
  | DirectorPayload
  | ProductionPayload
  | DebtFixPayload
  | RefineRangePayload
  | SolutionChapterPayload

const PAYLOAD_SCHEMAS: Record<JobType, z.ZodType<JobPayload>> = {
  director: directorPayloadSchema,
  production: productionPayloadSchema,
  'debt-fix': debtFixPayloadSchema,
  'refine-range': refineRangePayloadSchema,
  'solution-chapter': solutionChapterPayloadSchema
}

// 解析并校验 job payload。JSON 损坏 / 未知类型 / 字段不合规 → JobPayloadError（消息语义化）。
export function parseJobPayload(type: string, raw: string): JobPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new JobPayloadError('corrupted payload_json (unparseable)')
  }

  const schema = PAYLOAD_SCHEMAS[type as JobType]
  if (!schema) throw new JobPayloadError(`unknown job type: ${type}`)

  const result = schema.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue ? issue.path.join('.') : 'unknown'
    throw new JobPayloadError(`invalid ${type} payload（${path}: ${issue?.message ?? 'schema mismatch'}）`)
  }
  return result.data
}
