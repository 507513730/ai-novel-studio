import { z } from 'zod'

// v0.9.0（审查 M4）：DirectorStatus 统一定义——此前 DirectorPage 与 AiStatusBar 各手写一份，极易漂移
export interface DirectorStatus {
  status: string
  displayStatus?: string
  stage?: string
  progress?: Record<string, boolean>
  blockingReason?: string | null
  resumeAction?: string | null
}

export const taskTypes = [
  'prose',
  'planning',
  'review',
  'analysis',
  'summary',
  'extraction',
  'director',
  'chat',
  'embedding'
] as const
export type TaskType = (typeof taskTypes)[number]

export const reasoningEfforts = ['low', 'high', 'max'] as const
export type ReasoningEffort = (typeof reasoningEfforts)[number]

export const providerSchema = z.object({
  id: z.number(),
  name: z.string(),
  baseUrl: z.string(),
  hasKey: z.boolean(),
  isCustom: z.boolean()
})
export type Provider = z.infer<typeof providerSchema>

export const fallbackEntrySchema = z.object({
  providerId: z.number(),
  model: z.string()
})
export type FallbackEntry = z.infer<typeof fallbackEntrySchema>

export const modelRouteSchema = z.object({
  id: z.number(),
  taskType: z.enum(taskTypes),
  providerId: z.number(),
  providerName: z.string(),
  model: z.string(),
  thinkingEnabled: z.boolean(),
  reasoningEffort: z.enum(reasoningEfforts),
  temperature: z.number().nullable(),
  maxTokens: z.number(),
  fallback: z.array(fallbackEntrySchema)
})
export type ModelRoute = z.infer<typeof modelRouteSchema>

// v0.17.0（审查 M4）：REST 契约统一 camelCase（此前 snake_case 直出违反 #20）
export const usageGroupSchema = z.object({
  taskType: z.string(),
  provider: z.string(),
  model: z.string(),
  calls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheHits: z.number(),
  cacheMisses: z.number(),
  cost: z.number(),
  degraded: z.number()
})
export type UsageGroup = z.infer<typeof usageGroupSchema>

export const usageTotalSchema = z.object({
  calls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheHits: z.number(),
  cacheMisses: z.number(),
  cost: z.number()
})
export type UsageTotal = z.infer<typeof usageTotalSchema>

export const bootstrapSchema = z.object({
  firstRun: z.boolean(),
  providersConfigured: z.boolean(),
  hasApiKey: z.boolean(),
  schemaVersion: z.number()
})
export type BootstrapInfo = z.infer<typeof bootstrapSchema>

export const taskTypeLabels: Record<TaskType, string> = {
  prose: '正文生成',
  planning: '规划/世界/角色',
  review: '审核',
  analysis: '拆书',
  summary: '总结压缩',
  extraction: '结构化提取',
  director: '自动导演',
  chat: '对话',
  embedding: 'Embedding'
}


// ===== ??????P12 C4 ??? client/types.ts? =====
export interface NovelSummary {
  id: number
  title: string
  inspiration: string
  status: string
  chaptersDone: number
  chaptersTotal: number
  characters: number
  lastOpenedAt: string | null
}

export interface DirectionScheme {
  title: string
  sellingPoint: string
  genre: string
  coreSetting: string
  mainline: string
  first30: string
  readerFeeling: string
}

// v0.15.0：用户创作约束（硬 MUST / 软 SHOULD）
export interface NovelConstraint {
  id: string
  text: string
  level: 'must' | 'should'
  enabled: boolean
  createdAt: string
  keyword?: string
  replaceWith?: string
}

export interface NovelDetail {
  id: number
  title: string
  inspiration: string
  status: string
  genre: string
  direction: Array<{ id: string; scheme: DirectionScheme }>
  titleGroup: string[]
  framing: Record<string, unknown>
  guidance?: string
  currentSolutionId?: number | null
  constraints?: NovelConstraint[]
  // P10：各阶段完成度计数
  charactersCount?: number
  volumesCount?: number
  chaptersCount?: number
  analysesCount?: number
  stylesCount?: number
  agentsCount?: number
  worldDone?: boolean
}

export interface WorldData {
  manual: Record<string, string>
  factions: Array<{ name: string; desc: string; stance?: string }>
  map: Record<string, string>
  timeline: unknown[]
}

export interface CharacterData {
  id: number
  name: string
  status: 'roster' | 'pending'
  profile: Record<string, string>
  ledger: Record<string, unknown>
}

export interface VolumeData {
  id: number
  title: string
  orderIndex: number
  strategy: Record<string, unknown>
  skeleton: Record<string, unknown>
}

export interface BeatData {
  id: number
  title: string
  summary: string
  orderIndex: number
}

export interface ChapterSummary {
  id: number
  title: string
  summary: string
  goal: Record<string, unknown>
  status: string
  wordCount: number
  // v0.19.0：人类/AI 字数分离累计
  aiWords?: number
  humanWords?: number
  volumeId: number | null
  beatId: number | null
  volumeTitle: string | null
  beatTitle: string | null
}
