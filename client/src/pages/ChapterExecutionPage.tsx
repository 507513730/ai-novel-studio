import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { assetsApi } from '../api'
import { usePrompt } from '../components/PromptDialog'
import { SelectionToolbar } from '../editor/SelectionToolbar'
import { useToast } from '../components/toastGlobal'
import { useConfirm } from '../components/useConfirm'
// v0.25.0（审查 S1）：UI 面板全部分拆至 ./chapter/——
// 本文件只保留章节生产链路的状态与动作编排（生成/审核/修复/回灌/版本/方案）
// R7：编辑会话/正文加载/生成控制三块异步编排抽至 ./chapter/hooks/
// v0.26.0（批次 B，AGENTS #38）：动作/产物/续写/快捷键/文件操作五 hook + 右栏 ExecutionPanel 拆分，
// 本页降至装配层（<400 行 / 4 useState）
import { ChapterToolbar, EditorPane, type ExportFormat } from './chapter/EditorArea'
import { ReadingView } from './chapter/ReadingView'
import { ExportPreviewModal } from './chapter/ExportPreviewModal'
import { ResourcePanel } from './chapter/ResourcePanel'
import { ExecutionPanel } from './chapter/ExecutionPanel'
import { useActionFeedback } from './chapter/hooks/useActionFeedback'
import { useEditorSession } from './chapter/hooks/useEditorSession'
import { useChapterLoader } from './chapter/hooks/useChapterLoader'
import { useGenerationController } from './chapter/hooks/useGenerationController'
import { useChapterActions } from './chapter/hooks/useChapterActions'
import { useChapterArtifacts } from './chapter/hooks/useChapterArtifacts'
import { useChapterCandidates } from './chapter/hooks/useChapterCandidates'
import { useSuggestion } from './chapter/hooks/useSuggestion'
import { useChapterShortcuts, type ChapterActionRef } from './chapter/hooks/useChapterShortcuts'
import { useChapterList } from './chapter/hooks/useChapterList'
import { useChapterFileOps } from './chapter/hooks/useChapterFileOps'

