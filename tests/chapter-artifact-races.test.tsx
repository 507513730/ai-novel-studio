// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { novelApi } from '../client/src/api'
import { useChapterArtifacts } from '../client/src/pages/chapter/hooks/useChapterArtifacts'

vi.mock('../client/src/api', () => ({ novelApi: { versions: vi.fn(), chapterVersionRestore: vi.fn(), createVersion: vi.fn() } }))
beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { resolve, promise }
}
function fixture() {
  let text = '人工原稿'
  let confirm: (() => void) | undefined
  let operation: Promise<void> | undefined
  const options = {
    novelId: 1, selectedChapter: 10, notify: vi.fn(), onActionError: vi.fn(),
    withBusy: (_key: string, fn: () => Promise<void> | void) => { operation = Promise.resolve().then(fn); return operation },
    confirmFn: (input: { action: () => void }) => { confirm = input.action },
    invalidate: vi.fn().mockResolvedValue(undefined), setContent: vi.fn(),
    savedContentRef: { current: '人工原稿' }, dirtyRef: { current: false },
    readContent: () => text, saveContent: vi.fn().mockResolvedValue(undefined)
  }
  return { options, setText: (value: string) => { text = value }, confirm: () => confirm?.(), wait: () => operation }
}
const version = { id: 3, note: '候选', createdAt: '', preview: '', wordCount: 3 }
describe('章节版本异步归属', () => {
  it('离开后返回原章也不显示旧版本查询', async () => {
    const { options } = fixture()
    const pending = deferred<{ versions: typeof version[] }>()
    vi.mocked(novelApi.versions).mockReturnValue(pending.promise)
    const { result, rerender } = renderHook(useChapterArtifacts, { initialProps: options })
    let query!: Promise<void>
    await act(async () => { query = result.current.loadVersions() })
    rerender({ ...options, selectedChapter: 11 })
    rerender(options)
    await act(async () => { pending.resolve({ versions: [version] }); await query })
    expect(result.current.versions).toBeNull()
  })
  it('确认框期间切章不执行旧章恢复', async () => {
    const f = fixture()
    const { result, rerender } = renderHook(useChapterArtifacts, { initialProps: f.options })
    act(() => result.current.versionActions.restore(version))
    rerender({ ...f.options, selectedChapter: 11 })
    await act(async () => { f.confirm(); await f.wait() })
    expect(novelApi.chapterVersionRestore).not.toHaveBeenCalled()
  })
  it('恢复期间新增输入保留且保持未保存', async () => {
    const f = fixture()
    const pending = deferred<{ content: string; wordCount: number }>()
    vi.mocked(novelApi.chapterVersionRestore).mockReturnValue(pending.promise)
    const { result } = renderHook(useChapterArtifacts, { initialProps: f.options })
    await act(async () => { result.current.versionActions.restore(version); f.confirm() })
    f.setText('等待期间继续写')
    await act(async () => { pending.resolve({ content: '旧版本正文', wordCount: 5 }); await f.wait() })
    expect(f.options.saveContent).toHaveBeenCalledOnce()
    expect(novelApi.chapterVersionRestore).toHaveBeenCalledWith(1, 10, 3, expect.objectContaining({ expectedContent: '人工原稿', operationId: expect.any(String) }))
    expect(f.options.setContent).not.toHaveBeenCalled()
    expect(f.options.dirtyRef.current).toBe(true)
  })
  it('恢复响应不能写入另一章的编辑器或保存基线', async () => {
    const f = fixture()
    const pending = deferred<{ content: string; wordCount: number }>()
    vi.mocked(novelApi.chapterVersionRestore).mockReturnValue(pending.promise)
    const { result, rerender } = renderHook(useChapterArtifacts, { initialProps: f.options })
    await act(async () => { result.current.versionActions.restore(version); f.confirm() })
    rerender({ ...f.options, selectedChapter: 11 })
    f.options.savedContentRef.current = '另一章'
    await act(async () => { pending.resolve({ content: '旧版本正文', wordCount: 5 }); await f.wait() })
    expect(f.options.setContent).not.toHaveBeenCalled()
    expect(f.options.savedContentRef.current).toBe('另一章')
  })
})
