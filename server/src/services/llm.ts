import OpenAI from 'openai'
import { DatabaseSync } from 'node:sqlite'
import type { TaskType } from '../db/seed'
import { decryptSecret } from './keyCrypto'
import { recordUsage } from './usage'

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

export function getRouteConfig(db: DatabaseSync, taskType: TaskType): RouteConfig | null {
  const row = db
    .prepare(
      `SELECT mr.id, mr.task_type, mr.model, mr.thinking_enabled, mr.reasoning_effort,
              mr.temperature, mr.max_tokens, mr.fallback_json,
              p.id AS provider_id, p.name AS provider_name, p.base_url, p.api_key_encrypted
       FROM model_route mr JOIN provider p ON p.id = mr.provider_id
       WHERE mr.task_type = ?`
    )
    .get(taskType) as
    | {
        provider_id: number
        provider_name: string
        base_url: string
        api_key_encrypted: string
        model: string
        thinking_enabled: number
        reasoning_effort: string
        temperature: number | null
        max_tokens: number
        fallback_json: string
      }
    | undefined

  if (!row) return null
  return {
    providerId: row.provider_id,
    providerName: row.provider_name,
    baseUrl: row.base_url,
    apiKeyEncrypted: row.api_key_encrypted,
    model: row.model,
    thinkingEnabled: row.thinking_enabled === 1,
    reasoningEffort: (row.reasoning_effort as RouteConfig['reasoningEffort']) || 'high',
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    fallback: JSON.parse(row.fallback_json) as RouteConfig['fallback']
  }
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
}

function buildBody(
  route: RouteConfig,
  opts: LlmCallOptions,
  model: string
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const messages = opts.messages.map((m) => {
    const base: Record<string, unknown> = { role: m.role, content: m.content ?? '' }
    if (m.reasoningContent) base.reasoning_content = m.reasoningContent
    if (m.toolCallId) base.tool_call_id = m.toolCallId
    if (m.name) base.name = m.name
    if (m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls.map((tc) => {
        const fn = (tc as unknown as { function?: { name: string; arguments: unknown } }).function
        return {
          id: tc.id,
          type: 'function',
          function: {
            name: fn?.name ?? '',
            arguments: typeof fn?.arguments === 'string' ? fn.arguments : JSON.stringify(fn?.arguments ?? {})
          }
        }
      })
    }
    return base
  })

  const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    max_tokens: opts.maxTokens ?? route.maxTokens
  }
  const bodyRecord = body as unknown as Record<string, unknown>

  // DeepSeek thinking: V4 默认 thinking 开，off 必须显式传 disabled（否则温度无效+空 content）
  if (route.thinkingEnabled) {
    bodyRecord.thinking = { type: 'enabled' }
    bodyRecord.reasoning_effort = route.reasoningEffort
  } else {
    bodyRecord.thinking = { type: 'disabled' }
    const temp = opts.temperature !== undefined ? opts.temperature : route.temperature
    if (temp !== null && temp !== undefined) body.temperature = temp
  }

  // thinking 模式禁止强制 tool_choice，tools 可传但不断言 tool_choice
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
  }
  if (opts.jsonMode && !route.thinkingEnabled) {
    bodyRecord.response_format = { type: 'json_object' }
  }

  return body
}

function extractUsage(
  usage: OpenAI.Completions.CompletionUsage | undefined
): LlmResult['usage'] {
  const u = usage as unknown as {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
  }
  const input = u?.prompt_tokens ?? 0
  return {
    input,
    output: u?.completion_tokens ?? 0,
    cacheHit: u?.prompt_cache_hit_tokens ?? 0,
    cacheMiss: u?.prompt_cache_miss_tokens ?? input
  }
}

const RETRYABLE_STATUS = [429, 500, 502, 503, 504]

// P13 G1：活动模型覆盖（换模型重试）——scheduler 单例执行期间设置，串行安全
let activeModelOverride: string | null = null
export function setActiveModelOverride(model: string | null): void {
  activeModelOverride = model
}
export function getActiveModelOverride(): string | null {
  return activeModelOverride
}

// 纯函数：候选链构造（override 模型优先，失败仍可走 fallback）
export function buildCandidates(
  route: { model: string; providerId: number; fallback: Array<{ providerId: number; model: string }> },
  override: string | null
): Array<{ model: string; providerId: number; degraded: boolean }> {
  const head = override ? { model: override, providerId: route.providerId, degraded: false } : null
  return [
    ...(head ? [head] : []),
    { model: route.model, providerId: route.providerId, degraded: head !== null },
    ...route.fallback.map((f) => ({
      model: f.model,
      providerId: f.providerId,
      degraded: true
    }))
  ]
}

export async function callLlm(
  db: DatabaseSync,
  taskType: TaskType,
  opts: LlmCallOptions,
  attempt = 1
): Promise<LlmResult> {
  const route = getRouteConfig(db, taskType)
  if (!route) throw new Error(`no model route for task: ${taskType}`)
  if (!route.apiKeyEncrypted) {
    throw new Error(`provider ${route.providerName} has no API key configured`)
  }

  const candidates = buildCandidates(route, activeModelOverride)

  let lastError: unknown
  for (const candidate of candidates) {
    const providerRow = db
      .prepare('SELECT name, base_url, api_key_encrypted FROM provider WHERE id = ?')
      .get(candidate.providerId) as { name: string; base_url: string; api_key_encrypted: string }
    if (!providerRow?.api_key_encrypted) continue
    const apiKey = await decryptSecret(providerRow.api_key_encrypted)

    const client = new OpenAI({
      baseURL: providerRow.base_url || undefined,
      apiKey,
      timeout: 120_000
    })

    try {
      const body = buildBody(
        { ...route, providerId: candidate.providerId, model: candidate.model },
        opts,
        candidate.model
      )
      const response = await client.chat.completions.create(
        body as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
      )
      const message = response.choices[0]?.message
      const m = message as unknown as { reasoning_content?: string }
      const result: LlmResult = {
        content: message?.content ?? '',
        reasoningContent: m.reasoning_content,
        usage: extractUsage(response.usage),
        model: response.model ?? candidate.model,
        provider: providerRow.name,
        degraded: candidate.degraded,
        toolCalls: message?.tool_calls
      }
      // 统一记账（novelId 由调用方经 opts 传入）
      recordUsage(db, {
        novelId: opts.novelId ?? null,
        taskType,
        provider: result.provider,
        model: result.model,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cacheHit: result.usage.cacheHit,
        cacheMiss: result.usage.cacheMiss,
        costEstimate: 0,
        degraded: result.degraded
      })
      return result
    } catch (err) {
      lastError = err
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status: number }).status
          : undefined
      if (status !== undefined && RETRYABLE_STATUS.includes(status) && attempt < 3) {
        const delay = 500 * 2 ** (attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, delay))
        return callLlm(db, taskType, opts, attempt + 1)
      }
      // 非可重试错误：换下一个 fallback 候选
    }
  }

  throw new Error(
    `LLM call failed for task ${taskType}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}
