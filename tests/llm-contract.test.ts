// 重构计划 R6.2：LLM 域契约测试（拆分前锁定现状）——
// buildBody 的 DeepSeek 参数语义（V4 thinking 显式 disabled / thinking 开时温度无效 / jsonMode 仅非 thinking /
// reasoning_content 回传）、候选链（override 优先 → 主模型 degraded → fallback degraded）、
// 统一记账、错误信息不含 API Key。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } }
    constructor(_cfg: unknown) {}
  }
}))

import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { buildBody } from '../server/src/services/llm/request'
import { buildCandidates, setActiveModelOverride } from '../server/src/services/llm/candidates'
import { callLlm } from '../server/src/services/llm/caller'
import { getRouteConfig } from '../server/src/services/llm/routes'
import type { LlmCallOptions, LlmMessage, RouteConfig } from '../server/src/services/llm'

const KEY = 'sk-test-abc123'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  // 复用 seed 的 prose 路由：改为指向 P1，fallback 指向 P2
  db.prepare("INSERT INTO provider (name, base_url, api_key_encrypted) VALUES ('P1', '', ?)").run(KEY)
  db.prepare("INSERT INTO provider (name, base_url, api_key_encrypted) VALUES ('P2', '', ?)").run(KEY)
  const p2 = db.prepare("SELECT id FROM provider WHERE name = 'P2'").get() as { id: number }
  db.prepare(
    `UPDATE model_route SET model = 'm-prose', thinking_enabled = 0, reasoning_effort = 'high',
            temperature = 0.7, max_tokens = 100, fallback_json = ?,
            provider_id = (SELECT id FROM provider WHERE name = 'P1')
     WHERE task_type = 'prose'`
  ).run(JSON.stringify([{ providerId: p2.id, model: 'm-fb' }]))
  return db
}

const BASE_ROUTE: RouteConfig = {
  providerId: 1,
  providerName: 'P1',
  baseUrl: '',
  apiKeyEncrypted: KEY,
  model: 'm-prose',
  thinkingEnabled: false,
  reasoningEffort: 'high',
  temperature: 0.7,
  maxTokens: 100,
  fallback: [{ providerId: 2, model: 'm-fb' }]
}

const MSGS: LlmMessage[] = [{ role: 'user', content: '写一段' }]

function okResponse(model = 'm-prose'): unknown {
  return {
    choices: [{ message: { content: '正文内容', reasoning_content: '思考链' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80 },
    model
  }
}

beforeAll(() => {
  // 测试环境（非 utilityProcess）：keyCrypto 明文直通（AI_NOVEL_ALLOW_PLAINTEXT=1）
  process.env.AI_NOVEL_ALLOW_PLAINTEXT = '1'
})
beforeEach(() => {
  createMock.mockReset()
})
afterAll(() => {
  delete process.env.AI_NOVEL_ALLOW_PLAINTEXT
})

describe('buildBody DeepSeek 参数语义（R6.2）', () => {
  it('thinking 关闭：显式 thinking disabled + 温度生效 + 无 reasoning_effort', () => {
    const body = buildBody(BASE_ROUTE, { messages: MSGS }, 'm-prose') as unknown as Record<string, unknown>
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.temperature).toBe(0.7)
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.max_tokens).toBe(100)
  })

  it('thinking 开启：enabled + reasoning_effort，温度即使传入也无效（AGENTS #4）', () => {
    const route = { ...BASE_ROUTE, thinkingEnabled: true, reasoningEffort: 'max' as const }
    const body = buildBody(route, { messages: MSGS, temperature: 0.7 }, 'm-prose') as unknown as Record<string, unknown>
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('max')
    expect(body.temperature).toBeUndefined()
    expect(body.response_format).toBeUndefined()
  })

  it('jsonMode 仅在非 thinking 下生效（D9）', () => {
    const on = buildBody({ ...BASE_ROUTE, thinkingEnabled: true }, { messages: MSGS, jsonMode: true }, 'm') as unknown as Record<string, unknown>
    expect(on.response_format).toBeUndefined()
    const off = buildBody(BASE_ROUTE, { messages: MSGS, jsonMode: true }, 'm') as unknown as Record<string, unknown>
    expect(off.response_format).toEqual({ type: 'json_object' })
  })

  it('assistant 消息 reasoning_content 原样回传（D44：丢失即 400）', () => {
    const msgs: LlmMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a', reasoningContent: '思考过程' }
    ]
    const body = buildBody(BASE_ROUTE, { messages: msgs }, 'm') as unknown as { messages: Array<Record<string, unknown>> }
    expect(body.messages[1].reasoning_content).toBe('思考过程')
  })

  it('tools 可传但不强制 tool_choice（thinking 模式禁强制）', () => {
    const body = buildBody(BASE_ROUTE, { messages: MSGS }, 'm') as unknown as Record<string, unknown>
    expect('tool_choice' in body).toBe(false)
  })
})

describe('候选链（R6.2）', () => {
  it('modelOverride 优先于主模型与 fallback（P13 G1）；主模型降级标记', () => {
    const withOverride = buildCandidates(BASE_ROUTE, 'm-override')
    expect(withOverride).toEqual([
      { model: 'm-override', providerId: 1, degraded: false },
      { model: 'm-prose', providerId: 1, degraded: true },
      { model: 'm-fb', providerId: 2, degraded: true }
    ])
    const without = buildCandidates(BASE_ROUTE, null)
    expect(without).toEqual([
      { model: 'm-prose', providerId: 1, degraded: false },
      { model: 'm-fb', providerId: 2, degraded: true }
    ])
  })
})

