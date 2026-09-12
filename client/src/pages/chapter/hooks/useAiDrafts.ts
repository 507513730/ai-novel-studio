import { useRef, useState } from 'react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { novelApi } from '../../../api'
import { useChapterIdentity } from './useChapterIdentity'

export interface AiDraft {
  id: number
  chapterId: number
  novelId: number
  epoch: number
  title: string
  original: string
  from: number
  to: number
  text: string
  versionId?: number
}

export function useAiDrafts(options: {
  novelId: number
  selectedChapter: number | null
  chapterTitle?: string
  editorRef: React.RefObject<ReactCodeMirrorRef | null>
  saveContent: () => Promise<void>
  applySelection: (text: string) => void
  insertAt: (text: string, pos: number) => void
  onError: (message: string | null) => void
  notify: (message: string) => void
}) {
  const [drafts, setDrafts] = useState<AiDraft[]>([])
  const [running, setRunning] = useState<{ chapterId: number; title: string } | null>(null)
  const lock = useRef(false)
  const sequence = useRef(0)
  const latest = useRef(options)
  latest.current = options
  const identity = useChapterIdentity(options.novelId, options.selectedChapter)
  const request = async (action: string, instruction?: string): Promise<void> => {
    if (lock.current) return
    const view = options.editorRef.current?.view
    const chapterId = options.selectedChapter
    if (!view || !chapterId) return
    const token = identity.capture()
    const original = view.state.doc.toString()
    const selection = view.state.selection.main
    const from = action === 'continue' ? selection.head : selection.from
    const to = action === 'continue' ? from : selection.to
    const title = options.chapterTitle ?? `章节 #${chapterId}`
    lock.current = true
    setRunning({ chapterId, title })
    options.onError(null)
    try {
      await options.saveContent()
      if (!identity.isActive(token) || latest.current.editorRef.current?.view?.state.doc.toString() !== original) throw Error('正文已变化，请重新发起 AI 操作')
      const r = await novelApi.aiAction(options.novelId, chapterId, {
        action, instruction, ...(to > from ? { selection: original.slice(from, to) } : { cursorPosition: from })
      })
      const draft: AiDraft = { id: ++sequence.current, novelId: options.novelId, epoch: token.epoch, chapterId, title, original, from, to, text: r.content }
      setDrafts(items => [...items, draft])
      try {
        const full = original.slice(0, from) + r.content + original.slice(to)
        const { versionId } = await novelApi.createVersion(options.novelId, chapterId, 'AI 待采用：' + action, full)
        setDrafts(items => items.map(item => item.id === draft.id ? { ...item, versionId } : item))
        options.notify(`${title}：AI 结果已保存到版本，请预览后采用`)
      } catch {
        options.onError(`${title}：AI 结果尚未存入版本，请保留当前页面并复制结果`)
      }
    } catch (err) {
      options.onError(`${title}：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      lock.current = false
      setRunning(null)
    }
  }
  const canAdopt = (draft: AiDraft): boolean => {
    const current = latest.current
    return identity.isActive(draft) && current.editorRef.current?.view?.state.doc.toString() === draft.original
  }
  const adopt = async (draft: AiDraft): Promise<void> => {
    if (lock.current) return
    if (!canAdopt(draft)) { options.onError('正文已变化，已保留 AI 结果；请对照后手动合并'); return }
    lock.current = true
    try {
      const current = latest.current
      const view = current.editorRef.current!.view!
      if (draft.to > draft.from) {
        view.dispatch({ selection: { anchor: draft.from, head: draft.to } })
        current.applySelection(draft.text)
      } else current.insertAt(draft.text, draft.from)
      await current.saveContent()
      setDrafts(items => items.filter(item => item.id !== draft.id))
      if (identity.isActive(draft)) current.notify('已采用 AI 结果')
    } catch (err) { options.onError(`结果已插入编辑器，请重试保存：${String(err)}`) }
    finally { lock.current = false }
  }
  return { drafts, running, request, adopt, canAdopt, dismiss: (id: number) => setDrafts(items => items.filter(item => item.id !== id)) }
}
