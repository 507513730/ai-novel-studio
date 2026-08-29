// v0.23.1（批次 A4）：max_tokens 截断检测——callLlmJson 收到 truncated 结果时
// 注入精简反馈重试（不解析必不完整的 JSON），成功后正常返回
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../server/src/services/llm/caller', () => ({
  callLlm: vi.fn()
}))

import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { callLlm } from '../server/src/services/llm/caller'
import { callLlmJson } from '../server/src/services/jsonSafe'

const callLlmMock = vi.mocked(callLlm)

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function result(content: string, truncated: boolean): { content: string; truncated: boolean } {
  return { content, truncated }
}

beforeEach(() => {
  callLlmMock.mockReset()
})

describe('callLlmJson 截断检测（批次 A4）', () => {
  it('truncated 结果跳过解析直接重试，重试提示注入下轮 prompt', async () => {
    callLlmMock
      .mockResolvedValueOnce(result('{"items": [{"id": 1, "title": "很长'.repeat(20), true))
      .mockResolvedValueOnce(result('{"items": [{"id": 1}]}', false))

    const db = makeDb()
    const v = await callLlmJson(
      db,
      'extraction',
      { messages: [{ role: 'user', content: 'give json' }] },
      (o) => {
        const r = o as { items?: Array<{ id: number }> }
        return Array.isArray(r.items) ? { items: r.items } : null
      },
      'truncation-test'
    )

    expect(v).toEqual({ items: [{ id: 1 }] })
    expect(callLlmMock).toHaveBeenCalledTimes(2)
    // 第二次调用的 prompt 应含截断反馈提示（调用签名：db, taskType, opts）
    const secondCall = callLlmMock.mock.calls[1]
    const msgs = (secondCall?.[2] as { messages: Array<{ content: string | null }> }).messages
    expect(msgs[0].content ?? '').toContain('max_tokens 截断')
  })

  it('连续截断达到重试上限后抛错（含截断上下文）', async () => {
    callLlmMock.mockResolvedValue(result('{"a": 1', true))

    const db = makeDb()
    await expect(
      callLlmJson(db, 'extraction', { messages: [{ role: 'user', content: 'give json' }] }, (o) => o, 'always-truncated')
    ).rejects.toThrow('max_tokens 截断')
    expect(callLlmMock).toHaveBeenCalledTimes(3) // MAX_RETRIES = 3
  })
})
