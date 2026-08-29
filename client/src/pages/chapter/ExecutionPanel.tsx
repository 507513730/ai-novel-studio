import { useMemo } from 'react'
import { HubChat } from '../../components/HubChat'
import type { ChapterSummary } from '../../types'
import { DebtFixBadge } from './DebtFixBadge'
import {
  BackfillResultPanel,
  ContextPanel,
  PendingPanel,
  ProgressMatrix,
  ProofreadPanel,
  ResourceDetailPanel
} from './ChapterPanels'
import { MemoryPanel, ReviewResultPanel } from './ReviewPanel'
import { VersionHistoryPanel } from './VersionHistoryPanel'
import { useChapterActions } from './hooks/useChapterActions'
import { useChapterArtifacts } from './hooks/useChapterArtifacts'

// v0.26.0（批次 B，审查 P1-3 + D27「每屏一个主行动」）：右栏执行面板重排——
// 主行动卡（生成）强调，质量/查看动作收进分组卡 + 双列网格，次级动作不再与主行动等权平铺

interface ExecutionPanelProps {
  novelId: number
  selectedChapter: number | null
  content: string
  contentLoading: boolean
  streaming: boolean
  /** 本章进度矩阵信号（跨渲染 ref 由页面持有） */
  signals: {
    chapter?: ChapterSummary
    fixDoneRef: React.RefObject<boolean>
    backfillDoneRef: React.RefObject<boolean>
    snapshotDoneRef: React.RefObject<boolean>
    savedContentRef: React.RefObject<string>
  }
  confirmFn: (o: { title: string; message: string; confirmText?: string; danger?: boolean; action: () => void }) => void
  onCancelGenerate: () => void
  onGenerate: () => void
  onAdoptAdvice: (advice: string) => void
  actions: ReturnType<typeof useChapterActions>
  artifacts: ReturnType<typeof useChapterArtifacts>
}

