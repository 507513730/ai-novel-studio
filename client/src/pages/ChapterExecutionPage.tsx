import './chapter/workspace.css'
import { useParams } from 'react-router-dom'
import { assetsApi } from '../api'
import { SelectionToolbar } from '../editor/SelectionToolbar'
import { ChapterToolbar, EditorPane, type ExportFormat } from './chapter/EditorArea'
import { ReadingView } from './chapter/ReadingView'
import { ExportPreviewModal } from './chapter/ExportPreviewModal'
import { ResourcePanel } from './chapter/ResourcePanel'
import { ExecutionPanel } from './chapter/ExecutionPanel'
import { useChapterWorkspace } from './chapter/hooks/useChapterWorkspace'

export function ChapterExecutionPage(): React.JSX.Element {
  const { novelId } = useParams()
  return <ChapterWorkspace key={novelId} />
}

function ChapterWorkspace(): React.JSX.Element {
  const { ai, requestAi, assistantTab, setAssistantTab, mobilePanel, setMobilePanel, chapterPromptElement, confirmDialog, fileOps, focusMode, setFocusMode, id, list, chaptersLoading, chaptersError, selectedChapter, selectChapter, artifacts, askChapterTitle, feedback, actions, invalidate, navigate, chapter, hanCount, statsShow, saving, streaming, contentLoading, guidanceDraft, setGuidanceDraft, saveContent, generate, viewMode, setViewMode, selectionInfo, content, chapterIdx, dirtyRef, setContent, updateSelectionInfo, trackHumanWords, quickWords, suggestion, editorRef, streamStat, fixDoneRef, backfillDoneRef, snapshotDoneRef, savedContentRef, cancelGenerate, confirmFn, candidates, buildInclude, session } = useChapterWorkspace()

  return (
    <>
      {chapterPromptElement}
      {confirmDialog}
      {fileOps.exportPreviewFormat && (
        <ExportPreviewModal
          novelId={id}
          format={fileOps.exportPreviewFormat}
          onClose={fileOps.closeExportPreview}
          onDownload={(f) => void fileOps.downloadExport(f)}
          downloadBusy={fileOps.exportBusy}
          onToggleFormat={fileOps.toggleExportFormat}
        />
      )}
      {focusMode && (
        <div style={{ position: 'fixed', top: 8, right: 12, zIndex: 'var(--z-dropdown)', fontSize: 'var(--fs-11)' }} className="muted">
          专注模式 · Ctrl+Shift+F 退出 · Esc 退出
        </div>
      )}
      <div className="chapter-workspace" data-panel={focusMode ? undefined : mobilePanel} onKeyDown={e => { if (e.key === 'Escape') setMobilePanel(null) }}>
        {/* 左：资源树（v0.25.0：拆至 ResourcePanel，其加载状态不再触发整页重渲染） */}
        <ResourcePanel
          novelId={id}
          hidden={focusMode}
          chapters={list}
          pendingChapterIds={ai.drafts.map(draft => draft.chapterId)}
          loading={chaptersLoading}
          error={chaptersError}
          selectedChapter={selectedChapter}
          onSelectChapter={(cid) => void selectChapter(cid)}
          onShowDetail={artifacts.setResourceDetail}
          onNewChapter={() => {
            void askChapterTitle({ title: '新章节标题（留空自动编号）', defaultValue: '' }).then((t) => {
              if (t === null) return
              feedback.setActionError(null)
              void actions.withBusy('chapter-create', async () => {
                const r = await assetsApi.chapterCreate(id, { title: t.trim() || undefined })
                actions.notify(`已创建章节 #${r.id}（空章，可编辑标题或直接生成）`)
                await invalidate()
              })
            })
          }}
          onOpenWorkspace={() => navigate(`/novels/${id}`)}
        />

        {/* 中：编辑器 */}
        <div className="chapter-editor-column">
          <ChapterToolbar
            key={selectedChapter}
            title={chapter?.title ?? '选择章节'}
            hanCount={hanCount}
            saving={saving}
            dirty={dirtyRef.current || content !== savedContentRef.current}
            saveError={session.saveError}
            hasConflict={session.hasConflict}
            resolvingConflict={session.resolvingConflict}
            onResolveConflict={() => void session.resolveConflict().catch(() => undefined)}
            focusMode={focusMode}
            onToggleFocus={() => setFocusMode(value => !value)}
            onTogglePanel={panel => setMobilePanel(value => value === panel ? null : panel)}
            streaming={streaming}
            contentLoading={contentLoading}
            hasChapter={selectedChapter !== null}
            onSave={() => void saveContent().catch(() => undefined)}
            viewMode={viewMode}
            onToggleViewMode={() => setViewMode((m) => (m === 'edit' ? 'read' : 'edit'))}
            exportBusy={fileOps.exportBusy}
            onExport={(f: ExportFormat) => void fileOps.openExportPreview(f)}
            onSaveTitle={fileOps.saveTitle}
          />
          <SelectionToolbar hasSelection={selectionInfo.text.length > 0} busy={ai.running !== null}
            disabled={streaming || contentLoading || viewMode === 'read'} onRequest={requestAi} />
          {viewMode === 'read' ? (
            <ReadingView
              title={chapter?.title ?? '未命名章节'}
              content={content}
              hanCount={hanCount}
              aiWords={statsShow.ai}
              humanWords={statsShow.human}
              canPrev={chapterIdx > 0}
              canNext={chapterIdx >= 0 && chapterIdx < list.length - 1}
              onPrev={() => {
                const p = list[chapterIdx - 1]
                if (p) void selectChapter(p.id)
              }}
              onNext={() => {
                const n = list[chapterIdx + 1]
                if (n) void selectChapter(n.id)
              }}
              onBackToEdit={() => setViewMode('edit')}
            />
          ) : (
            <EditorPane
              content={content}
              onContentChange={(v) => {
                dirtyRef.current = true
                setContent(v)
              }}
              onEditorUpdate={(u) => {
                updateSelectionInfo()
                // v0.19.0：人工输入统计（AI 来源已在 dispatch 侧累计）
                trackHumanWords(u as never)
              }}
              streaming={streaming}
              contentLoading={contentLoading}
              hasChapter={selectedChapter !== null}
              summary={chapter?.summary}
              quickWords={quickWords}
              suggestion={suggestion.suggestion}
              sugBusy={suggestion.sugBusy}
              onAcceptSuggestion={suggestion.acceptSuggestion}
              onRegenerateSuggestion={() => void suggestion.suggestContinue()}
              onCloseSuggestion={() => suggestion.setSuggestion(null)}
              onGenerate={() => void generate()}
              busy={actions.actionBusy !== null}
              editorRef={editorRef}
            />
          )}
          <div className="statusbar">
            <span>{hanCount.toLocaleString()} 字 · 我的 {statsShow.human.toLocaleString()} · AI {statsShow.ai.toLocaleString()}</span>
            {ai.running && <span role="status">正在处理：{ai.running.title}</span>}
            {streamStat && <span style={{ color: 'var(--accent-bright)' }}>{streamStat}</span>}
            {feedback.actionMsg && <span style={{ color: 'var(--ok)', marginLeft: 8 }}>{feedback.actionMsg}</span>}
            {feedback.actionError && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>{feedback.actionError}</span>}
          </div>
        </div>

        {/* 右：执行面板（批次 B 重排：主行动强调 + 分组卡，拆至 ExecutionPanel） */}
        {!focusMode && (
          <ExecutionPanel
            tab={assistantTab} onTab={setAssistantTab} ai={ai} onSelectChapter={cid => void selectChapter(cid)}
            guidance={guidanceDraft} onGuidanceChange={setGuidanceDraft}
            onPinGuidance={() => fileOps.pinGuidance(guidanceDraft, () => setGuidanceDraft(''))}
            onContinue={() => void requestAi('continue')}
            novelId={id}
            selectedChapter={selectedChapter}
            content={content}
            contentLoading={contentLoading}
            streaming={streaming}
            signals={{
              chapter,
              fixDoneRef,
              backfillDoneRef,
              snapshotDoneRef,
              savedContentRef
            }}
            confirmFn={confirmFn}
            onCancelGenerate={cancelGenerate}
            onGenerate={() => void generate()}
            onAdoptAdvice={(advice) => {
              confirmFn({
                title: '采纳建议重写',
                message: `将按以下建议重新生成本章（当前内容会被替换）：\n\n${advice.slice(0, 300)}`,
                confirmText: '重写',
                danger: true,
                action: () => {
                  setGuidanceDraft(advice)
                  void generate()
                }
              })
            }}
            actions={actions}
            artifacts={artifacts}
            candidates={candidates}
            buildInclude={buildInclude}
          />
        )}
      </div>
    </>
  )
}
