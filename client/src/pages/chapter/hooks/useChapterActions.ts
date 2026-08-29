import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { novelApi, studioApi, waitForJob } from '../../../api'
import type { ProofreadIssue } from '../types'
import type { ActionFeedback } from './useActionFeedback'

// v0.26.0（批次 B）：章节生产动作编排从页面拆出（AGENTS #38 先抽 hook）——
// 审核/校对/修复 + 方案流水线，busy/提示/错误原语来自 useActionFeedback，行为与拆分前逐字一致
export function useChapterActions(options: {
  novelId: number
  selectedChapter: number | null
  content: string
  feedback: ActionFeedback
  invalidate: () => Promise<void>
  setContent: (v: string) => void
  savedContentRef: React.RefObject<string>
  dirtyRef: React.RefObject<boolean>
  fixDoneRef: React.RefObject<boolean>
}): {
  actionBusy: string | null
  actionMsg: string | null
  actionError: string | null
  setActionError: (msg: string | null) => void
  notify: (msg: string) => void
  withBusy: (key: string, fn: () => Promise<void> | void) => Promise<void>
  runReview: () => Promise<void>
  reviewResult: Record<string, unknown> | null
  setReviewResult: (r: Record<string, unknown> | null) => void
  runProofread: () => Promise<void>
  proofreadIssues: ProofreadIssue[] | null
  setProofreadIssues: (v: ProofreadIssue[] | null) => void
  fix: () => Promise<void>
  solutionId: number | null
  setSolutionId: (v: number | null) => void
  solutionRunSummary: string | null
  runSolutionOnChapter: () => Promise<void>
  produceWithSolution: () => Promise<void>
  solutions: Array<Record<string, unknown>>
} {
  const { novelId, selectedChapter, content, feedback, invalidate, setContent, savedContentRef, dirtyRef, fixDoneRef } = options
  const id = novelId
  const { actionBusy, actionMsg, actionError, setActionError, notify, withBusy } = feedback
  const [reviewResult, setReviewResult] = useState<Record<string, unknown> | null>(null)
  const [proofreadIssues, setProofreadIssues] = useState<ProofreadIssue[] | null>(null)
  const [solutionId, setSolutionId] = useState<number | null>(null)
  const [solutionRunSummary, setSolutionRunSummary] = useState<string | null>(null)

  const runReview = async (): Promise<void> => {
    if (!selectedChapter) return
    setActionError(null)
    notify('审核中…')
    try {
      const r = await novelApi.review(id, selectedChapter)
      setReviewResult(r.review)
      const score = r.review.score as number
      notify(`审核完成：${score} 分${(r.review.needsFix as boolean) ? '，需要修复' : ''}`)
      await invalidate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  // v0.24.4（A4）：轻量本地校对（确定性检查 + 单次语义 extraction，可选传当前编辑器内容）
  const runProofread = async (): Promise<void> => {
    if (!selectedChapter) return
    setActionError(null)
    setProofreadIssues(null)
    try {
      const r = await novelApi.proofread(id, selectedChapter, content || undefined)
      setProofreadIssues(r.issues)
      notify(`校对完成：${r.issues.length} 条${r.localCount > 0 ? `（${r.localCount} 条本地确定性问题）` : ''}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const fix = async (): Promise<void> => {
    if (!selectedChapter) return
    setActionError(null)
    notify('修复中…')
    try {
      const r = await novelApi.fix(id, selectedChapter)
      setContent(r.content)
      savedContentRef.current = r.content
      dirtyRef.current = false
      fixDoneRef.current = true
      if (r.rescore) {
        setReviewResult({ score: r.rescore.score, needsFix: r.rescore.needsFix } as Record<string, unknown>)
        notify(
          `修复完成（第 ${r.round} 轮），重审评分 ${r.rescore.score}${r.rescore.passed ? '，已达标 ✓' : '，未达标（建议人工修改）'}`
        )
      } else {
        notify(`修复完成（第 ${r.round} 轮）`)
      }
      await invalidate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  // P21-3：方案流水线（跑在章节上）
  const solutionsForRun = useQuery({ queryKey: ['studio-solutions', 'run'], queryFn: studioApi.solutions })

  // P30：以方案生产正文（whole_book 步骤接力，空章节）
  const produceWithSolution = async (): Promise<void> => {
    if (!selectedChapter || !solutionId) return
    setActionError(null)
    setSolutionRunSummary(null)
    // v0.17.0（审查 A4）：此前无 try/catch——失败时异常穿透 withBusy 的 finally，按钮卡在 busy 态
    try {
      // v0.23.1（批次 D1）：迁 job 队列——入队 + 轮询终态（可到任务中心取消；不再占 HTTP 长连接）
      const { jobId } = await studioApi.solutionProduceChapter(solutionId, id, selectedChapter)
      const job = await waitForJob(jobId)
      if (job.status === 'failed') throw new Error(job.error ?? '方案生产失败')
      if (job.status === 'cancelled') throw new Error('方案生产已取消')
      const r = (job.result ?? {}) as {
        wordCount?: number
        degraded?: boolean
        outputs?: Array<{ role: string; ok: boolean }>
      }
      // 正文已由 job 服务端落库——重新拉详情回显（含可能的大纲标题更新）
      const d = await novelApi.chapterDetail(id, selectedChapter)
      const fresh = d.chapter.content ?? ''
      setContent(fresh)
      savedContentRef.current = fresh
      dirtyRef.current = false
      notify(`方案生产完成：${r.wordCount ?? 0} 字${r.degraded ? '（部分步骤降级）' : ''}`)
      setSolutionRunSummary((r.outputs ?? []).map((o, i) => `${i + 1}.${o.role}${o.ok ? '' : ' ✗'}`).join(' | '))
      await invalidate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const runSolutionOnChapter = async (): Promise<void> => {
    if (!selectedChapter || !solutionId) return
    setSolutionRunSummary(null)
    setActionError(null)
    try {
      const r = await studioApi.solutionRun(solutionId, id, selectedChapter)
      setSolutionRunSummary(r.run.degraded ? `⚠ 部分步骤降级\n${r.summary}` : r.summary)
      notify(`方案完成${r.run.degraded ? '（部分降级）' : ''}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  return {
    actionBusy,
    actionMsg,
    actionError,
    setActionError,
    notify,
    withBusy,
    runReview,
    reviewResult,
    setReviewResult,
    runProofread,
    proofreadIssues,
    setProofreadIssues,
    fix,
    solutionId,
    setSolutionId,
    solutionRunSummary,
    runSolutionOnChapter,
    produceWithSolution,
    solutions: solutionsForRun.data?.solutions ?? []
  }
}
