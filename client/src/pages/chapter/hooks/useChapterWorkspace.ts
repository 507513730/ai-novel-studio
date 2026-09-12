import { useAiDrafts } from './useAiDrafts'
import type { WorkspaceTab } from '../WorkspaceTabs'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { usePrompt } from '../../../components/PromptDialog'
import { useToast } from '../../../components/toastGlobal'
import { useConfirm } from '../../../components/useConfirm'
// v0.25.0（审查 S1）：UI 面板全部分拆至 ./chapter/——
// 本文件只保留章节生产链路的状态与动作编排（生成/审核/修复/回灌/版本/方案）
// R7：编辑会话/正文加载/生成控制三块异步编排抽至 ./chapter/hooks/
// v0.26.0（批次 B，AGENTS #38）：动作/产物/续写/快捷键/文件操作五 hook + 右栏 ExecutionPanel 拆分，
// 本页降至装配层（<400 行 / 4 useState）
import { useActionFeedback } from './useActionFeedback'
import { useEditorSession } from './useEditorSession'
import { useChapterLoader } from './useChapterLoader'
import { useGenerationController } from './useGenerationController'
import { useChapterActions } from './useChapterActions'
import { useChapterArtifacts } from './useChapterArtifacts'
import { useChapterCandidates } from './useChapterCandidates'
import { useSuggestion } from './useSuggestion'
import { useChapterShortcuts, type ChapterActionRef } from './useChapterShortcuts'
import { useChapterList } from './useChapterList'
import { useChapterFileOps } from './useChapterFileOps'
import { useChapterNavigation } from './useChapterNavigation'

export function useChapterWorkspace() {
  const { novelId } = useParams()
  const { toast } = useToast()
  const navigate = useNavigate()
  const id = Number(novelId)
  const queryClient = useQueryClient()
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
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
  const [assistantTab, setAssistantTab] = useState<WorkspaceTab>('write')
  const [mobilePanel, setMobilePanel] = useState<'chapters' | 'assistant' | null>(null)
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
    fixDoneRef,
    saveContent, readContent: session.readContent
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
    onActionError: feedback.setActionError,
    saveContent, readContent: session.readContent
  })

  // R7：正文加载（详情端点按需 + 竞态序号丢弃过期响应）
  const { contentLoading } = useChapterLoader({
    novelId: id,
    selectedChapter,
    reloadKey,
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
    onActionError: feedback.setActionError,
    saveContent, readContent: session.readContent
  })

  const ai = useAiDrafts({ novelId: id, selectedChapter, chapterTitle: chapter?.title, editorRef,
    saveContent, applySelection, insertAt, onError: feedback.setActionError, notify: feedback.notify })
  const requestAi = async (action: string, instruction?: string): Promise<void> => {
    if (streamingRef.current || contentLoadingRef.current) return
    setAssistantTab('versions')
    setMobilePanel('assistant')
    await ai.request(action, instruction)
  }
  const { selectChapter } = useChapterNavigation({
    novelId: id, selectedChapter, streamingRef, saveContent,
    canLeaveWithoutSave: () => loadedChapterRef.current === null && !dirtyRef.current && !session.readContent().trim(),
    onReload: () => setReloadKey(value => value + 1),
    onStreaming: () => toast('info', '生成中，请先取消生成再切换章节'),
    onError: feedback.setActionError,
    onSelect: (chapterId) => {
      setSelectedChapter(chapterId)
      selectedChapterRef.current = chapterId
      suggestion.resetSuggestion()
      actions.setReviewResult(null)
      artifacts.setBackfillResult(null)
      feedback.setActionError(null)
    }
  })

  return { ai, requestAi, assistantTab, setAssistantTab, mobilePanel, setMobilePanel, chapterPromptElement, confirmDialog, fileOps, focusMode, setFocusMode, id, list, chaptersLoading, chaptersError, selectedChapter, selectChapter, artifacts, askChapterTitle, feedback, actions, invalidate, navigate, chapter, hanCount, statsShow, chapterStats, saving, streaming, contentLoading, guidanceDraft, setGuidanceDraft, saveContent, generate, viewMode, setViewMode, selectionInfo, content, applySelection, insertAt, chapterIdx, dirtyRef, setContent, updateSelectionInfo, trackHumanWords, quickWords, suggestion, editorRef, streamStat, fixDoneRef, backfillDoneRef, snapshotDoneRef, savedContentRef, cancelGenerate, confirmFn, candidates, buildInclude, session }
}
