import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateChapterSse } from '../client/src/api'

// P9 A2：SSE 取消必须携带已累积内容（服务端 aborted 事件在 abort 后收不到）
function mockFetchStream(events: Array<{ event: string; data: unknown }>, signal: AbortSignal) {
  const encoder = new TextEncoder()
  const body = events.map((e) => encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`))
  let idx = 0
  const reader = {
    async read() {
      if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      if (idx < body.length) return { done: false as const, value: body[idx++] }
      // 事件发完后挂起，模拟进行中的长流（等待 abort 或超时）
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve()
          return
        }
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
      throw new DOMException('The operation was aborted.', 'AbortError')
    },
    cancel() {
      return undefined
    },
    releaseLock() {
      return undefined
    }
  }
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader } as unknown as ReadableStream<Uint8Array>,
    json: async () => null
  } as unknown as Response
}

describe('generateChapterSse 取消保留（P9 A2）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('abort 后 onAborted 携带已流式累积的内容', async () => {
    const controller = new AbortController()
    const events = [
      { event: 'delta', data: { text: '第一章：' } },
      { event: 'delta', data: { text: '雨夜追凶。' } }
    ]
    vi.stubGlobal('fetch', vi.fn(async () => mockFetchStream(events, controller.signal)))

    const onAborted = vi.fn()
    const onDelta = vi.fn()
    const onError = vi.fn()

    const p = generateChapterSse(1, 2, { onAborted, onDelta, onError }, controller.signal)
    // 等待两个 delta 处理完
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()
    await p

    expect(onDelta).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    expect(onAborted).toHaveBeenCalledTimes(1)
    const payload = onAborted.mock.calls[0][0] as { content: string; wordCount: number }
    expect(payload.content).toBe('第一章：雨夜追凶。')
    expect(payload.wordCount).toBe(9)
  })

  it('fetch 阶段立即取消 → 空累积（不报错）', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (controller.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      return mockFetchStream([], controller.signal)
    }))

    const onAborted = vi.fn()
    controller.abort()
    await generateChapterSse(1, 2, { onAborted }, controller.signal)

    expect(onAborted).toHaveBeenCalledTimes(1)
    expect(onAborted.mock.calls[0][0]).toEqual({ content: '', wordCount: 0, localFallback: true })
  })

  it('终态冲突处理后不再因取消重复执行本地兜底，并等待异步处理完成', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => mockFetchStream([
      { event: 'done', data: { content: '候选正文', persisted: false, candidateVersionId: 5 } }
    ], controller.signal)))
    let handled = false
    const onAborted = vi.fn()
    await generateChapterSse(1, 2, { onDone: async payload => {
      expect(payload.persisted).toBe(false)
      controller.abort()
      await Promise.resolve()
      handled = true
    }, onAborted }, controller.signal)
    expect(handled).toBe(true)
    expect(onAborted).not.toHaveBeenCalled()
  })
})
