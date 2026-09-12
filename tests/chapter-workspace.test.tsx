// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { novelApi } from '../client/src/api'
import { useChapterSave } from '../client/src/pages/chapter/hooks/useChapterSave'
import { useChapterIdentity } from '../client/src/pages/chapter/hooks/useChapterIdentity'
import { useChapterNavigation } from '../client/src/pages/chapter/hooks/useChapterNavigation'
import { useAiDrafts } from '../client/src/pages/chapter/hooks/useAiDrafts'
import { WorkspaceTabs, type WorkspaceTab } from '../client/src/pages/chapter/WorkspaceTabs'

vi.mock('../client/src/api', () => ({ novelApi: { chapterPatch: vi.fn(), chapterDetail: vi.fn(), aiAction: vi.fn(), createVersion: vi.fn() } }))
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (err: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(novelApi.createVersion).mockResolvedValue({ versionId: 9 }) })
afterEach(cleanup)
function setup() {
  let text = '第一版'
  const view = { state: { doc: { toString: () => text }, selection: { main: { from: 0, to: 3, head: 3 } } }, dispatch: vi.fn() }
  const deps = {
    novelId: 1, selectedChapter: 10, editorRef: { current: { view } as unknown as ReactCodeMirrorRef },
    content: text, setContent: vi.fn(), contentLoadingRef: { current: false }, loadedChapterRef: { current: 10 },
    streamingRef: { current: false }, savedContentRef: { current: '原稿' }, dirtyRef: { current: true },
    aiDeltaRef: { current: 2 }, humanDeltaRef: { current: 3 }, invalidate: vi.fn().mockResolvedValue(undefined),
    toast: vi.fn(), notify: vi.fn(), onActionError: vi.fn()
  }
  return { deps, view, setText: (v: string) => { text = v } }
}
describe('章节保存', () => {
  it('保存等待在途新增输入完成，三次重入串行发送且增量只扣一次', async () => {
    const { deps, setText } = setup()
    const first = deferred<Awaited<ReturnType<typeof novelApi.chapterPatch>>>()
    vi.mocked(novelApi.chapterPatch).mockImplementationOnce(() => first.promise).mockResolvedValue({ ok: true } as never)
    const { result } = renderHook(() => useChapterSave(deps))
    let p!: Promise<void>
    await act(async () => { p = result.current.saveContent() })
    setText('第二版新增')
    deps.humanDeltaRef.current += 4
    await act(async () => { first.resolve({ ok: true } as never); await p })
    expect(deps.dirtyRef.current).toBe(false)
    expect(deps.humanDeltaRef.current).toBe(0)
    await act(async () => { await Promise.all([result.current.saveContent(), result.current.saveContent(), result.current.saveContent()]) })
    expect(novelApi.chapterPatch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(novelApi.chapterPatch).mock.calls[1][2]).toMatchObject({ content: '第二版新增', humanWordsDelta: 4 })
    expect(deps.dirtyRef.current).toBe(false)
  })
  it('失败保留正文与增量，重试成功后才扣除', async () => {
    const { deps } = setup()
    vi.mocked(novelApi.chapterPatch).mockRejectedValueOnce(Error('离线')).mockResolvedValue({ ok: true } as never)
    const { result } = renderHook(() => useChapterSave(deps))
    await act(async () => { await expect(result.current.saveContent()).rejects.toThrow('离线') })
    expect(result.current.saveError).toBe('离线')
    expect(deps.humanDeltaRef.current).toBe(3)
    await act(async () => { await result.current.saveContent() })
    expect(deps.humanDeltaRef.current).toBe(0)
    expect(result.current.saveError).toBeNull()
  })
  it('空正文不能解除脏标记或允许切章', async () => {
    const { deps, setText } = setup()
    setText('')
    const { result } = renderHook(() => useChapterSave(deps))
    await act(async () => { await expect(result.current.saveContent()).rejects.toThrow('正文为空') })
    expect(deps.dirtyRef.current).toBe(true)
    expect(novelApi.chapterPatch).not.toHaveBeenCalled()
  })
  it('响应丢失后重试同一请求，随后单独发送新增编辑及增量', async () => {
    const { deps, setText } = setup()
    vi.mocked(novelApi.chapterPatch).mockRejectedValueOnce(Error('响应丢失')).mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useChapterSave(deps))
    await act(async () => { await expect(result.current.saveContent()).rejects.toThrow('响应丢失') })
    const original = vi.mocked(novelApi.chapterPatch).mock.calls[0][2]
    setText('新编辑')
    deps.humanDeltaRef.current += 2
    await act(async () => { await result.current.saveContent() })
    const calls = vi.mocked(novelApi.chapterPatch).mock.calls
    expect(calls[1][2]).toEqual(original)
    expect(calls[2][2]).toMatchObject({ expectedContent: '第一版', content: '新编辑', humanWordsDelta: 2 })
    expect(calls[2][2].operationId).not.toBe(original.operationId)
    expect(deps.humanDeltaRef.current).toBe(0)
  })
  it.each([400, 413, 422])('明确 HTTP %i 拒绝后允许修正正文再保存，不重复旧请求', async status => {
    const { deps, setText } = setup()
    vi.mocked(novelApi.chapterPatch).mockRejectedValueOnce(Object.assign(Error('正文被拒绝'), { status }))
      .mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useChapterSave(deps))
    await act(async () => { await expect(result.current.saveContent()).rejects.toThrow('正文被拒绝') })
    expect(deps.humanDeltaRef.current).toBe(3)
    const original = vi.mocked(novelApi.chapterPatch).mock.calls[0][2]
    setText('修正后的正文')
    deps.humanDeltaRef.current += 2
    await act(async () => { await result.current.saveContent() })
    const calls = vi.mocked(novelApi.chapterPatch).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1][2]).toMatchObject({ content: '修正后的正文', expectedContent: '原稿', humanWordsDelta: 5 })
    expect(calls[1][2].operationId).not.toBe(original.operationId)
    expect(deps.humanDeltaRef.current).toBe(0)
  })
  it('旧会话保存响应不能确认重新打开的同一章节', async () => {
    const { deps } = setup()
    const reply = deferred<Awaited<ReturnType<typeof novelApi.chapterPatch>>>()
    vi.mocked(novelApi.chapterPatch).mockReturnValue(reply.promise)
    const { result, rerender } = renderHook(props => useChapterSave(props), { initialProps: deps })
    let request!: Promise<void>
    await act(async () => { request = result.current.saveContent() })
    rerender({ ...deps, selectedChapter: 11 })
    rerender({ ...deps, selectedChapter: 10 })
    deps.savedContentRef.current = '重新加载正文'
    deps.humanDeltaRef.current = 9
    await act(async () => { reply.resolve({ ok: true }); await expect(request).rejects.toThrow('原章节') })
    expect(deps.savedContentRef.current).toBe('重新加载正文')
    expect(deps.humanDeltaRef.current).toBe(9)
  })
  it('回放显示服务器后来改稿时扣已确认增量但保留本地草稿', async () => {
    const { deps } = setup()
    vi.mocked(novelApi.chapterPatch).mockResolvedValue({ ok: true, replayed: true, currentContent: '服务器后续版本' })
    const { result } = renderHook(() => useChapterSave(deps))
    await act(async () => { await expect(result.current.saveContent()).rejects.toThrow('随后发生变化') })
    expect(deps.humanDeltaRef.current).toBe(0)
    expect(deps.savedContentRef.current).toBe('服务器后续版本')
    expect(deps.dirtyRef.current).toBe(true)
    await act(async () => { await expect(result.current.saveContent()).rejects.toThrow('随后发生变化') })
    expect(novelApi.chapterPatch).toHaveBeenCalledTimes(1)
  })
  it('冲突处理先保留人工草稿版本，再载入最新正文解除冲突', async () => {
    const { deps } = setup()
    vi.mocked(novelApi.chapterPatch).mockRejectedValue(Object.assign(Error('并发冲突'), { code: 'CHAPTER_CONTENT_CONFLICT' }))
    vi.mocked(novelApi.chapterDetail).mockResolvedValue({ chapter: { content: '最新正文' } } as never)
    const { result } = renderHook(() => useChapterSave(deps))
    await act(async () => { await expect(result.current.saveContent()).rejects.toThrow('并发冲突') })
    expect(result.current.hasConflict).toBe(true)
    await act(async () => { await result.current.resolveConflict() })
    expect(novelApi.createVersion).toHaveBeenCalledWith(1, 10, '人工草稿：并发冲突保留', '第一版')
    expect(deps.setContent).toHaveBeenCalledWith('最新正文')
    expect(result.current.hasConflict).toBe(false)
    expect(deps.dirtyRef.current).toBe(false)
  })
  it('冲突处理期间新增编辑时仅保留先前草稿，不替换新的输入', async () => {
    const { deps, setText } = setup()
    vi.mocked(novelApi.chapterPatch).mockRejectedValue(Object.assign(Error('并发冲突'), { code: 'CHAPTER_CONTENT_CONFLICT' }))
    const reply = deferred<Awaited<ReturnType<typeof novelApi.chapterDetail>>>()
    vi.mocked(novelApi.chapterDetail).mockReturnValue(reply.promise)
    const { result } = renderHook(() => useChapterSave(deps))
    await act(async () => { await expect(result.current.saveContent()).rejects.toThrow('并发冲突') })
    let resolving!: Promise<void>
    await act(async () => { resolving = result.current.resolveConflict() })
    setText('处理冲突期间新写的正文')
    await act(async () => { reply.resolve({ chapter: { content: '最新正文' } } as never); await resolving })
    expect(deps.setContent).not.toHaveBeenCalled()
    expect(deps.dirtyRef.current).toBe(true)
    expect(result.current.hasConflict).toBe(true)
  })
})

