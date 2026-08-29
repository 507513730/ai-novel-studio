// LLM 域供应商调用主循环（重构计划 R6.2 / spec §3.5）：
// 候选链遍历 + 单候选限次重试 + abort 立即上抛 + 统一记账。
// API Key 只进 SDK 客户端——错误、日志、trace 不得回显（契约测试锁定）。
import OpenAI from 'openai'
import type { DatabaseSync } from 'node:sqlite'
import type { TaskType } from '../../db/seed'
import { decryptSecret } from '../keyCrypto'
import { recordUsage } from '../usage'
import { ConfigError } from './errors'
import { getRouteConfig } from './routes'
import { buildCandidates, getActiveModelOverride, RETRYABLE_STATUS } from './candidates'
import { buildBody, extractUsage } from './request'
import type { LlmCallOptions, LlmResult } from './types'

export async function callLlm(
  db: DatabaseSync,
  taskType: TaskType,
  opts: LlmCallOptions
): Promise<LlmResult> {
  const route = getRouteConfig(db, taskType)
  if (!route) throw new ConfigError(`no model route for task: ${taskType}`)
  if (!route.apiKeyEncrypted) {
    throw new ConfigError(`供应商「${route.providerName}」未配置 API Key——请在 设置 → 供应商 保存后重试`)
  }

  const candidates = buildCandidates(route, getActiveModelOverride())

  let lastError: unknown
  for (const candidate of candidates) {
    const providerRow = db
      .prepare('SELECT name, base_url, api_key_encrypted FROM provider WHERE id = ?')
      .get(candidate.providerId) as { name: string; base_url: string; api_key_encrypted: string }
    if (!providerRow?.api_key_encrypted) continue
    // v0.24.3：解密失败是环境级确定错误（密文来自旧环境/明文时代），包装为 ConfigError
    // 让生产管线首个即熔断，并给出可操作指引（历史：任务 28/29 逐章空转 27 次）
    let apiKey: string
    try {
      apiKey = await decryptSecret(providerRow.api_key_encrypted)
    } catch (err) {
      throw new ConfigError(
        `API Key 解密失败（供应商「${providerRow.name}」）——密文可能来自旧环境或备份恢复；请在 设置 → 供应商 重新保存 API Key`,
        { cause: err }
      )
    }

    const client = new OpenAI({
      baseURL: providerRow.base_url || undefined,
      apiKey,
      timeout: 120_000,
      // v0.9.3（D80）：SDK 默认自动重试 2 次（429/408/409/>=500），与下方候选链 tryCount 3 叠加
      // 最多 9 次请求（过度重试）——设 1 次仅兜底瞬时抖动，主重试由候选链负责
      maxRetries: 1
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
          let finishReason: string | null = null
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
              // v0.23.1（批次 A4）：流式末块携带 finish_reason——length 即截断
              if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason
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
            degraded: candidate.degraded,
            truncated: !opts.signal?.aborted && finishReason === 'length'
          }
          // abort 时不记账（调用方按上下文预算估算补账，见章节生成域）；正常完成统一记账
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
          toolCalls: message?.tool_calls,
          truncated: response.choices[0]?.finish_reason === 'length'
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
