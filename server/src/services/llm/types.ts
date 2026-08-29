// LLM 域共享类型（重构计划 R6.2 / spec §3.5）
import type OpenAI from 'openai'

export interface RouteConfig {
  providerId: number
  providerName: string
  baseUrl: string
  apiKeyEncrypted: string
  model: string
  thinkingEnabled: boolean
  reasoningEffort: 'low' | 'high' | 'max'
  temperature: number | null
  maxTokens: number
  fallback: Array<{ providerId: number; model: string }>
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  reasoningContent?: string
  toolCallId?: string
  name?: string
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
}

export interface LlmCallOptions {
  messages: LlmMessage[]
  jsonMode?: boolean
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[]
  maxTokens?: number
  temperature?: number | null
  signal?: AbortSignal
  novelId?: number | null
  guidance?: string // P19 ①：本次单次引导
  // v0.9.2（审查 #25）：流式模式——章节 SSE 生成并入统一路径（此前 generate.ts 独立 OpenAI client，
  // 不参与候选链降级/错误分类/记账，且 body 构造已出现漂移）
  stream?: boolean
  onDelta?: (text: string) => void
  onThinking?: (text: string) => void
}

export interface LlmResult {
  content: string
  reasoningContent?: string
  usage: {
    input: number
    output: number
    cacheHit: number
    cacheMiss: number
  }
  model: string
  provider: string
  degraded: boolean
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
  // v0.23.1（批次 A4）：max_tokens 截断显式检测（finish_reason === 'length'）——
  // 此前截断静默通过，仅靠下游 JSON 解析失败间接感知；语法完整的截断正文会被当完整章节落库
  truncated?: boolean
}