describe('章节生命周期和导航', () => {
  it('加载失败且无本地草稿时允许离开或重试同章，不发送空正文保存', async () => {
    const saveContent = vi.fn().mockRejectedValue(Error('正文尚未加载完成'))
    const onSelect = vi.fn()
    const onReload = vi.fn()
    const { result } = renderHook(() => useChapterNavigation({ novelId: 1, selectedChapter: 10,
      streamingRef: { current: false }, saveContent, onSelect, onReload, canLeaveWithoutSave: () => true,
      onError: vi.fn(), onStreaming: vi.fn() }))
    await act(async () => { await result.current.selectChapter(10) })
    expect(onReload).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.selectChapter(11) })
    expect(onSelect).toHaveBeenCalledWith(11)
    expect(saveContent).not.toHaveBeenCalled()
  })
  it('加载未完成但存在本地草稿时不能跳过保存离开', async () => {
    const saveContent = vi.fn().mockRejectedValue(Error('正文尚未加载完成'))
    const onSelect = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useChapterNavigation({ novelId: 1, selectedChapter: 10,
      streamingRef: { current: false }, saveContent, onSelect, canLeaveWithoutSave: () => false,
      onError, onStreaming: vi.fn() }))
    await act(async () => { await result.current.selectChapter(11) })
    expect(saveContent).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('保存失败，已中断切换，请重试')
  })
  it('A→B→A 及卸载均使旧身份失效', () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useChapterIdentity(1, id), { initialProps: { id: 10 } })
    const origin = result.current.capture()
    rerender({ id: 11 }); rerender({ id: 10 })
    expect(result.current.isActive(origin)).toBe(false)
    const latest = result.current.capture()
    expect(result.current.isActive(latest)).toBe(true)
    unmount()
    expect(result.current.isActive(latest)).toBe(false)
  })
  it('保存期间连续选章仅采用最后目标', async () => {
    const flush = deferred<void>()
    const onSelect = vi.fn()
    const { result } = renderHook(() => useChapterNavigation({ novelId: 1, selectedChapter: 10,
      streamingRef: { current: false }, saveContent: () => flush.promise, onSelect, onError: vi.fn(), onStreaming: vi.fn() }))
    const a = result.current.selectChapter(11)
    const b = result.current.selectChapter(12)
    await act(async () => { flush.resolve(); await Promise.all([a, b]) })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(12)
  })
})
describe('AI 结果归属与预览', () => {
  function makeOptions() {
    const editor = setup()
    return { ...editor, options: { novelId: 1, selectedChapter: 10, chapterTitle: '原章节', editorRef: editor.deps.editorRef,
      saveContent: vi.fn().mockResolvedValue(undefined), applySelection: vi.fn(), insertAt: vi.fn(), onError: vi.fn(), notify: vi.fn() } }
  }
  it('迟到响应在切章后保存为原章版本，不自动写入当前章节', async () => {
    const { options, setText } = makeOptions()
    const response = deferred<Awaited<ReturnType<typeof novelApi.aiAction>>>()
    vi.mocked(novelApi.aiAction).mockReturnValue(response.promise)
    const { result, rerender } = renderHook(props => useAiDrafts(props), { initialProps: options })
    let request!: Promise<void>
    await act(async () => { request = result.current.request('polish') })
    setText('另一章正文')
    rerender({ ...options, selectedChapter: 11 })
    await act(async () => { response.resolve({ action: 'polish', isInsert: false, content: 'AI 新文' }); await request })
    expect(novelApi.createVersion).toHaveBeenCalledWith(1, 10, 'AI 待采用：polish', 'AI 新文')
    expect(options.applySelection).not.toHaveBeenCalled()
    expect(result.current.drafts[0].chapterId).toBe(10)
    await act(async () => { await result.current.adopt(result.current.drafts[0]) })
    expect(options.applySelection).not.toHaveBeenCalled()
  })
  it('正文变化后禁止覆盖；原文未变化时按请求选区采用', async () => {
    const { options, setText, view } = makeOptions()
    vi.mocked(novelApi.aiAction).mockResolvedValue({ action: 'polish', isInsert: false, content: 'AI 新文' })
    const { result } = renderHook(() => useAiDrafts(options))
    await act(async () => { await result.current.request('polish') })
    const draft = result.current.drafts[0]
    setText('手动改稿')
    await act(async () => { await result.current.adopt(draft) })
    expect(options.applySelection).not.toHaveBeenCalled()
    setText('第一版')
    view.state.selection.main = { from: 2, to: 2, head: 2 }
    await act(async () => { await result.current.adopt(draft) })
    expect(view.dispatch).toHaveBeenCalledWith({ selection: { anchor: 0, head: 3 } })
    expect(options.applySelection).toHaveBeenCalledWith('AI 新文')
  })
  it('同 tick 双击只调用一次，版本保存失败仍保留结果并报错', async () => {
    const { options } = makeOptions()
    vi.mocked(novelApi.aiAction).mockResolvedValue({ action: 'polish', isInsert: false, content: 'AI 新文' })
    vi.mocked(novelApi.createVersion).mockRejectedValue(Error('磁盘写入失败'))
    const { result } = renderHook(() => useAiDrafts(options))
    await act(async () => { await Promise.all([result.current.request('polish'), result.current.request('polish')]) })
    expect(novelApi.aiAction).toHaveBeenCalledTimes(1)
    expect(result.current.drafts).toHaveLength(1)
    expect(options.onError).toHaveBeenLastCalledWith(expect.stringContaining('尚未存入版本'))
  })
})
it('页签支持方向键、Home/End，焦点与面板标签保持关联', () => {
  function Tabs() { const [value, setValue] = useState<WorkspaceTab>('write'); return <WorkspaceTabs value={value} onChange={setValue}>{value}</WorkspaceTabs> }
  render(<Tabs />)
  fireEvent.keyDown(screen.getByRole('tab', { name: '写作' }), { key: 'ArrowRight' })
  const check = screen.getByRole('tab', { name: '检查' })
  expect(document.activeElement).toBe(check)
  expect(check.getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(check.id)
  fireEvent.keyDown(check, { key: 'End' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '版本' }))
  fireEvent.keyDown(document.activeElement!, { key: 'Home' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '写作' }))
})
