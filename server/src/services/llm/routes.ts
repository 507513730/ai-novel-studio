// LLM 域路由读取（重构计划 R6.2）：model_route + provider → camelCase 配置。
import type { DatabaseSync } from 'node:sqlite'
import type { TaskType } from '../../db/seed'
import type { RouteConfig } from './types'

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
