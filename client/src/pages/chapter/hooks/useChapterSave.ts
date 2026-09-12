import { useRef, useState } from 'react'
import { novelApi } from '../../../api'
import type { EditorSessionDeps } from './useEditorSession'
import { useChapterIdentity, type ChapterIdentity } from './useChapterIdentity'

interface SaveRequest {
  owner: ChapterIdentity
  text: string
  ai: number
  human: number
  body: Record<string, unknown>
}

export function useChapterSave(deps: EditorSessionDeps & {
  content: string
  setContent: (text: string) => void
  aiDeltaRef: React.RefObject<number>
  humanDeltaRef: React.RefObject<number>
  onSavedDeltas?: (ai: number, human: number) => void
}) {
  const [savingOwner, setSavingOwner] = useState<ChapterIdentity | null>(null)
  const [failure, setFailure] = useState<{ owner: ChapterIdentity; message: string } | null>(null)
  const [resolvingOwner, setResolvingOwner] = useState<ChapterIdentity | null>(null)
  const identity = useChapterIdentity(deps.novelId, deps.selectedChapter)
  const pending = useRef<Promise<void> | null>(null)
  const retry = useRef<SaveRequest | null>(null)
  const conflict = useRef<{ owner: ChapterIdentity; message: string } | null>(null)
  const resolving = useRef(false)
  const current = useRef(deps)
  current.current = deps
  const read = () => {
    const d = current.current
    return d.readContent?.() ?? d.editorRef.current?.view?.state.doc.toString() ?? d.content
  }

  const saveContent = async (opts?: { silent?: boolean; force?: boolean }): Promise<void> => {
    const owner = identity.capture()
    if (!owner.chapterId) return
    if (resolving.current) throw Error('正在保留草稿并同步正文，请稍候')
    while (pending.current) await pending.current
    if (!identity.isActive(owner)) throw Error('章节已切换，请在原章节重试保存')
    const write = async (): Promise<void> => {
      let force = opts?.force
      try {
        for (;;) {
          if (!identity.isActive(owner)) throw Error('章节已切换，请在原章节重试保存')
          const d = current.current
          if (d.contentLoadingRef.current || d.loadedChapterRef.current !== owner.chapterId) throw Error('正文尚未加载完成')
          if (d.streamingRef.current) throw Error('生成期间暂不能保存')
          if (conflict.current && identity.isActive(conflict.current.owner)) throw Error(conflict.current.message)
          if (retry.current && !identity.isActive(retry.current.owner)) retry.current = null
          let request = retry.current
          if (!request) {
            const text = read()
            if (!text.trim() && d.savedContentRef.current.trim() && !force) throw Error('正文为空，已保留原稿；请恢复正文后重试')
            if (text === d.savedContentRef.current && !force && !d.aiDeltaRef.current && !d.humanDeltaRef.current) {
              d.dirtyRef.current = false
              setFailure(null)
              return
            }
            const ai = d.aiDeltaRef.current
            const human = d.humanDeltaRef.current
            request = { owner, text, ai, human, body: {
              content: text, expectedContent: d.savedContentRef.current, operationId: crypto.randomUUID(),
              ...(text.trim() ? { status: 'written' } : {}),
              ...(ai > 0 ? { aiWordsDelta: ai } : {}), ...(human > 0 ? { humanWordsDelta: human } : {})
            } }
            retry.current = request
          }
          const response = await novelApi.chapterPatch(owner.novelId, owner.chapterId!, request.body)
          if (!identity.isActive(owner)) throw Error('章节已切换，保存结果仅归属原章节')
          retry.current = null
          d.aiDeltaRef.current = Math.max(0, d.aiDeltaRef.current - request.ai)
          d.humanDeltaRef.current = Math.max(0, d.humanDeltaRef.current - request.human)
          d.onSavedDeltas?.(request.ai, request.human)
          const serverText = response?.currentContent ?? request.text
          d.savedContentRef.current = serverText
          d.dirtyRef.current = read() !== serverText
          if (serverText !== request.text) {
            conflict.current = { owner, message: '原保存已确认，但服务器正文随后发生变化；已保留本地修改，请先对比版本' }
            throw Error(conflict.current.message)
          }
          // 回执确认后才刷新统计；刷新失败不重发已确认的字数增量。
          try { await d.invalidate() } catch {
            if (identity.isActive(owner)) d.onActionError('正文已保存，章节列表刷新失败')
          }
          if (!identity.isActive(owner)) throw Error('章节已切换，保存结果仅归属原章节')
          force = false
          if (read() === d.savedContentRef.current && !d.aiDeltaRef.current && !d.humanDeltaRef.current) {
            d.dirtyRef.current = false
            setFailure(null)
            if (!opts?.silent) d.notify('已保存')
            return
          }
        }
      } catch (err) {
        if (identity.isActive(owner)) {
          const d = current.current
          const message = err instanceof Error ? err.message : String(err)
          if (err && typeof err === 'object' && 'code' in err &&
            (err.code === 'CHAPTER_CONTENT_CONFLICT' || err.code === 'OPERATION_ID_REUSED')) {
            conflict.current = { owner, message }
          } else if (err && typeof err === 'object' && 'status' in err &&
            (err.status === 400 || err.status === 413 || err.status === 422)) {
            // 明确拒绝的请求未落库；用户修正输入后应创建新请求，网络不明失败仍重放原请求。
            retry.current = null
          }
          d.dirtyRef.current = true
          setFailure({ owner, message })
          d.toast('error', `保存失败：${message}`)
          d.onActionError(`保存失败：${message}`)
        }
        throw err
      }
    }
    setSavingOwner(owner)
    setFailure(null)
    const operation = Promise.resolve().then(write)
    pending.current = operation
    try { await operation } finally {
      if (pending.current === operation) pending.current = null
      if (identity.isActive(owner)) setSavingOwner(null)
    }
  }
  const resolveConflict = async (): Promise<void> => {
    if (resolving.current) return
    const owner = identity.capture()
    if (!owner.chapterId || !conflict.current || !identity.isActive(conflict.current.owner)) return
    resolving.current = true
    setResolvingOwner(owner)
    try {
      if (pending.current) { try { await pending.current } catch { /* 冲突原请求已由保存入口报告。 */ } }
      if (!identity.isActive(owner)) return
      const draft = read()
      await novelApi.createVersion(owner.novelId, owner.chapterId, '人工草稿：并发冲突保留', draft)
      const detail = await novelApi.chapterDetail(owner.novelId, owner.chapterId)
      if (!identity.isActive(owner)) return
      const d = current.current
      if (read() !== draft) {
        d.notify('原草稿已保留为版本；检测到新的输入，未替换当前正文，请再次处理冲突')
        return
      }
      const latest = detail.chapter.content ?? ''
      d.setContent(latest)
      d.savedContentRef.current = latest
      d.dirtyRef.current = false
      d.onSavedDeltas?.(d.aiDeltaRef.current, d.humanDeltaRef.current)
      d.aiDeltaRef.current = 0
      d.humanDeltaRef.current = 0
      retry.current = null
      conflict.current = null
      setFailure(null)
      d.notify('人工草稿已保留为版本，已载入最新正文')
      try { await d.invalidate() } catch {
        if (identity.isActive(owner)) d.onActionError('草稿已保留，章节列表刷新失败')
      }
    } catch (err) {
      if (identity.isActive(owner)) {
        const message = err instanceof Error ? err.message : String(err)
        setFailure({ owner, message })
        current.current.onActionError(`冲突处理失败：${message}`)
      }
      throw err
    } finally {
      resolving.current = false
      if (identity.isActive(owner)) setResolvingOwner(null)
    }
  }
  return { saving: !!savingOwner && identity.isActive(savingOwner), saveContent,
    saveError: failure && identity.isActive(failure.owner) ? failure.message : null,
    hasConflict: !!conflict.current && identity.isActive(conflict.current.owner), resolveConflict,
    resolvingConflict: !!resolvingOwner && identity.isActive(resolvingOwner) }
}
