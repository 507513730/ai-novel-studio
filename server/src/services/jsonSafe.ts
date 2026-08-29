import { DatabaseSync } from 'node:sqlite'
import { callLlm } from './llm/caller'
import type { LlmCallOptions } from './llm/types'
import { getGuidance, buildGuidanceBlock, getWritingSettings, buildWritingRules } from './guidance'
import type { TaskType } from '../db/seed'

export const MAX_RETRIES = 3

export function extractJson(text: string): string {
  // 剥离 markdown 代码块
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  // 找第一个 { 到最后一个 }（容忍前后有解释文字）
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  // 数组形式
  const arrStart = text.indexOf('[')
  const arrEnd = text.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) return text.slice(arrStart, arrEnd + 1)
  return text.trim()
}

/**
 * 调用 LLM 并要求 JSON 输出，带解析重试与截断检测（PLAN 修正 #4 JSON 鲁棒性三件套）
 */
export async function callLlmJson<T>(
  db: DatabaseSync,
  taskType: TaskType,
  opts: LlmCallOptions,
  parse: (obj: unknown) => T | null,
  label = 'structured-output'
): Promise<T> {
  let lastError: unknown = null
  let retryHint = '' // v0.9.0：重试反馈（上一次失败原因注入 prompt，帮助模型自愈——截断/结构问题）
  // P19 ①：书级引导 + 单次引导（注入 user 消息首条，保持模型关注）
  let guidedOpts = opts
  if (opts.novelId && opts.messages[0]?.content) {
    const block = buildGuidanceBlock(getGuidance(db, opts.novelId), opts.guidance)
    if (block) {
      guidedOpts = {
        ...opts,
        messages: [{ ...opts.messages[0], content: opts.messages[0].content + '\n\n' + block }, ...opts.messages.slice(1)]
      }
    }
  }
  // P19 ②⑤：写作偏好规则（语言/格式/模式；偏离默认才注入，改设置→hash 变→缓存失效）
  const writingRules = buildWritingRules(getWritingSettings(db))
  if (writingRules && guidedOpts.messages[0]?.content) {
    guidedOpts = {
      ...guidedOpts,
      messages: [
        { ...guidedOpts.messages[0], content: guidedOpts.messages[0].content + '\n\n【写作要求】\n' + writingRules },
        ...guidedOpts.messages.slice(1)
      ]
    }
  }
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const messages = retryHint
      ? [{ ...guidedOpts.messages[0], content: `${guidedOpts.messages[0].content ?? ''}\n\n【上次输出问题】${retryHint}` }, ...guidedOpts.messages.slice(1)]
      : guidedOpts.messages
    const result = await callLlm(db, taskType, { ...guidedOpts, messages, jsonMode: true })
    // v0.23.1（批次 A4）：显式截断检测（finish_reason=length）——截断的 JSON 必不完整，
    // 旧逻辑靠解析失败间接感知；注入"精简输出"反馈后重试（PLAN #10 截断即重试）
    if (result.truncated) {
      retryHint =
        '上次输出被 max_tokens 截断（finish_reason=length）——请大幅精简输出（去除解释性文字、压缩字段内容），确保 JSON 完整闭合'
      lastError = new Error(
        `${label} 输出被 max_tokens 截断（第 ${attempt} 次）；原文片段: ${result.content.slice(0, 120)}`
      )
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 400 * attempt))
      }
      continue
    }
    const raw = extractJson(result.content)
    try {
      const parsed = JSON.parse(raw)
      const value = parse(parsed)
      if (value !== null) return value
      retryHint = `JSON 结构不符合要求（${label}），请严格按要求的字段输出，不要多余字段`
      lastError = new Error(`schema validation failed for ${label}；原文片段: ${raw.slice(0, 150)}`)
    } catch (err) {
      // v0.9.0：截断/解析失败时反馈给模型（重试提示精简输出）——此前重试发完全相同的 prompt，
      // 模型持续输出坏 JSON（纯烧 3 次 token）
      const parseMsg = err instanceof Error ? err.message : String(err)
      retryHint = `上次输出解析失败（${parseMsg.slice(0, 80)}）——请输出更紧凑的 JSON，确保完整闭合`
      lastError = new Error(
        `${label} JSON 解析失败（第 ${attempt} 次）: ${parseMsg}；原文片段: ${raw.slice(0, 150)}`
      )
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 400 * attempt))
    }
  }
  throw new Error(
    `LLM JSON 输出解析失败（${label}，重试 ${MAX_RETRIES} 次）: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}
