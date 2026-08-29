// LLM 域请求体构造与响应 usage 提取（重构计划 R6.2）。
// DeepSeek 参数语义（契约测试锁定，AGENTS #4）：
//   V4 默认 thinking 开——off 必须显式 disabled（否则温度无效 + 空 content，D12）；
//   thinking 开时 temperature/top_p/penalty 全部无效；jsonMode 仅非 thinking 生效（D9）；
//   thinking 模式禁止强制 tool_choice；assistant 消息 reasoning_content 原样回传。
import type OpenAI from 'openai'
import type { LlmCallOptions, LlmResult, RouteConfig } from './types'

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

export function extractUsage(
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
