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
  // v0.21.0（审查 M10 残）：预留路由标记（未消费——UI 标注禁编辑）
  reserved: z.boolean().optional(),
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

// ===== P12 C4：契约类型统一入 shared（此前 NovelSummary 等定义在 client/types.ts 内联，前后端易漂移） =====
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

// v0.20.0（NovelClaw 学习组）：记忆面——状态机显式视图（v0.21.0 审查 N5：契约类型入 shared）
// v1.0 后续（A5 导出预览）：整本书导出前的结构化预览数据（camelCase，客户端用 .prose 渲染）
export interface ExportPreviewChapter {
  title: string
  content: string
}

export interface ExportPreview {
  title: string
  inspiration: string
  chapters: ExportPreviewChapter[]
}

export interface NovelMemory {
  characters: Array<{ name: string; states: string[] }>
  factions: Array<{ name: string; currentState: string }>
  pendingFacts: Array<{ id: number; content: string }>
}

// v0.20.0：运行轨迹（任务进度时间线条目）
export interface RunTraceEntry {
  at: string
  chapter: string
  action: string
  done: number
  total: number
}

export interface RunTraceResult extends Record<string, unknown> {
  current?: string
  action?: string
  done?: number
  total?: number
  failed?: number
  qualityDebts?: number
  trace?: RunTraceEntry[]
}

// ============================================================
// v0.21.0（审查 #20：契约类型补全）——从现有路由/前端内联类型提取，
// 与 REST 返回（camelCase）对齐，供后续消费方引用（本批只补定义）
// ============================================================

/** 智能体（agent 表 + 技能挂载聚合；对齐 GET /agents 返回与 AgentsLibraryPage AgentRow） */
export interface Agent {
  id: number
  name: string
  role: string
  systemPrompt: string
  description: string
  bodyMd: string
  skills: string[]
  skillIds: number[]
  enabled: boolean
  custom: boolean
}

/** 技能（skill 表；对齐 GET /skills 返回） */
export interface Skill {
  id: number
  name: string
  description: string
  bodyMd: string
  novelId: number
  createdAt: string
}

/** 方案步骤（solution.steps_json 元素；对齐 services/solutionAssets.ts SolutionStep） */
export interface SolutionStep {
  agentId: number
  role: string
  stage: 'post_generate' | 'review' | 'whole_book'
  include?: string[]
  maxTokens?: number
  if?: { field: string; op: '<' | '>' | '=='; value: number } | null
}

/** 创作方案（solution 表；对齐 GET /solutions 返回） */
export interface Solution {
  id: number
  name: string
  description: string
  primaryAgentId: number | null
  steps: SolutionStep[]
}

/** 流派（genre_asset 表；对齐 GET /genres 返回） */
export interface Genre {
  id: number
  name: string
  novelId: number | null
}

/** 写法特征（style_asset.features_json 元素；对齐 services/styleEngine.ts StyleFeature） */
export interface StyleFeature {
  id: string
  name: string
  description: string
  enabled: boolean
  category: 'syntax' | 'vocabulary' | 'rhythm' | 'dialogue' | 'description' | 'other'
}

/** 写法资产（style_asset 表；对齐 GET /:novelId/style 与 style-engine 全局资产返回） */
export interface StyleAsset {
  id: number
  novelId: number
  name: string
  features: StyleFeature[]
  antiAiRules: string[]
  samples: string[]
  rules: string[]
  createdAt: string
}

/** 提示词资产（prompt_asset 表；对齐 GET /prompts 返回与 PromptWorkbenchPage 内联类型） */
export interface PromptAsset {
  id: number
  name: string
  taskType: string
  template: string
  slots: Record<string, unknown>
  notes: string
}

/** 章节详情（对齐 GET /:novelId/chapters/:chapterId 返回） */
export interface ChapterDetail {
  id: number
  title: string
  summary: string | null
  goal: Record<string, unknown>
  status: string
  wordCount: number
  aiWords: number
  humanWords: number
  content: string
}

/** 通用资产视图（对齐 assets 端点产物统一视图：id/novelId/type/title/content/status/createdAt） */
export interface Asset {
  id: number
  novelId: number
  type: string
  title: string
  content: string
  status: string
  createdAt: string
}

/** v0.24.2（F3）：版本 diff——行级对比（对齐 GET .../versions/:versionId/diff 返回） */
export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
}

export interface VersionDiffInfo {
  versionId: number
  note: string
  createdAt: string
  lines: DiffLine[]
  added: number
  removed: number
  degraded: boolean
}

/** v0.24.2（F2）：全书检索结果（对齐 GET /:novelId/search 返回，按类型分组） */
export interface SearchResults {
  query: string
  chapters: Array<{ id: number; title: string; status: string; wordCount: number; snippet: string }>
  characters: Array<{ id: number; name: string; snippet: string }>
  world: Array<{ snippet: string }>
  foreshadows: Array<{ id: number; content: string; status: string }>
  facts: Array<{ id: number; content: string }>
  kb: Array<{ id: number; title: string; snippet: string }>
}

/** v0.24.4（A3）：书级写作统计（对齐 GET /:novelId/stats 返回） */
export interface NovelStats {
  novelId: number
  title: string
  total: {
    chapters: number
    words: number
    aiWords: number
    humanWords: number
    written: number
    failed: number
  }
  byStatus: Array<{ status: string; count: number; words: number }>
  byVolume: Array<{ id: number; title: string; orderIndex: number; count: number; words: number }>
  reviewScores: Array<{ chapterId: number; title: string; score: number }>
  pendingDebts: number
  usage: { calls: number; tokens: number; cost: number }
}
