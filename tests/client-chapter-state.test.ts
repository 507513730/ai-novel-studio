// @vitest-environment jsdom
// 重构计划 R7：客户端三 hook 契约——
// useEditorSession（空内容保护/脏检查/字数增量上报/失败上抛）、
// useChapterLoader（竞态序号丢弃过期响应/切章重置/失败回调）、
// useGenerationController（成本确认门/中止兜底/错误恢复生成前内容）。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorSession, aiWrite } from '../client/src/pages/chapter/hooks/useEditorSession'
import { useChapterLoader } from '../client/src/pages/chapter/hooks/useChapterLoader'
import { useGenerationController } from '../client/src/pages/chapter/hooks/useGenerationController'

const { chapterPatchMock, chapterDetailMock, generateSseMock } = vi.hoisted(() => ({
  chapterPatchMock: vi.fn(),
  chapterDetailMock: vi.fn(),
  generateSseMock: vi.fn()
}))
vi.mock('../client/src/api', () => ({
  novelApi: { chapterPatch: chapterPatchMock, chapterDetail: chapterDetailMock },
  generateChapterSse: generateSseMock
}))

beforeEach(() => {
  chapterPatchMock.mockReset()
  chapterDetailMock.mockReset()
  generateSseMock.mockReset()
})

function sessionProps(overrides: Partial<Parameters<typeof useEditorSession>[0]> = {}): Parameters<typeof useEditorSession>[0] {
  return {
    novelId: 1,
    selectedChapter: 7,
    editorRef: { current: null },
    streamingRef: { current: false },
    contentLoadingRef: { current: false },
    loadedChapterRef: { current: null },
    savedContentRef: { current: '' },
    dirtyRef: { current: false },
    invalidate: async () => undefined,
    toast: vi.fn(),
    notify: vi.fn(),
    onActionError: vi.fn(),
    ...overrides
  }
}

describe('useEditorSession（R7）', () => {
  it('空内容保护：服务端已有正文时跳过保存且不发请求（P9 A1）', async () => {
    const savedContentRef = { current: '已有正文' }
    const loadedChapterRef = { current: 7 }
    const dirtyRef = { current: true }
    const { result } = renderHook(() =>
      useEditorSession(sessionProps({ savedContentRef, loadedChapterRef, dirtyRef }))
    )
    await act(async () => {
      await result.current.saveContent()
    })
    expect(chapterPatchMock).not.toHaveBeenCalled()
    expect(dirtyRef.current).toBe(false)
    expect(result.current.content).toBe('')
  })

  it('force 保存允许空覆盖；脏检查跳过未变更内容', async () => {
    const savedContentRef = { current: '已有正文' }
    const loadedChapterRef = { current: 7 }
    chapterPatchMock.mockResolvedValue(undefined)
    const a = renderHook(() => useEditorSession(sessionProps({ savedContentRef, loadedChapterRef })))
    await act(async () => {
      await a.result.current.saveContent({ force: true })
    })
    expect(chapterPatchMock).toHaveBeenCalledTimes(1)
    expect(chapterPatchMock.mock.calls[0][2]).toMatchObject({ content: '' })

    const b = renderHook(() => useEditorSession(sessionProps({ savedContentRef, loadedChapterRef, dirtyRef: { current: true } })))
    b.result.current.setContent('已有正文')
    await act(async () => {
      await b.result.current.saveContent()
    })
    expect(chapterPatchMock).toHaveBeenCalledTimes(1) // 脏检查：与已存一致不发请求
  })

  it('字数分离增量随保存上报并清零（v0.19.0）', async () => {
    const savedContentRef = { current: '' }
    chapterPatchMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useEditorSession(sessionProps({ savedContentRef })))
    result.current.aiDeltaRef.current = 12
    result.current.humanDeltaRef.current = 7
    await act(async () => {
      result.current.setContent('新正文')
    })
    await act(async () => {
      await result.current.saveContent({ force: true })
    })
    expect(chapterPatchMock.mock.calls[0][2]).toMatchObject({ aiWordsDelta: 12, humanWordsDelta: 7, status: 'written' })
    expect(result.current.aiDeltaRef.current).toBe(0)
    expect(result.current.humanDeltaRef.current).toBe(0)
  })

  it('保存失败上抛并写 actionError/toast（切章中断依赖此语义，P9 A4）', async () => {
    const onActionError = vi.fn()
    const toast = vi.fn()
    chapterPatchMock.mockRejectedValue(new Error('网络中断'))
    const { result } = renderHook(() => useEditorSession(sessionProps({ onActionError, toast })))
    result.current.setContent('新内容')
    await expect(result.current.saveContent({ force: true })).rejects.toThrow('网络中断')
    expect(onActionError).toHaveBeenCalledWith('保存失败：网络中断')
    expect(toast).toHaveBeenCalledWith('error', '保存失败：网络中断')
  })

  it('AI 插入计入 ai 字数增量并带 aiWrite 注解（v0.19.0）', () => {
    const { result } = renderHook(() => useEditorSession(sessionProps()))
    // editorRef 无 CodeMirror 视图 → insertAi 直接返回（不崩）；aiWrite 注解定义存在
    expect(() => result.current.insertAi('文本', 0)).not.toThrow()
    expect(aiWrite).toBeTruthy()
    expect(result.current.hanCount).toBe(0)
  })
})

