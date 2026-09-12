import { useEffect, useRef, useState } from 'react'
import { novelApi } from '../../../api'
import { useChapterIdentity } from './useChapterIdentity'

// v1.0 后续（A1 多候选分支生成）：候选生成与"选定为正文"的动作编排（AGENTS #38 先抽 hook）。
// 契约：`generate` 串行生成 N 份候选并打开对比面板；`adopt` 复用版本恢复流程把选定候选落为正文
// （restore 已处理"当前内容先存版本 + 覆盖计数"），其余候选留在版本历史。
export function useChapterCandidates(options: {
  novelId: number
  selectedChapter: number | null
  setContent: (v: string) => void
  savedContentRef: React.MutableRefObject<string>
  dirtyRef: React.MutableRefObject<boolean>
  invalidate: () => Promise<void>
  notify: (msg: string) => void
  onActionError: (msg: string | null) => void
  saveContent: () => Promise<void>
  readContent: () => string
}): {
  candidates: Array<{ index: number; note: string; content: string; wordCount: number; versionId: number }> | null
  candidatesBusy: boolean
  openCandidatesPanel: boolean
  generateCandidates: (count: number, include?: string[]) => Promise<void>
  adoptCandidate: (candidate: { versionId: number }) => Promise<void>
  closeCandidates: () => void
} {
  const { novelId, selectedChapter, setContent, savedContentRef, dirtyRef, invalidate, notify, onActionError } = options
  const id = novelId
  const identity = useChapterIdentity(novelId, selectedChapter)
  const busy = useRef(false)
  const latest = useRef(options)
  latest.current = options

  const [candidates, setCandidates] = useState<Array<{ index: number; note: string; content: string; wordCount: number; versionId: number }> | null>(null)
  const [candidatesBusy, setCandidatesBusy] = useState(false)
  const [openCandidatesPanel, setOpenCandidatesPanel] = useState(false)
  useEffect(() => { setCandidates(null); setOpenCandidatesPanel(false) }, [novelId, selectedChapter])

  const generateCandidates = async (count: number, include?: string[]): Promise<void> => {
    if (!selectedChapter) return
    if (busy.current) return
    const token = identity.capture()
    busy.current = true
    setCandidatesBusy(true)
    onActionError(null)
    notify(`正在串行生成 ${count} 份候选（稍候）…`)
    try {
      const r = await novelApi.generateCandidates(id, selectedChapter, count, include)
      if (!identity.isActive(token)) return
      setCandidates(r.candidates)
      setOpenCandidatesPanel(true)
      notify(`已生成 ${r.candidates.length} 份候选，可在面板对比选择`)
    } catch (err) {
      if (identity.isActive(token)) onActionError(err instanceof Error ? err.message : String(err))
    } finally {
      busy.current = false
      setCandidatesBusy(false)
    }
  }

  const adoptCandidate = async (candidate: { versionId: number }): Promise<void> => {
    if (!selectedChapter || busy.current) return
    if (!candidates?.some(item => item.versionId === candidate.versionId)) return
    const token = identity.capture()
    busy.current = true
    setCandidatesBusy(true)
    try {
      await options.saveContent()
      if (!identity.isActive(token)) return
      const original = latest.current.readContent()
      if (dirtyRef.current || savedContentRef.current !== original) throw Error('正文仍有未保存修改，请保存后再采用')
      const r = await novelApi.chapterVersionRestore(id, selectedChapter, candidate.versionId, { expectedContent: original, operationId: crypto.randomUUID() })
      if (!identity.isActive(token)) return
      const currentContent = r.currentContent ?? r.content
      if (latest.current.readContent() !== original || currentContent !== r.content) {
        if (savedContentRef.current === original) savedContentRef.current = currentContent
        dirtyRef.current = true
        notify('已保留采用期间的新输入，候选仍在版本历史中')
        await invalidate()
        return
      }
      setContent(currentContent)
      savedContentRef.current = currentContent
      dirtyRef.current = false
      setOpenCandidatesPanel(false)
      notify(`已采用候选 #${candidate.versionId}（${r.wordCount} 字），其余候选保留在版本历史`)
      await invalidate()
    } catch (err) {
      if (identity.isActive(token)) onActionError(err instanceof Error ? err.message : String(err))
    } finally {
      busy.current = false
      setCandidatesBusy(false)
    }
  }

  const closeCandidates = (): void => {
    setOpenCandidatesPanel(false)
  }

  return { candidates, candidatesBusy, openCandidatesPanel, generateCandidates, adoptCandidate, closeCandidates }
}