export function ExecutionPanel({
  novelId,
  selectedChapter,
  content,
  contentLoading,
  streaming,
  signals,
  confirmFn,
  onCancelGenerate,
  onGenerate,
  onAdoptAdvice,
  actions,
  artifacts
}: ExecutionPanelProps): React.JSX.Element {
  const { actionBusy, actionError } = actions
  const busy = actionBusy !== null
  const hasContent = content.length > 0

  // P12 A3：本章进度矩阵信号（从现有状态推导，不新增请求；原页面逻辑随重排迁入）
  const progressSegments = useMemo<Array<[string, boolean]>>(() => {
    const chapter = signals.chapter
    const taskReady = Boolean(chapter?.goal && Object.keys(chapter.goal).length > 0)
    const contextReady = artifacts.ctxSections !== null
    const draftStarted = content.trim().length > 0
    const draftSaved =
      ['written', 'reviewed', 'done'].includes(chapter?.status ?? '') ||
      signals.savedContentRef.current.trim().length > 0
    const reviewed = actions.reviewResult !== null || ['reviewed', 'done'].includes(chapter?.status ?? '')
    const reviewable = ['reviewed', 'done'].includes(chapter?.status ?? '')
    return [
      ['任务单', taskReady],
      ['上下文', contextReady],
      ['草稿', draftStarted],
      ['保存', draftSaved],
      ['审核', reviewed],
      ['修复', signals.fixDoneRef.current],
      ['回灌', signals.backfillDoneRef.current || actions.reviewResult !== null],
      ['快照', signals.snapshotDoneRef.current],
      ['可审', reviewable]
    ]
  }, [signals.chapter, artifacts.ctxSections, content, actions.reviewResult, signals.fixDoneRef, signals.backfillDoneRef, signals.snapshotDoneRef, signals.savedContentRef])

  return (
    <div
      style={{
        width: 320,
        borderLeft: '1px solid var(--border)',
        padding: 12,
        overflowY: 'auto',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <h2 style={{ fontSize: 15, marginBottom: 0 }}>执行面板</h2>

      {/* P12 A3：本章进度矩阵 */}
      {selectedChapter && <ProgressMatrix segments={progressSegments} />}

      {/* 主行动卡：当前最该做的事（accent 边强调） */}
      <div
        className="panel"
        style={{ background: 'var(--bg-card)', padding: 14, borderColor: 'var(--accent)', marginBottom: 0 }}
      >
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>当前推荐</div>
        {streaming ? (
          <button className="danger" style={{ width: '100%', padding: '10px 14px', fontSize: 14 }} onClick={onCancelGenerate} disabled={busy}>
            取消生成（保留已生成部分）
          </button>
        ) : (
          <button
            className="primary"
            style={{ width: '100%', padding: '10px 14px', fontSize: 14 }}
            onClick={onGenerate}
            disabled={!selectedChapter || busy || contentLoading}
          >
            {contentLoading ? '正文加载中…' : '生成正文'}
          </button>
        )}
        <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
          {streaming
            ? '生成中可随时取消，已生成部分会保留在编辑器中'
            : selectedChapter
              ? '根据写作上下文与本章任务单生成本章正文'
              : '请先在左侧选择章节'}
        </div>
      </div>

      {/* 分组：质量与连续性 */}
      <div className="panel" style={{ background: 'var(--bg-card)', padding: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>质量与连续性</div>
        <div className="action-grid">
          <button
            className="sm"
            onClick={() => void actions.withBusy('review', () => actions.runReview())}
            disabled={busy || !selectedChapter || !hasContent}
          >
            {actionBusy === 'review' ? '审核中…' : 'AI 审核'}
          </button>
          <button
            className="sm"
            onClick={() => void actions.withBusy('proofread', actions.runProofread)}
            disabled={busy || !selectedChapter || !hasContent}
          >
            {actionBusy === 'proofread' ? '校对中…' : '本地校对'}
          </button>
          <button
            className="sm"
            onClick={() => void actions.withBusy('fix', () => actions.fix())}
            disabled={busy || !selectedChapter || !hasContent}
          >
            {actionBusy === 'fix' ? '修复中…' : '修复 + 重审'}
          </button>
          <button
            className="sm"
            onClick={() => void actions.withBusy('backfill', () => artifacts.backfill())}
            disabled={busy || !selectedChapter || !hasContent}
          >
            {actionBusy === 'backfill' ? '回灌中…' : '状态回灌'}
          </button>
        </div>
        {actions.proofreadIssues !== null && (
          <div style={{ marginTop: 8 }}>
            <ProofreadPanel issues={actions.proofreadIssues} onClose={() => actions.setProofreadIssues(null)} />
          </div>
        )}
        {/* P21-3：跑创作方案 + P30：以方案生产正文 */}
        <div className="col gap-2" style={{ marginTop: 10 }}>
          <div className="row gap-2">
            <select
              style={{ flex: 1, fontSize: 12, minWidth: 0 }}
              value={actions.solutionId ?? ''}
              disabled={busy || !selectedChapter}
              onChange={(e) => actions.setSolutionId(Number(e.target.value) || null)}
            >
              <option value="">方案流水线（可选）…</option>
              {actions.solutions.map((s) => (
                <option key={Number(s.id)} value={Number(s.id)}>
                  {String(s.name)}（{Array.isArray(s.steps) ? (s.steps as unknown[]).length : 0} 步）
                </option>
              ))}
            </select>
          </div>
          <div className="row gap-2">
            <button
              className="sm"
              style={{ flex: 1 }}
              disabled={busy || !selectedChapter || !hasContent || !actions.solutionId}
              onClick={() => void actions.withBusy('solution-run', () => actions.runSolutionOnChapter())}
            >
              {actionBusy === 'solution-run' ? '运行中…' : '跑方案'}
            </button>
            <button
              className="sm"
              style={{ flex: 1, color: 'var(--accent-bright)', borderColor: 'var(--accent)' }}
              disabled={busy || !selectedChapter || content !== '' || !actions.solutionId}
              title="用方案的章节生产步骤接力生成正文（需空章节）"
              onClick={() =>
                confirmFn({
                  title: '方案接力生产',
                  message: '用方案步骤接力生产正文（将替换本章内容）？',
                  confirmText: '生产',
                  danger: true,
                  action: () => void actions.withBusy('solution-produce', () => actions.produceWithSolution())
                })
              }
            >
              {actionBusy === 'solution-produce' ? '流水线生产中…' : '以方案生产'}
            </button>
          </div>
          {/* v0.10.0（批B/I2）：质量债自动修复徽标 */}
          <DebtFixBadge novelId={novelId} />
          {actions.solutionRunSummary && (
            <div
              className="muted"
              style={{
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                maxHeight: 120,
                overflowY: 'auto',
                background: 'var(--bg-panel)',
                borderRadius: 6,
                padding: 6
              }}
            >
              {actions.solutionRunSummary}
            </div>
          )}
        </div>
      </div>

      {/* 分组：查看与记录（渐进披露——查看类动作弱化为双列小按钮） */}
      <div className="panel" style={{ background: 'var(--bg-card)', padding: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>查看与记录</div>
        <div className="action-grid">
          <button className="sm" onClick={() => void artifacts.loadPending()} disabled={busy}>
            {actionBusy === 'pending' ? '加载中…' : '待确认区'}
          </button>
          <button className="sm" onClick={() => void artifacts.loadMemory()} disabled={busy || artifacts.memoryBusy}>
            {artifacts.memoryBusy ? '加载中…' : '记忆面'}
          </button>
          <button
            className="sm"
            onClick={() => void actions.withBusy('versions', () => artifacts.loadVersions())}
            disabled={busy || !selectedChapter}
          >
            {actionBusy === 'versions' ? '加载中…' : '版本历史'}
          </button>
          <button
            className="sm"
            onClick={() => void actions.withBusy('snapshot', () => artifacts.snapshotNow())}
            disabled={busy || !selectedChapter || !hasContent}
          >
            {actionBusy === 'snapshot' ? '快照中…' : '存快照'}
          </button>
          <button
            className="sm"
            onClick={() => void actions.withBusy('context', () => artifacts.loadContextPreview())}
            disabled={busy || !selectedChapter}
          >
            {actionBusy === 'context' ? '加载中…' : '写作上下文'}
          </button>
        </div>
      </div>

      {actionError && (
        <div className="error-msg" style={{ fontSize: 12 }}>
          {actionError}
        </div>
      )}

      {actions.reviewResult && (
        <ReviewResultPanel
          review={actions.reviewResult}
          streaming={streaming}
          busy={busy}
          onAdopt={onAdoptAdvice}
        />
      )}

      {artifacts.backfillResult && (
        <BackfillResultPanel result={artifacts.backfillResult} busy={busy} onConfirm={() => void artifacts.confirmStates()} />
      )}

      {artifacts.showPending && <PendingPanel pending={artifacts.pending} onClose={() => artifacts.setShowPending(false)} />}

      {artifacts.showMemory && (
        <MemoryPanel
          memory={artifacts.memory}
          patchBusy={artifacts.memoryPatchBusy}
          onPatchCharState={(name, state, remove) => void artifacts.patchCharState(name, state, remove)}
          onPatchFactionState={(name, state) => void artifacts.patchFactionState(name, state)}
          onClose={() => artifacts.setShowMemory(false)}
        />
      )}

      {artifacts.showVersions && (
        <VersionHistoryPanel
          versions={artifacts.versions}
          versionDiff={artifacts.versionDiff}
          busy={busy}
          streaming={streaming}
          actions={artifacts.versionActions}
          onClose={() => artifacts.setShowVersions(false)}
        />
      )}

      {artifacts.ctxSections && artifacts.ctxToggles && (
        <ContextPanel
          sections={artifacts.ctxSections}
          toggles={artifacts.ctxToggles}
          onToggle={(key) => artifacts.setCtxToggles((prev) => ({ ...(prev ?? {}), [key]: !(prev?.[key] ?? true) }))}
          onClose={artifacts.closeContextPanel}
        />
      )}

      {artifacts.resourceDetail && (
        <ResourceDetailPanel detail={artifacts.resourceDetail} onClose={() => artifacts.setResourceDetail(null)} />
      )}

      {/* D2：AI 对话侧栏（折叠） */}
      <details style={{ marginTop: 2 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>AI 对话（对话即创作）</summary>
        <div
          style={{
            marginTop: 8,
            height: 320,
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--bg-card)'
          }}
        >
          <HubChat novelId={novelId} />
        </div>
      </details>
    </div>
  )
}