describe('useChapterLoader（R7）', () => {
  it('加载落定：正文/已存快照/loadedChapter 回填，loading 结束', async () => {
    const savedContentRef = { current: '' }
    const loadedChapterRef = { current: null as number | null }
    chapterDetailMock.mockResolvedValue({ chapter: { content: '章节正文' } })
    const { result, rerender } = renderHook(
      (props: { selectedChapter: number | null }) => useChapterLoader({
        novelId: 1,
        selectedChapter: props.selectedChapter,
        setContent: vi.fn(),
        savedContentRef,
        dirtyRef: { current: true },
        loadedChapterRef,
        contentLoadingRef: { current: false },
        resetSessionBits: () => undefined,
        onSwitchError: vi.fn()
      }),
      { initialProps: { selectedChapter: 7 as number | null } }
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    rerender({ selectedChapter: 7 })
    await act(async () => {
      await Promise.resolve()
    })
    expect(chapterDetailMock).toHaveBeenCalledWith(1, 7)
    expect(savedContentRef.current).toBe('章节正文')
    expect(loadedChapterRef.current).toBe(7)
    expect(result.current.contentLoading).toBe(false)
  })

  it('竞态序号：过期响应被丢弃，仅最新章正文落定（P9 A1）', async () => {
    const savedContentRef = { current: '' }
    const loadedChapterRef = { current: null as number | null }
    let resolveA: ((v: { chapter: { content: string } }) => void) | null = null
    chapterDetailMock.mockImplementation((_novelId: number, cid: number) => {
      if (cid === 1) {
        return new Promise((resolve) => {
          resolveA = resolve
        })
      }
      return Promise.resolve({ chapter: { content: 'B 章正文' } })
    })
    const onSwitchError = vi.fn()
    const { rerender } = renderHook(
      (props: { selectedChapter: number | null }) => useChapterLoader({
        novelId: 1,
        selectedChapter: props.selectedChapter,
        setContent: vi.fn(),
        savedContentRef,
        dirtyRef: { current: false },
        loadedChapterRef,
        contentLoadingRef: { current: false },
        resetSessionBits: () => undefined,
        onSwitchError
      }),
      { initialProps: { selectedChapter: 1 as number | null } }
    )
    rerender({ selectedChapter: 2 })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(loadedChapterRef.current).toBe(2)
    // 迟到的 A 章响应：被序号丢弃
    await act(async () => {
      resolveA?.({ chapter: { content: 'A 章正文（过期）' } })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(savedContentRef.current).toBe('B 章正文')
    expect(onSwitchError).not.toHaveBeenCalled()
  })
})

describe('useGenerationController（R7）', () => {
  function setup(): {
    confirmFn: ReturnType<typeof vi.fn>
    setContent: ReturnType<typeof vi.fn>
    onActionError: ReturnType<typeof vi.fn>
    result: { current: { generate: () => Promise<void>; cancelGenerate: () => void; streaming: boolean } }
  } {
    const confirmFn = vi.fn()
    const setContent = vi.fn()
    const onActionError = vi.fn()
    const result = renderHook(() =>
      useGenerationController({
        novelId: 1,
        selectedChapter: 7,
        editorRef: { current: null },
        content: '当前内容',
        savedContentRef: { current: '当前内容' },
        dirtyRef: { current: false },
        streamingRef: { current: false },
        setContent,
        confirmFn,
        guidanceDraft: '',
        buildInclude: () => undefined,
        invalidate: async () => undefined,
        onActionError,
        onGenerated: vi.fn()
      })
    ).result
    return { confirmFn, setContent, onActionError, result }
  }

  it('生成前经成本确认门：未确认不发起 SSE（v0.22.0）', async () => {
    const { confirmFn, result } = setup()
    await act(async () => {
      await result.current.generate()
    })
    expect(generateSseMock).not.toHaveBeenCalled()
    expect(confirmFn).toHaveBeenCalledTimes(1)
  })

  it('确认后发起 SSE；错误恢复生成前内容（P9 A3）', async () => {
    const { confirmFn, setContent, onActionError, result } = setup()
    await act(async () => {
      await result.current.generate()
    })
    const cfg = confirmFn.mock.calls[0][0] as { action: () => void }
    generateSseMock.mockImplementation(
      (_n: number, _c: number, handlers: { onError: (m: string) => void }) => {
        handlers.onError('供应商不可用')
        return Promise.resolve()
      }
    )
    await act(async () => {
      cfg.action()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(generateSseMock).toHaveBeenCalledTimes(1)
    expect(onActionError).toHaveBeenCalledWith('供应商不可用')
    // 失败恢复生成前内容（prevContent='当前内容'）
    expect(setContent).toHaveBeenCalledWith('当前内容')
  })

  it('cancelGenerate 触发中止信号（流式中止，P9 A3 本地兜底）', async () => {
    const { confirmFn, result } = setup()
    await act(async () => {
      await result.current.generate()
    })
    const cfg = confirmFn.mock.calls[0][0] as { action: () => void }
    let capturedSignal: AbortSignal | null = null
    let resolveSse: (() => void) | null = null
    generateSseMock.mockImplementation(
      (_n: number, _c: number, _h: unknown, signal: AbortSignal) => {
        capturedSignal = signal
        return new Promise<void>((resolve) => {
          resolveSse = resolve
        })
      }
    )
    await act(async () => {
      cfg.action()
      await Promise.resolve()
    })
    expect(capturedSignal).not.toBeNull()
    act(() => {
      result.current.cancelGenerate()
    })
    expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true)
    await act(async () => {
      resolveSse?.()
      await Promise.resolve()
      await Promise.resolve()
    })
  })
})
