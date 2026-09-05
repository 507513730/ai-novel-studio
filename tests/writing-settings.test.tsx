// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../client/src/api'
import { WritingPanel } from '../client/src/pages/settings/WritingPanel'
import { useWritingSettings } from '../client/src/pages/settings/useWritingSettings'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('../client/src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../client/src/components/toastGlobal', () => ({ useToast: () => ({ toast }) }))

const initial = { lang: 'simplified', format: 'paragraph', writingMode: 'standard', quickWords: {} }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(apiFetch).mockImplementation(async path => path === '/settings/writing' ? initial : { enabled: false })
})
afterEach(cleanup)
const patches = () => vi.mocked(apiFetch).mock.calls.filter(([, options]) => options?.method === 'PATCH')

describe('writing settings save ownership', () => {
  it('saves quick words once, locks all writing controls and updates the parent dictionary', async () => {
    const pending = deferred<unknown>()
    render(<WritingPanel />)
    const key = await screen.findByPlaceholderText('触发词（;开头）') as HTMLInputElement
    const value = screen.getByPlaceholderText('展开文本（≤500 字）') as HTMLInputElement
    vi.mocked(apiFetch).mockImplementationOnce(() => pending.promise)
    fireEvent.change(key, { target: { value: ';hero' } })
    fireEvent.change(value, { target: { value: '主角' } })
    fireEvent.click(screen.getByRole('button', { name: '+ 添加' }))
    fireEvent.keyDown(value, { key: 'Enter' })
    expect(patches()).toHaveLength(1)
    expect(key.disabled).toBe(true)
    expect((screen.getByRole('button', { name: /繁体中文/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(key.value).toBe(';hero')
    await act(async () => pending.resolve({}))
    expect(screen.getByText(';hero')).toBeTruthy()
    expect(key.value).toBe('')
    expect(patches()).toHaveLength(1)
    fireEvent.click(screen.getByTitle('删除'))
    await waitFor(() => expect(screen.queryByText(';hero')).toBeNull())
    expect(patches()).toHaveLength(2)
    expect(JSON.parse(patches()[1][1]!.body as string)).toEqual({ quickWords: {} })
  })

  it('preserves failed drafts and permits retry without a false success message', async () => {
    render(<WritingPanel />)
    const key = await screen.findByPlaceholderText('触发词（;开头）') as HTMLInputElement
    const value = screen.getByPlaceholderText('展开文本（≤500 字）') as HTMLInputElement
    fireEvent.change(key, { target: { value: ';hero' } })
    fireEvent.change(value, { target: { value: '主角' } })
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: '+ 添加' }))
    await waitFor(() => expect(key.disabled).toBe(false))
    expect(key.value).toBe(';hero')
    expect(value.value).toBe('主角')
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('error', '保存失败')
    fireEvent.click(screen.getByRole('button', { name: '+ 添加' }))
    await screen.findByText(';hero')
    expect(patches()).toHaveLength(2)
  })

  it('rejects same-tick saves and ignores completion after unmount', async () => {
    const { result, unmount } = renderHook(useWritingSettings)
    await waitFor(() => expect(result.current.settings).not.toBeNull())
    const pending = deferred<unknown>()
    vi.mocked(apiFetch).mockImplementationOnce(() => pending.promise)
    let first!: Promise<boolean>
    await act(async () => {
      first = result.current.patch({ lang: 'traditional' })
      expect(await result.current.patch({ format: 'longSentence' })).toBe(false)
    })
    expect(patches()).toHaveLength(1)
    unmount()
    await act(async () => pending.resolve({}))
    expect(await first).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })

  it('discards the old StrictMode load response', async () => {
    const old = deferred<unknown>()
    const current = deferred<unknown>()
    vi.mocked(apiFetch).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
    const { result } = renderHook(useWritingSettings, { wrapper: StrictMode })
    await act(async () => current.resolve({ ...initial, lang: 'traditional' }))
    await act(async () => old.resolve(initial))
    expect(result.current.settings?.lang).toBe('traditional')
    expect(toast).not.toHaveBeenCalled()
  })

  it('retries a failed load once even when requested twice in the same tick', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(useWritingSettings)
    await waitFor(() => expect(result.current.loadError).toBe(true))
    act(() => { result.current.retry(); result.current.retry() })
    await waitFor(() => expect(result.current.settings).toEqual(initial))
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(result.current.loadError).toBe(false)
  })
})
