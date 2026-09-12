// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useGenerationController, type GenerationControllerDeps } from '../client/src/pages/chapter/hooks/useGenerationController'
import { generateChapterSse, novelApi } from '../client/src/api'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'

vi.mock('../client/src/api', () => ({ generateChapterSse: vi.fn(), novelApi: { chapterDetail: vi.fn(), createVersion: vi.fn() } }))

function setup() {
  const text = { value: '人工稿' }
  const deps: GenerationControllerDeps & { confirm: () => void; changeText: (value: string) => void } = {
    novelId: 1, selectedChapter: 2, editorRef: { current: { view: { state: { doc: { toString: () => text.value } } } } as unknown as ReactCodeMirrorRef }, content: text.value,
    changeText: (value: string) => { text.value = value },
    savedContentRef: { current: text.value }, dirtyRef: { current: false }, streamingRef: { current: false },
    confirm: () => undefined,
    setContent: vi.fn((v: string | ((previous: string) => string)) => { text.value = typeof v === 'function' ? v(text.value) : v }),
    confirmFn: ({ action }) => { deps.confirm = action }, guidanceDraft: '', buildInclude: () => undefined,
    invalidate: vi.fn().mockResolvedValue(undefined), onActionError: vi.fn(), onGenerated: vi.fn()
  }
  return deps
}

beforeEach(() => vi.clearAllMocks())

it('persisted=false 时保留服务端人工稿并提示候选', async () => {
  const deps = setup()
  vi.mocked(novelApi.chapterDetail).mockResolvedValue({ chapter: { content: '人工稿' } } as never)
  vi.mocked(generateChapterSse).mockImplementation(async (_n, _c, handlers) => {
    await handlers.onDone?.({ persisted: false, candidateVersionId: 7, content: 'AI', wordCount: 1, usage: { cacheHit: 0 } })
  })
  const { result } = renderHook(() => useGenerationController(deps))
  await act(async () => { await result.current.generate(); await deps.confirm() })
  expect(deps.setContent).toHaveBeenCalled()
  expect(deps.savedContentRef.current).toBe('人工稿')
  expect(deps.dirtyRef.current).toBe(false)
  expect(deps.onGenerated).toHaveBeenCalledWith(expect.stringContaining('人工稿未覆盖'))
})

it('确认期间正文改变不会启动 SSE', async () => {
  const deps = setup()
  const { result } = renderHook(() => useGenerationController(deps))
  await act(async () => { await result.current.generate() })
  deps.changeText('新输入')
  await act(async () => { deps.confirm() })
  expect(generateChapterSse).not.toHaveBeenCalled()
  expect(deps.onActionError).toHaveBeenCalledWith(expect.stringContaining('正文已变化'))
})

it('确认期间切章后旧确认不启动 SSE，也不写当前章错误', async () => {
  const deps = setup()
  const { result, rerender } = renderHook(props => useGenerationController(props), { initialProps: deps })
  await act(async () => { await result.current.generate() })
  const confirm = deps.confirm
  rerender({ ...deps, selectedChapter: 3 })
  await act(async () => { confirm() })
  expect(generateChapterSse).not.toHaveBeenCalled()
  expect(deps.onActionError).not.toHaveBeenCalled()
})

it('本地取消无回执时把累积存版本，再读取并保留外部人工稿', async () => {
  const deps = setup()
  vi.mocked(novelApi.createVersion).mockResolvedValue({ versionId: 8 } as never)
  vi.mocked(novelApi.chapterDetail).mockResolvedValue({ chapter: { content: '外部人工新稿' } } as never)
  vi.mocked(generateChapterSse).mockImplementation(async (_n, _c, handlers) => {
    await handlers.onAborted?.({ localFallback: true, content: '流中累积', wordCount: 4 })
  })
  const { result } = renderHook(() => useGenerationController(deps))
  await act(async () => { await result.current.generate(); deps.confirm() })
  expect(novelApi.createVersion).toHaveBeenCalledWith(1, 2, 'AI 待采用：本地取消时的累积内容', '流中累积')
  expect(deps.setContent).toHaveBeenLastCalledWith('外部人工新稿')
  expect(deps.savedContentRef.current).toBe('外部人工新稿')
  expect(deps.dirtyRef.current).toBe(false)
  expect(deps.onGenerated).toHaveBeenCalledWith(expect.stringContaining('累积结果已保留为待采用版本'))
  expect(deps.streamingRef.current).toBe(false)
})

it('本地取消累积版本保存失败时保留编辑器内容并标为未保存', async () => {
  const deps = setup()
  vi.mocked(novelApi.createVersion).mockRejectedValue(Error('离线'))
  vi.mocked(generateChapterSse).mockImplementation(async (_n, _c, handlers) => {
    await handlers.onAborted?.({ localFallback: true, content: '未持久化累积', wordCount: 6 })
  })
  const { result } = renderHook(() => useGenerationController(deps))
  await act(async () => { await result.current.generate(); deps.confirm() })
  expect(deps.setContent).toHaveBeenLastCalledWith('未持久化累积')
  expect(deps.savedContentRef.current).toBe('人工稿')
  expect(deps.dirtyRef.current).toBe(true)
  expect(deps.onActionError).toHaveBeenCalledWith(expect.stringContaining('保存状态未确认'))
  expect(deps.onGenerated).not.toHaveBeenCalled()
  expect(novelApi.chapterDetail).not.toHaveBeenCalled()
})
