import { WorkspaceTabs, type WorkspaceTab } from './WorkspaceTabs'
import { AiDraftsPanel } from './AiDraftsPanel'
import type { useAiDrafts } from './hooks/useAiDrafts'
import { HubChat } from '../../components/HubChat'
import type { ChapterSummary } from '../../types'
import { DebtFixBadge } from './DebtFixBadge'
import {
  BackfillResultPanel,
  ContextPanel,
  PendingPanel,
  ProofreadPanel,
  ResourceDetailPanel
} from './ChapterPanels'
import { MemoryPanel, ReviewResultPanel } from './ReviewPanel'
import { VersionHistoryPanel } from './VersionHistoryPanel'
import { CandidatesPanel } from './CandidatesPanel'
import { useChapterActions } from './hooks/useChapterActions'
import { useChapterArtifacts } from './hooks/useChapterArtifacts'
import type { useChapterCandidates } from './hooks/useChapterCandidates'

// v0.26.0（批次 B，审查 P1-3 + D27「每屏一个主行动」）：右栏执行面板重排——
// 主行动卡（生成）强调，质量/查看动作收进分组卡 + 双列网格，次级动作不再与主行动等权平铺

interface ExecutionPanelProps {
  tab: WorkspaceTab
  onTab: (tab: WorkspaceTab) => void
  ai: ReturnType<typeof useAiDrafts>
  onSelectChapter: (id: number) => void
  guidance: string
  onGuidanceChange: (text: string) => void
  onPinGuidance: () => void
  onContinue: () => void
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
  candidates: ReturnType<typeof useChapterCandidates>
  buildInclude: () => string[] | undefined
}

export function ExecutionPanel({
  tab, onTab, ai, onSelectChapter, guidance, onGuidanceChange, onPinGuidance, onContinue,
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
  artifacts,
  candidates,
  buildInclude
}: ExecutionPanelProps): React.JSX.Element {
  const { actionBusy, actionError } = actions
  const busy = actionBusy !== null
  const hasContent = content.length > 0

  return (
    <aside className="workspace-assistant" aria-label="写作助手">
      <WorkspaceTabs value={tab} onChange={onTab}>
      <div hidden={tab !== 'write'}>
        <section className="workspace-section">
          <h3>本章任务</h3>
          <p>{signals.chapter?.summary || '选择章节，查看任务并开始写作。'}</p>
          <label htmlFor="chapter-guidance">本次写作要求</label>
          <textarea id="chapter-guidance" value={guidance} onChange={e => onGuidanceChange(e.target.value)} disabled={streaming} placeholder="补充情节、节奏或人物要求…" />
          <button className="sm" disabled={streaming || !guidance.trim()} onClick={onPinGuidance}>固定为书级约束</button>
        </section>
      {/* 主行动卡：当前最该做的事（accent 边强调） */}
      <div
        className="workspace-section"
        style={{ paddingBlock: 12, marginBottom: 12 }}
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
            onClick={hasContent ? onContinue : onGenerate}
            disabled={!selectedChapter || busy || contentLoading || ai.running !== null}
          >
            {contentLoading ? '正文加载中…' : hasContent ? '从光标续写' : '生成正文'}
          </button>
        )}
        <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
          {streaming
            ? '生成中可随时取消，已生成部分会保留在编辑器中'
            : selectedChapter
              ? hasContent ? '续写结果先预览，采用后才写入正文' : '根据本章任务与写作要求生成正文'
              : '请先在左侧选择章节'}
        </div>
        {/* v1.0 后续（A1 多候选分支生成）：串行生成 2 份候选并排对比，选定为正文 */}
        {!streaming && selectedChapter && (
          <button
            className="sm"
            style={{ width: '100%', marginTop: 8, color: 'var(--accent-bright)', borderColor: 'var(--accent)' }}
            disabled={busy || contentLoading || candidates.candidatesBusy}
            onClick={() =>
              confirmFn({
                title: '多候选分支生成',
                message: '将串行生成 2 份候选构想（各自成为一条版本快照，需消耗 2 次生成额度）。生成后可在面板对比，选定一份作为正文，其余保留在版本历史。继续？',
                confirmText: '生成 2 份候选',
                danger: true,
                action: () => { onTab('versions'); void candidates.generateCandidates(2, buildInclude()) }
              })
            }
          >
            {candidates.candidatesBusy ? '候选生成中…' : '多候选分支生成'}
          </button>
        )}
      </div>

        {hasContent && <button className="sm" disabled={busy || streaming || contentLoading} onClick={onGenerate}>重新生成整章…</button>}
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
      <div hidden={tab !== 'check'}>
      {/* 分组：质量与连续性 */}
      <div className="workspace-section" style={{ background: 'var(--bg-card)', padding: 10 }}>
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

      </div>

      </div>
      <div hidden={tab !== 'versions'}>
        <AiDraftsPanel ai={ai} chapterId={selectedChapter} onSelect={onSelectChapter} />
        {/* v1.0 后续（A1 多候选分支生成）：候选并排对比面板 */}
        {candidates.openCandidatesPanel && candidates.candidates && candidates.candidates.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <CandidatesPanel
              candidates={candidates.candidates}
              busy={candidates.candidatesBusy}
              onAdopt={(c) => void candidates.adoptCandidate(c)}
              onClose={candidates.closeCandidates}
            />
          </div>
        )}

      {/* 分组：查看与记录（渐进披露——查看类动作弱化为双列小按钮） */}
      <div className="workspace-section" style={{ background: 'var(--bg-card)', padding: 10 }}>
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

      {/* AI 对话按需展开 */}
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
      </WorkspaceTabs>
    </aside>
  )
}
