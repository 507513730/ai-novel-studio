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
  guidance?: string // P19 ??????????????
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
}

// v0.9.0（审查 #25）：导出供 generate.ts 复用（消除双 LLM 路径的 body 构造漂移）
export function buildBody(
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
  _attempt = 1
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

    // v0.9.0（审查 #11/#23）：重试绑定"当前失败候选"（不再从头候选链重跑——必败候选被重复调用浪费 token）
    for (let tryCount = 1; tryCount <= 3; tryCount++) {
      try {
        const body = buildBody(
          { ...route, providerId: candidate.providerId, model: candidate.model },
          opts,
          candidate.model
        )
        if (opts.stream) {
          // v0.9.2（审查 #25）：流式分支——章节 SSE 生成并入统一路径（候选链降级/记账/signal 一致）
          const stream = await client.chat.completions.create(
            {
              ...(body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming),
              stream: true,
              stream_options: { include_usage: true }
            },
            { signal: opts.signal }
          )
          let content = ''
          let reasoning = ''
          let usage: LlmResult['usage'] = { input: 0, output: 0, cacheHit: 0, cacheMiss: 0 }
          try {
            for await (const chunk of stream) {
              if (opts.signal?.aborted) break
              const delta = chunk.choices[0]?.delta
              if (delta) {
                const r = delta as unknown as { reasoning_content?: string }
                if (r.reasoning_content) {
                  reasoning += r.reasoning_content
                  opts.onThinking?.(r.reasoning_content)
                }
                if (delta.content) {
                  content += delta.content
                  opts.onDelta?.(delta.content)
                }
              }
              if (chunk.usage) usage = extractUsage(chunk.usage)
            }
          } catch (err) {
            if (!opts.signal?.aborted) throw err
            // abort：返回部分结果，调用方按 signal.aborted 感知
          }
          const result: LlmResult = {
            content,
            reasoningContent: reasoning || undefined,
            usage,
            model: candidate.model,
            provider: providerRow.name,
            degraded: candidate.degraded
          }
          // abort 时不记账（调用方按上下文预算估算补账，见 generate.ts）；正常完成统一记账
          if (!opts.signal?.aborted) {
            recordUsage(db, {
              novelId: opts.novelId ?? null,
              taskType,
              provider: result.provider,
              model: result.model,
              inputTokens: usage.input,
              outputTokens: usage.output,
              cacheHit: usage.cacheHit,
              cacheMiss: usage.cacheMiss,
              costEstimate: 0,
              degraded: result.degraded
            })
          }
          return result
        }
        const response = await client.chat.completions.create(
          body as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
          // v0.9.0（审查 #11）：signal 转发——此前声明但从未传入 SDK，所有经 callLlm 的中止均无效
          { signal: opts.signal }
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
        if (opts.signal?.aborted) {
          // 外部中止：立即上抛（不再重试/换候选），调用方按中止语义处理
          throw err
        }
        lastError = err
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? (err as { status: number }).status
            : undefined
        if (status !== undefined && RETRYABLE_STATUS.includes(status) && tryCount < 3) {
          // v0.9.0（审查 #23）：429 优先读 Retry-After（上限 30s）
          if (status === 429 && typeof err === 'object' && err !== null) {
            const h = (err as { headers?: Record<string, string | undefined> }).headers
            const ra = h?.['retry-after'] ?? h?.['Retry-After']
            if (ra && /^\d+$/.test(ra)) {
              await new Promise((resolve) => setTimeout(resolve, Math.min(Number(ra) * 1000, 30_000)))
              continue
            }
          }
          const delay = 500 * 2 ** (tryCount - 1)
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        // 非可重试错误或次数耗尽：换下一个 fallback 候选
        break
      }
    }
  }

  throw new Error(
    `LLM call failed for task ${taskType}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}
