// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { novelApi, waitForJob } from '../client/src/api'
import { useChapterActions } from '../client/src/pages/chapter/hooks/useChapterActions'
import { useChapterCandidates } from '../client/src/pages/chapter/hooks/useChapterCandidates'
import { useAiDrafts } from '../client/src/pages/chapter/hooks/useAiDrafts'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { solutions: [] } }) }))
vi.mock('../client/src/api', () => ({ novelApi: {
  fix: vi.fn(), chapterDetail: vi.fn(), createVersion: vi.fn(), generateCandidates: vi.fn(),
  chapterVersionRestore: vi.fn(), aiAction: vi.fn()
}, studioApi: { solutions: vi.fn(), solutionProduceChapter: vi.fn().mockResolvedValue({ jobId: 1 }) }, waitForJob: vi.fn() }))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { resolve, promise }
}
function setup() {
  let text = '人工原文'
  return {
    novelId: 1, selectedChapter: 10 as number | null, content: text,
    readContent: () => text, setText: (value: string) => { text = value },
    setContent: vi.fn(), saveContent: vi.fn().mockResolvedValue(undefined),
    savedContentRef: { current: text }, dirtyRef: { current: false }, fixDoneRef: { current: false },
    invalidate: vi.fn().mockResolvedValue(undefined), notify: vi.fn(), onActionError: vi.fn(),
    feedback: { actionBusy: null, actionMsg: null, actionError: null, setActionError: vi.fn(), notify: vi.fn(), withBusy: vi.fn() }
  }
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(novelApi.createVersion).mockResolvedValue({ versionId: 9 } as never) })
afterEach(cleanup)

it('修复未提交时只提示候选，不覆盖本地人工稿', async () => {
  const options = setup()
  vi.mocked(novelApi.fix).mockResolvedValue({ fixed: false, persisted: false, content: 'AI', round: 1, candidateVersionId: 9 })
  const { result } = renderHook(() => useChapterActions(options))
  await act(async () => { await result.current.fix() })
  expect(options.setContent).not.toHaveBeenCalled()
  expect(options.savedContentRef.current).toBe('人工原文')
  expect(novelApi.chapterDetail).not.toHaveBeenCalled()
})

it('修复 A→B→A 迟到结果不能写入新会话', async () => {
  const options = setup()
  const response = deferred<Awaited<ReturnType<typeof novelApi.fix>>>()
  vi.mocked(novelApi.fix).mockReturnValue(response.promise)
  vi.mocked(novelApi.chapterDetail).mockResolvedValue({ chapter: { content: 'AI' } } as never)
  const { result, rerender } = renderHook(props => useChapterActions(props), { initialProps: options })
  let pending!: Promise<void>
  await act(async () => { pending = result.current.fix() })
  rerender({ ...options, selectedChapter: 11 })
  rerender(options)
  await act(async () => { response.resolve({ fixed: true, content: 'AI', round: 1 }); await pending })
  expect(options.setContent).not.toHaveBeenCalled()
  expect(options.savedContentRef.current).toBe('人工原文')
  expect(novelApi.createVersion).toHaveBeenCalledWith(1, 10, expect.any(String), 'AI')
})

it('方案只存候选时不读取正文冒充生产结果', async () => {
  const options = setup()
  vi.mocked(waitForJob).mockResolvedValue({ status: 'completed', result: { persisted: false } } as never)
  const { result } = renderHook(() => useChapterActions(options))
  act(() => { result.current.setSolutionId(2) })
  await act(async () => { await result.current.produceWithSolution() })
  expect(options.setContent).not.toHaveBeenCalled()
  expect(novelApi.chapterDetail).not.toHaveBeenCalled()
})

it('候选采用先保存，迟到确认保留新输入且原文条件随请求发送', async () => {
  const options = setup()
  vi.mocked(novelApi.generateCandidates).mockResolvedValue({ candidates: [{ versionId: 9 }] } as never)
  const response = deferred<Awaited<ReturnType<typeof novelApi.chapterVersionRestore>>>()
  vi.mocked(novelApi.chapterVersionRestore).mockReturnValue(response.promise)
  const { result } = renderHook(() => useChapterCandidates(options))
  await act(async () => { await result.current.generateCandidates(1) })
  let pending!: Promise<void>
  await act(async () => { pending = result.current.adoptCandidate({ versionId: 9 }) })
  options.setText('采用期间继续写')
  await act(async () => { response.resolve({ content: '候选', currentContent: '候选', wordCount: 2 }); await pending })
  expect(options.saveContent).toHaveBeenCalledOnce()
  expect(novelApi.chapterVersionRestore).toHaveBeenCalledWith(1, 10, 9, { expectedContent: '人工原文', operationId: expect.any(String) })
  expect(options.setContent).not.toHaveBeenCalled()
  expect(options.dirtyRef.current).toBe(true)
})

it('AI 草稿不能在同编号异书或往返后的新章节会话采用', async () => {
  const options = setup()
  const view = { state: { doc: { toString: options.readContent }, selection: { main: { head: 0, from: 0, to: 4 } } } }
  const draftOptions = { ...options, editorRef: { current: { view } as unknown as ReactCodeMirrorRef },
    applySelection: vi.fn(), insertAt: vi.fn(), onError: vi.fn() }
  vi.mocked(novelApi.aiAction).mockResolvedValue({ content: 'AI' } as never)
  const { result, rerender } = renderHook(props => useAiDrafts(props), { initialProps: draftOptions })
  await act(async () => { await result.current.request('polish') })
  const draft = result.current.drafts[0]
  expect(result.current.canAdopt(draft)).toBe(true)
  rerender({ ...draftOptions, novelId: 2 })
  expect(result.current.canAdopt(draft)).toBe(false)
  rerender(draftOptions)
  expect(result.current.canAdopt(draft)).toBe(false)
  await act(async () => { await result.current.adopt(draft) })
  expect(draftOptions.applySelection).not.toHaveBeenCalled()
})