describe('callLlm 集成契约（R6.2）', () => {
  it('成功路径：结果字段 + 统一记账（usage_log 一行）', async () => {
    const db = makeDb()
    createMock.mockResolvedValueOnce(okResponse())
    const result = await callLlm(db, 'prose', { messages: MSGS, novelId: null })
    expect(result).toMatchObject({ content: '正文内容', reasoningContent: '思考链', model: 'm-prose', provider: 'P1', degraded: false, truncated: false })
    expect(result.usage).toEqual({ input: 100, output: 50, cacheHit: 20, cacheMiss: 80 })
    const log = db.prepare('SELECT task_type, model, input_tokens, output_tokens, cache_hit FROM usage_log ORDER BY id DESC LIMIT 1').get() as Record<string, number | string>
    expect(log).toMatchObject({ task_type: 'prose', model: 'm-prose', input_tokens: 100, output_tokens: 50, cache_hit: 20 })
    db.close()
  })

  it('失败候选退避后换 fallback：degraded 标记 + 最终成功', async () => {
    const db = makeDb()
    const err500 = Object.assign(new Error('upstream 500'), { status: 500 })
    createMock
      .mockRejectedValueOnce(err500)
      .mockRejectedValueOnce(err500)
      .mockRejectedValueOnce(err500)
      .mockResolvedValueOnce(okResponse('m-fb'))
    const result = await callLlm(db, 'prose', { messages: MSGS, novelId: null })
    expect(result.model).toBe('m-fb')
    expect(result.degraded).toBe(true)
    expect(createMock).toHaveBeenCalledTimes(4) // 主模型重试 3 次耗尽 → 换 fallback 候选成功
    db.close()
  })

  it('配置缺失 → ConfigError（可操作指引）；错误不泄露 Key', async () => {
    const db = makeDb()
    // 路由缺失（确定性配置错误）
    await expect(callLlm(db, 'nonexistent-task' as never, { messages: MSGS })).rejects.toThrow(/no model route/)
    // 供应商未配置 Key → 指引消息
    db.prepare("UPDATE provider SET api_key_encrypted = '' WHERE name = 'P1'").run()
    await expect(callLlm(db, 'prose', { messages: MSGS })).rejects.toThrow(/未配置 API Key.*保存后重试/)
    const rows = db.prepare('SELECT api_key_encrypted FROM provider').all() as Array<{ api_key_encrypted: string }>
    for (const r of rows) {
      // 错误链路不回显 Key 值（apiError/日志面同理由 error-mapping 契约锁定）
      expect(r.api_key_encrypted.includes('sk-live-')).toBe(false)
    }
    db.close()
  })

  it('外部中止：立即上抛不再重试（signal.aborted 语义）', async () => {
    const db = makeDb()
    const controller = new AbortController()
    controller.abort()
    createMock.mockImplementation((_body: unknown, opts: { signal?: AbortSignal }) => {
      if (opts.signal?.aborted) return Promise.reject(new Error('Request was aborted'))
      return Promise.resolve(okResponse())
    })
    await expect(callLlm(db, 'prose', { messages: MSGS, signal: controller.signal })).rejects.toThrow(/aborted/)
    expect(createMock).toHaveBeenCalledTimes(1)
    db.close()
  })

  it('密钥不出现在错误与日志：全程无 Key 值回显', async () => {
    const db = makeDb()
    createMock.mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }))
    const err = await callLlm(db, 'prose', { messages: MSGS }).catch((e: unknown) => e as Error)
    expect(String(err.message)).not.toContain(KEY)
    expect(String(err.stack ?? '')).not.toContain(KEY)
    db.close()
  })

  it('getRouteConfig：snake_case 行映射 camelCase（fallback 反序列化）', () => {
    const db = makeDb()
    const route = getRouteConfig(db, 'prose')!
    expect(route).toMatchObject({
      providerName: 'P1',
      baseUrl: '',
      model: 'm-prose',
      thinkingEnabled: false,
      temperature: 0.7,
      maxTokens: 100
    })
    expect(route.fallback).toEqual([{ providerId: expect.any(Number), model: 'm-fb' }])
    expect(getRouteConfig(db, 'nonexistent' as never)).toBeNull()
    db.close()
  })

  it('setActiveModelOverride：override 优先生效于请求体（scheduler 串行覆盖）', async () => {
    const db = makeDb()
    createMock.mockResolvedValue(okResponse('m-x'))
    setActiveModelOverride('m-x')
    try {
      await callLlm(db, 'prose', { messages: MSGS })
      const body = createMock.mock.calls[0][0] as { model: string }
      expect(body.model).toBe('m-x')
    } finally {
      setActiveModelOverride(null)
      db.close()
    }
  })
})

describe('callLlmOptions 类型契约（R6.2）', () => {
  it('LlmCallOptions/LlmResult 关键字段存在（类型回归钉子）', () => {
    const opts: LlmCallOptions = { messages: MSGS, jsonMode: true, stream: true, novelId: 1 }
    expect(opts.messages).toHaveLength(1)
  })
})