export function ChapterExecutionPage(): React.JSX.Element {
  const { novelId } = useParams()
  const { toast } = useToast()
  const navigate = useNavigate()
  const id = Number(novelId)
  const queryClient = useQueryClient()
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null)
  // v0.22.0（审查 ALOW）：themed confirm 统一
  const [confirmFn, confirmDialog] = useConfirm()
  // v0.21.0（审查 N2）：当前章节 ref（续写响应校验用——防切章后旧章建议串入）
  const selectedChapterRef = useRef<number | null>(null)
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  // R7：加载器/生成器/会话三方的协调管道（页面创建，ref 语义跨渲染稳定）
  const contentLoadingRef = useRef(false)
  const loadedChapterRef = useRef<number | null>(null)
  const savedContentRef = useRef('')
  const dirtyRef = useRef(false)
  const streamingRef = useRef(false)
  // P12 A3：章节进度矩阵信号（跨渲染记录，不新增请求）
  const fixDoneRef = useRef(false)
  const backfillDoneRef = useRef(false)
  const snapshotDoneRef = useRef(false)
  // P27 1-6：正文自动保存节流
  const [focusMode, setFocusMode] = useState(false)
  // v0.24.2（F1）：阅读/复盘视图模式
  const [viewMode, setViewMode] = useState<'edit' | 'read'>('edit')
  // P19 ④：单次生成引导输入（生成后保留，供参考）
  const [guidanceDraft, setGuidanceDraft] = useState('')
  // v0.17.0（审查 A5）：快捷键闭包缓存——注册在 useChapterShortcuts，每渲染经 bindActions 注入最新闭包
  const latestActionsRef = useRef<ChapterActionRef | null>(null)
  // P27 0b：应用内输入对话框（替代 window.prompt）
  const { prompt: askChapterTitle, element: chapterPromptElement } = usePrompt()

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['chapters', id] })
  }

  // 批次 B：动作反馈原语（busy/提示/错误）——session 与 actions 的公共底层，先于二者声明
  const feedback = useActionFeedback()

  // R7：编辑会话（正文状态/保存/空内容保护/字数分离/选区与 AI 插入）
  const session = useEditorSession({
    novelId: id,
    selectedChapter,
    editorRef,
    streamingRef,
    contentLoadingRef,
    loadedChapterRef,
    savedContentRef,
    dirtyRef,
    invalidate,
    toast,
    notify: feedback.notify,
    onActionError: feedback.setActionError
  })
  const { content, setContent, saving, wordStats, setWordStats, aiDeltaRef, humanDeltaRef, selectionInfo, updateSelectionInfo, applySelection, insertAt, insertAi, trackHumanWords, saveContent, hanCount } = session

  // 批次 B：动作编排（busy/提示/错误 + 审核/校对/修复 + 方案）
  const actions = useChapterActions({
    novelId: id,
    selectedChapter,
    content,
    feedback,
    invalidate,
    setContent,
    savedContentRef,
    dirtyRef,
    fixDoneRef
  })

  // 批次 B：产物面板（待确认/记忆/版本/上下文/回灌产物）
  const artifacts = useChapterArtifacts({
    novelId: id,
    selectedChapter,
    notify: feedback.notify,
    withBusy: feedback.withBusy,
    confirmFn,
    invalidate,
    setContent,
    savedContentRef,
    dirtyRef,
    onActionError: feedback.setActionError
  })

  // R7：正文加载（详情端点按需 + 竞态序号丢弃过期响应）
  const { contentLoading } = useChapterLoader({
    novelId: id,
    selectedChapter,
    setContent,
    savedContentRef,
    dirtyRef,
    loadedChapterRef,
    contentLoadingRef,
    resetSessionBits: () => {
      // v0.19.0：切换章节重置会话字数统计与续写建议；v0.24.2（F3）：版本 diff
      aiDeltaRef.current = 0
      humanDeltaRef.current = 0
      setWordStats({ ai: 0, human: 0 })
      suggestion.setSuggestion(null)
      artifacts.setVersionDiff(null)
    },
    onSwitchError: feedback.setActionError
  })

  // R7：生成控制（SSE 累积/中止兜底/成本确认）
  const { streaming, streamStat, generate, cancelGenerate } = useGenerationController({
    novelId: id,
    selectedChapter,
    editorRef,
    content,
    savedContentRef,
    dirtyRef,
    streamingRef,
    setContent,
    confirmFn,
    guidanceDraft,
    buildInclude,
    invalidate,
    onActionError: feedback.setActionError,
    onGenerated: actions.notify
  })

  // B1：生成时带 include（勾选过滤；生成 hook 依赖此闭包）
  function buildInclude(): string[] | undefined {
    const toggles = artifacts.ctxToggles
    if (!toggles) return undefined
    const enabled = Object.entries(toggles)
      .filter(([, v]) => v)
      .map(([k]) => k)
    return enabled.length > 0 ? enabled : undefined
  }

  // v0.19.0：光标续写（Cmd/Ctrl+J 触发 / Tab 接受）
  const suggestion = useSuggestion({
    novelId: id,
    editorRef,
    selectedChapterRef,
    selectedChapter,
    streaming,
    insertAi,
    onActionError: actions.setActionError
  })

  // 批次 B：章节列表数据采集（查询/派生统计/初始选中收拢 hook）
  const { list, chapter, chapterIdx, chapterStats, statsShow, quickWords, isLoading: chaptersLoading, error: chaptersError } = useChapterList({
    novelId: id,
    selectedChapter,
    selectedChapterRef,
    onSelect: (cid) => {
      setSelectedChapter(cid)
      selectedChapterRef.current = cid
    },
    wordStats
  })

  // 批次 B：全局键盘/自动保存编排（快捷键/Cmd+J/Tab/beforeunload/Esc/失焦与定时保存）
  useChapterShortcuts({
    latestActionsRef,
    bindActions: () => ({
      saveContent,
      generate,
      withBusy: feedback.withBusy,
      runReview: actions.runReview,
      backfill: artifacts.backfill,
      suggestContinue: suggestion.suggestContinue,
      acceptSuggestion: suggestion.acceptSuggestion,
      hasSuggestion: suggestion.hasSuggestion
    }),
    setFocusMode,
    closeAllPanels: artifacts.closeAllPanels,
    resetSuggestion: suggestion.resetSuggestion,
    selectedChapter,
    dirtyRef,
    streamingRef,
    contentLoadingRef
  })

  // 批次 B：文件/元信息操作（导出/标题/引导句固定约束）
  const fileOps = useChapterFileOps({
    novelId: id,
    selectedChapter,
    chapterTitle: chapter?.title,
    notify: actions.notify,
    invalidate,
    toast
  })

  // v1.0 后续（A1 多候选分支生成）：串行生成 N 份候选 → 面板对比 → 采用为正文
  const candidates = useChapterCandidates({
    novelId: id,
    selectedChapter,
    setContent,
    savedContentRef,
    dirtyRef,
    invalidate,
    notify: actions.notify,
    onActionError: feedback.setActionError
  })

  const selectChapter = async (chapterId: number): Promise<void> => {
    if (streamingRef.current) {
      toast('info', '生成中，请先取消生成再切换章节')
      return
    }
    if (chapterId === selectedChapter) return
    // P9 A4：保存失败中断切换（不再继续切换并清空编辑区）
    try {
      await saveContent({ silent: true })
    } catch {
      feedback.setActionError('保存失败，已中断切换，请重试')
      return
    }
    setSelectedChapter(chapterId)
    // v0.21.0（审查 N2）：同步 ref + 中止在途续写请求 + seq 失效
    selectedChapterRef.current = chapterId
    suggestion.resetSuggestion()
    actions.setReviewResult(null)
    artifacts.setBackfillResult(null)
    feedback.setActionError(null)
  }

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
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
        {/* 左：资源树（v0.25.0：拆至 ResourcePanel，其加载状态不再触发整页重渲染） */}
        <ResourcePanel
          novelId={id}
          hidden={focusMode}
          chapters={list}
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <ChapterToolbar
            title={chapter?.title ?? '选择章节'}
            summary={chapter?.summary}
            hanCount={hanCount}
            humanWords={statsShow.human}
            aiWords={statsShow.ai}
            stats={chapterStats}
            saving={saving}
            streaming={streaming}
            contentLoading={contentLoading}
            hasChapter={selectedChapter !== null}
            guidance={guidanceDraft}
            onGuidanceChange={setGuidanceDraft}
            onSave={() => void saveContent().catch(() => undefined)}
            onGenerate={() => void generate()}
            viewMode={viewMode}
            onToggleViewMode={() => setViewMode((m) => (m === 'edit' ? 'read' : 'edit'))}
            onPinGuidance={() => fileOps.pinGuidance(guidanceDraft, () => setGuidanceDraft(''))}
            exportBusy={fileOps.exportBusy}
            onExport={(f: ExportFormat) => void fileOps.openExportPreview(f)}
            onSaveTitle={fileOps.saveTitle}
          />
          <SelectionToolbar
            novelId={id}
            chapterId={selectedChapter ?? 0}
            hasSelection={selectionInfo.text.length > 0}
            selectionText={selectionInfo.text}
            cursorPos={selectionInfo.cursor}
            editorText={content}
            onApplySelection={applySelection}
            onInsertAt={insertAt}
            onSave={saveContent}
          />
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
            {streamStat && <span style={{ color: 'var(--accent-bright)' }}>{streamStat}</span>}
            {feedback.actionMsg && <span style={{ color: 'var(--ok)', marginLeft: 8 }}>{feedback.actionMsg}</span>}
            {feedback.actionError && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>{feedback.actionError}</span>}
          </div>
        </div>

        {/* 右：执行面板（批次 B 重排：主行动强调 + 分组卡，拆至 ExecutionPanel） */}
        {!focusMode && (
          <ExecutionPanel
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
