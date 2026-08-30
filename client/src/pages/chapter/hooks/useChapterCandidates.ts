import { useState } from 'react'
import { novelApi } from '../../../api'

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

  const [candidates, setCandidates] = useState<Array<{ index: number; note: string; content: string; wordCount: number; versionId: number }> | null>(null)
  const [candidatesBusy, setCandidatesBusy] = useState(false)
  const [openCandidatesPanel, setOpenCandidatesPanel] = useState(false)

  const generateCandidates = async (count: number, include?: string[]): Promise<void> => {
    if (!selectedChapter) return
    if (candidatesBusy) return
    setCandidatesBusy(true)
    onActionError(null)
    notify(`正在串行生成 ${count} 份候选（稍候）…`)
    try {
      const r = await novelApi.generateCandidates(id, selectedChapter, count, include)
      setCandidates(r.candidates)
      setOpenCandidatesPanel(true)
      notify(`已生成 ${r.candidates.length} 份候选，可在面板对比选择`)
    } catch (err) {
      onActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setCandidatesBusy(false)
    }
  }

  const adoptCandidate = async (candidate: { versionId: number }): Promise<void> => {
    if (!selectedChapter) return
    setCandidatesBusy(true)
    try {
      const r = await novelApi.chapterVersionRestore(id, selectedChapter, candidate.versionId)
      setContent(r.content)
      savedContentRef.current = r.content
      dirtyRef.current = false
      setOpenCandidatesPanel(false)
      notify(`已采用候选 #${candidate.versionId}（${r.wordCount} 字），其余候选保留在版本历史`)
      await invalidate()
    } catch (err) {
      onActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setCandidatesBusy(false)
    }
  }

  const closeCandidates = (): void => {
    setOpenCandidatesPanel(false)
  }

  return { candidates, candidatesBusy, openCandidatesPanel, generateCandidates, adoptCandidate, closeCandidates }
}
