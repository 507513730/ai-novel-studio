import { useEffect, useRef, useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { Annotation, type AnnotationType } from '@codemirror/state'
import { novelApi, generateChapterSse, studioApi, assetsApi, authHeaders, waitForJob, apiFetch } from '../api'
import { usePrompt } from '../components/PromptDialog'
import { onShortcut } from '../utils/shortcuts'
import type { VersionDiffInfo } from '../types'
import { SelectionToolbar } from '../editor/SelectionToolbar'
import { HubChat } from '../components/HubChat'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { estimateCost, estimateTokens, fmtCost } from '../utils/costEstimate'
// v0.23.1（批次 B6）：主角名提取统一 utils（此前双实现且正则漂移）
import { extractProtagonistName } from '../utils/protagonist'
// v0.25.0（审查 S1）：UI 面板全部分拆至 ./chapter/——
// 本文件只保留章节生产链路的状态与动作编排（生成/审核/修复/回灌/版本/方案）
import {
  countCjk,
  type ChapterVersion,
  type CtxSection,
  type MemoryData,
  type PendingData,
  type ProofreadIssue,
  type ResourceDetail
} from './chapter/types'
import { DebtFixBadge } from './chapter/DebtFixBadge'
import { ReadingView } from './chapter/ReadingView'
import { ResourcePanel } from './chapter/ResourcePanel'
import { ChapterToolbar, EditorPane, type ExportFormat } from './chapter/EditorArea'
import {
  BackfillResultPanel,
  ContextPanel,
  PendingPanel,
  ProgressMatrix,
  ProofreadPanel,
  ResourceDetailPanel
} from './chapter/ChapterPanels'
import { MemoryPanel, ReviewResultPanel } from './chapter/ReviewPanel'
import { VersionHistoryPanel, type VersionActions } from './chapter/VersionHistoryPanel'

// v0.19.0：AI 写入标记（字数分离：区分 AI 插入与人工输入）
const aiWrite = Annotation.define<boolean>()

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
  const [content, setContent] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  // P12 C2：生成中实时估算显示
  const [streamStat, setStreamStat] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reviewResult, setReviewResult] = useState<Record<string, unknown> | null>(null)
  const [backfillResult, setBackfillResult] = useState<Record<string, unknown> | null>(null)
  const [showPending, setShowPending] = useState(false)
  const [pending, setPending] = useState<PendingData | null>(null)
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const abortRef = useRef<AbortController | null>(null)
  // P9 A1：正文加载/保存防护
  const contentLoadingRef = useRef(false)
  const loadedChapterRef = useRef<number | null>(null)
  const savedContentRef = useRef('')
  const detailSeqRef = useRef(0)
  const dirtyRef = useRef(false)
  const streamingRef = useRef(false)
  const generateBusyRef = useRef(false)
  // v0.17.0（审查 A2）：withBusy 用 ref 做 TOCTOU 守卫（state 更新前双击会双跑）
  const actionBusyRef = useRef<string | null>(null)
  // v0.17.0（审查 A5）：快捷键闭包缓存——effect 固定注册，回调始终取最新版函数
  const latestActionsRef = useRef<{
    saveContent: () => Promise<void>
    generate: () => Promise<void>
    withBusy: (key: string, fn: () => Promise<void> | void) => Promise<void>
    runReview: () => Promise<void>
    backfill: () => Promise<void>
    // v0.19.0：光标续写（Cmd/Ctrl+J 触发 / Tab 接受）
    suggestContinue: () => Promise<void>
    acceptSuggestion: () => void
    // v0.21.0（审查 N3）：Tab 门控（仅编辑器内有建议时拦截）
    hasSuggestion: () => boolean
  } | null>(null)
  // P27 0b：应用内输入对话框（替代 window.prompt）
  const { prompt: askChapterTitle, element: chapterPromptElement } = usePrompt()
  // P20（U6）：流式 rAF 合并缓冲
  const pendingDeltaRef = useRef('')
  const rAFRef = useRef<number | null>(null)
  // 批1-#3（v0.7.2）：内容已由 onDone/onAborted/onError 落定的标记——落定后不再 flush rAF 缓冲（防尾段重复追加）
  const contentSettledRef = useRef(false)
  // P19 ④：单次生成引导输入（生成后保留，供参考）
  const [guidanceDraft, setGuidanceDraft] = useState('')
  // P12 A3：章节进度矩阵信号（跨渲染记录，不新增请求）
  const fixDoneRef = useRef(false)
  const backfillDoneRef = useRef(false)
  const confirmDoneRef = useRef(false)
  const snapshotDoneRef = useRef(false)
  // P20（U5）：字数统计 memo（避免每次击键重渲染时 O(n) 扫描）
  const hanCount = useMemo(() => (content.match(/[\u4e00-\u9fff]/g) ?? []).length, [content])
  // P27 1-6：正文自动保存节流
  const [focusMode, setFocusMode] = useState(false)
  // v0.24.2（F1）：阅读/复盘视图模式
  const [viewMode, setViewMode] = useState<'edit' | 'read'>('edit')
  // A1：选区/光标状态（ref 缓存防 onUpdate 无限重渲染）
  const [selectionInfo, setSelectionInfo] = useState<{ text: string; cursor: number }>({ text: '', cursor: -1 })
  const selectionRef = useRef({ text: '', cursor: -1 })
  // A2：标题内联编辑态已随 ChapterToolbar 拆出（工具条自持 editingTitle/titleDraft）
  // A3：版本历史
  const [versions, setVersions] = useState<ChapterVersion[] | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  // v0.24.2（F3）：版本对比当前 diff（恢复前检视）
  const [versionDiff, setVersionDiff] = useState<VersionDiffInfo | null>(null)
  // B1：写作上下文可视化
  const [ctxSections, setCtxSections] = useState<CtxSection[] | null>(null)
  const [ctxToggles, setCtxToggles] = useState<Record<string, boolean> | null>(null)
  // D1：资源详情浮层（左栏资源树与版本「查看」共用；树本身的状态随 ResourcePanel 拆出）
  const [resourceDetail, setResourceDetail] = useState<ResourceDetail | null>(null)

  const updateSelectionInfo = (): void => {
    const view = editorRef.current?.view
    if (!view) return
    const { from, to } = view.state.selection.main
    const text = view.state.doc.sliceString(from, to)
    const prev = selectionRef.current
    if (prev.text !== text || prev.cursor !== from) {
      selectionRef.current = { text, cursor: from }
      setSelectionInfo({ text, cursor: from })
    }
  }

  // A1：应用选区替换（AI 改写——v0.19.0 标记来源计入 AI 字数）
  const applySelection = (replacement: string): void => {
    const view = editorRef.current?.view
    if (!view) return
    const { from, to } = view.state.selection.main
    if (to > from) {
      view.dispatch({
        changes: { from, to, insert: replacement },
        annotations: aiWrite.of(true)
      })
      view.dispatch({ selection: { anchor: from + replacement.length } })
    }
    const cjk = countCjk(replacement)
    if (cjk > 0) {
      aiDeltaRef.current += cjk
      setWordStats((s) => ({ ...s, ai: s.ai + cjk }))
    }
    setContent(view.state.doc.toString())
    updateSelectionInfo()
  }

  // A1：在指定位置插入（AI 插入——v0.19.0 标记来源计入 AI 字数）
  const insertAt = (text: string, pos: number): void => {
    const view = editorRef.current?.view
    if (!view) return
    const insertPos = Math.min(pos, view.state.doc.length)
    view.dispatch({
      changes: { from: insertPos, insert: text },
      selection: { anchor: insertPos + text.length },
      annotations: aiWrite.of(true)
    })
    const cjk = countCjk(text)
    if (cjk > 0) {
      aiDeltaRef.current += cjk
      setWordStats((s) => ({ ...s, ai: s.ai + cjk }))
    }
    setContent(view.state.doc.toString())
    updateSelectionInfo()
  }

  // ============ v0.19.0：字数分离（人类/AI）+ 光标续写 ============
  // 会话增量（ref 累计，保存时上报后清零）；总字数 = 服务端累计 + 会话增量
  const aiDeltaRef = useRef(0)
  const humanDeltaRef = useRef(0)
  const [wordStats, setWordStats] = useState<{ ai: number; human: number }>({ ai: 0, human: 0 })

  /** AI 写入（标记来源 + 累计 AI 字数）——续写插入/选区工具共用 */
  const insertAi = (text: string, pos: number): void => {
    const view = editorRef.current?.view
    if (!view || !text) return
    const insertPos = Math.min(pos, view.state.doc.length)
    const cjk = countCjk(text)
    view.dispatch({
      changes: { from: insertPos, insert: text },
      selection: { anchor: insertPos + text.length },
      annotations: aiWrite.of(true)
    })
    if (cjk > 0) {
      aiDeltaRef.current += cjk
      setWordStats((s) => ({ ...s, ai: s.ai + cjk }))
    }
    setContent(view.state.doc.toString())
    updateSelectionInfo()
  }

  /** 人工输入/粘贴统计（CodeMirror onUpdate；流式生成期间跳过——AI 字数已在 onDelta 累计） */
  const trackHumanWords = (update: {
    docChanged: boolean
    transactions: Array<{ annotation: (a: AnnotationType<boolean>) => boolean | undefined }>
    changes: { inserted?: string }
  }): void => {
    if (!update.docChanged || streamingRef.current) return
    const isAi = update.transactions.some((t) => t.annotation(aiWrite))
    if (isAi) return
    const inserted = update.changes.inserted ?? ''
    const cjk = countCjk(inserted)
    if (cjk > 0) {
      humanDeltaRef.current += cjk
      setWordStats((s) => ({ ...s, human: s.human + cjk }))
    }
  }

  // 光标续写：Cmd/Ctrl+J → 建议浮层 → Tab 插入 / Esc 关闭
  const [suggestion, setSuggestion] = useState<{ text: string; pos: number } | null>(null)
  const [sugBusy, setSugBusy] = useState(false)
  // v0.21.0（审查 N2）：续写请求 abort 控制（切章/unmount/新请求时取消 + seq 校验防跨章串内容）
  const sugAbortRef = useRef<AbortController | null>(null)
  const sugSeqRef = useRef(0)
  const suggestContinue = async (): Promise<void> => {
    const view = editorRef.current?.view
    if (!view || !selectedChapter || sugBusy || streaming) return
    sugAbortRef.current?.abort()
    const seq = ++sugSeqRef.current
    const ctrl = new AbortController()
    sugAbortRef.current = ctrl
    const capturedChapter = selectedChapter
    const pos = view.state.selection.main.head
    setSugBusy(true)
    setActionError(null)
    try {
      const r = await novelApi.aiAction(id, capturedChapter, { action: 'continue', cursorPosition: pos }, ctrl.signal)
      if (seq !== sugSeqRef.current || selectedChapterRef.current !== capturedChapter) return
      setSuggestion({ text: r.content, pos: r.appliedAt ?? pos })
    } catch (err) {
      if (ctrl.signal.aborted) return
      if (seq === sugSeqRef.current) setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === sugSeqRef.current) setSugBusy(false)
    }
  }
  const acceptSuggestion = (): void => {
    if (!suggestion) return
    insertAi(suggestion.text, suggestion.pos)
    setSuggestion(null)
  }

  const chapters = useQuery({
    queryKey: ['chapters', id],
    queryFn: () => novelApi.chapters(id)
  })
  // v0.24.4（A2）：快捷词词典（编辑器 ";" 补全）——设置页维护，60s 缓存
  const writingSettings = useQuery({
    queryKey: ['writing-settings'],
    queryFn: () => apiFetch('/settings/writing') as Promise<{ quickWords?: Record<string, string> }>,
    staleTime: 60_000
  })
  const quickWords = writingSettings.data?.quickWords ?? {}
  // v0.25.0（审查 L1）：memo 化——此前 `?? []` 每次渲染都产生新数组引用，
  // 导致依赖 list 的 useMemo（chapterStats）与 useEffect（初始选中）每渲染都重跑
  // （ESLint react-hooks/exhaustive-deps 已告警 2 处）
  const list = useMemo(() => chapters.data?.chapters ?? [], [chapters.data])
  const chapter = list.find((c) => c.id === selectedChapter)
  // v0.24.2（F1）：阅读视图上一章/下一章定位
  const chapterIdx = list.findIndex((c) => c.id === selectedChapter)
  // v0.22.2：正文进度轻提示（剩余/失败章——"点进来不知道该干嘛"的场景引导）
  const chapterStats = useMemo(() => {
    const written = list.filter((c) => c.status === 'written' || c.status === 'reviewed' || c.status === 'done').length
    const failed = list.filter((c) => c.status === 'failed').length
    return { total: list.length, written, failed, remaining: Math.max(0, list.length - written) }
  }, [list])
  // v0.19.0：字数分离展示（服务端累计 + 会话增量）
  const statsShow = chapter
    ? { ai: (chapter.aiWords ?? 0) + wordStats.ai, human: (chapter.humanWords ?? 0) + wordStats.human }
    : { ai: wordStats.ai, human: wordStats.human }

  useEffect(() => {
    if (!selectedChapter && list.length > 0) {
      const first = list.find((c) => c.status === 'planned') ?? list[0]
      setSelectedChapter(first.id)
      // v0.21.0（审查 N2）：初始选中同步 ref
      selectedChapterRef.current = first.id
    }
  }, [list, selectedChapter])

  // P2.2 🟢14：组件卸载时中止生成流（防止继续 setState + 浪费额度）
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // P9 C6：关闭/刷新前若有未保存内容则提示
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (dirtyRef.current && !streamingRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // P9 D16：Esc 关闭浮动面板（版本历史/待确认/上下文/资源详情）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setShowVersions(false)
      setShowPending(false)
      setCtxSections(null)
      setResourceDetail(null)
      // v0.17.0（审查 A3）：提示文案写了「Esc 退出」，此前 Esc 并不退出专注模式
      setFocusMode(false)
      // v0.19.0：Esc 关闭续写建议
      setSuggestion(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // v0.19.0：Cmd/Ctrl+J 光标续写；Tab 接受建议（编辑器聚焦时）
  // v0.21.0（审查 N3）：Tab 仅在编辑器内且有建议时 preventDefault + 插入（不再全局吞 Tab/焦点移动）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        void latestActionsRef.current?.suggestContinue()
        return
      }
      if (e.key === 'Tab') {
        const editorEl = document.querySelector('.cm-editor')
        if (editorEl && editorEl.contains(document.activeElement) && latestActionsRef.current?.hasSuggestion()) {
          e.preventDefault()
          latestActionsRef.current.acceptSuggestion()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['chapters', id] })
  }

  // A2：Ctrl+S 保存（CodeMirror keymap）+ P22-C4 快捷键（生成/审核/回灌）
  useEffect(() => {
    // v0.17.0（审查 A5）：依赖从 [selectedChapter, content] 改为 []——此前每按一次键都拆装监听；
    // 回调经 latestActionsRef 恒取最新版闭包（不依赖 effect 重注册）
    const l = latestActionsRef
    const unsubs = [
      onShortcut('save', () => void l.current?.saveContent().catch(() => undefined)),
      onShortcut('generate', () => void l.current?.generate()),
      onShortcut('review', () => void l.current?.withBusy('review', () => void l.current?.runReview())),
      onShortcut('backfill', () => void l.current?.withBusy('backfill', () => void l.current?.backfill())),
      onShortcut('focus-mode', () => setFocusMode((v) => !v))
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  // A2：失焦自动保存（P9 A6：生成/正文加载中挂起，避免与流式竞态）
  useEffect(() => {
    const editorEl = document.querySelector('.cm-editor')
    if (!editorEl) return
    const onBlur = (): void => {
      if (streamingRef.current || contentLoadingRef.current) return
      void saveContent({ silent: true }).catch(() => undefined)
    }
    editorEl.addEventListener('blur', onBlur)
    return () => editorEl.removeEventListener('blur', onBlur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChapter, content])

  // P20（U3）：定时自动保存（30s 防抖；生成/加载中挂起；cleanup 时清定时器）
  useEffect(() => {
    const timer = setInterval(() => {
      if (dirtyRef.current && !streamingRef.current && !contentLoadingRef.current) {
        void saveContent({ silent: true }).catch(() => undefined)
      }
    }, 30_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChapter])

  const saveContent = async (opts?: { silent?: boolean; force?: boolean }): Promise<void> => {
    if (!selectedChapter) return
    if (contentLoadingRef.current || streamingRef.current) return
    const view = editorRef.current?.view
    const text = view ? view.state.doc.toString() : content
    setContent(text)
    // P9 A1：空内容保护——服务端已有正文时禁止空覆盖、禁止置 written
    if (!text.trim()) {
      const hasSaved = loadedChapterRef.current === selectedChapter && savedContentRef.current.trim().length > 0
      if (hasSaved && !opts?.force) {
        dirtyRef.current = false
        if (!opts?.silent) {
          setActionMsg('内容为空，跳过保存')
          setTimeout(() => setActionMsg(null), 2000)
        }
        return
      }
    }
    // 脏检查：与已保存内容一致则不请求
    if (
      !opts?.force &&
      loadedChapterRef.current === selectedChapter &&
      text === savedContentRef.current
    ) {
      dirtyRef.current = false
      return
    }
    setSaving(true)
    try {
      const patch: Record<string, unknown> = { content: text }
      if (text.trim()) patch.status = 'written'
      // v0.19.0：字数分离增量上报（累计后清零；0 增量不发）
      const aiD = aiDeltaRef.current
      const humanD = humanDeltaRef.current
      if (aiD > 0) {
        patch.aiWordsDelta = aiD
        aiDeltaRef.current = 0
      }
      if (humanD > 0) {
        patch.humanWordsDelta = humanD
        humanDeltaRef.current = 0
      }
      await novelApi.chapterPatch(id, selectedChapter, patch)
      savedContentRef.current = text
      dirtyRef.current = false
      await invalidate()
      if (!opts?.silent) {
        setActionMsg('已保存')
        setTimeout(() => setActionMsg(null), 2000)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setActionError(`保存失败：${msg}`)
      toast('error', `保存失败：${msg}`)
      throw err
    } finally {
      setSaving(false)
    }
  }

  const generate = async (): Promise<void> => {
    if (!selectedChapter) return
    if (generateBusyRef.current) return
    const view = editorRef.current?.view
    const current = view ? view.state.doc.toString() : content
    // v0.22.0（审查 ALOW）：themed confirm 统一（未保存 + 成本合并一次确认）
    const est = estimateCost(current, 4096)
    const unsaved = current.trim() && current !== savedContentRef.current
    confirmFn({
      title: '生成正文',
      message: (unsaved ? '当前章节有未保存内容，重新生成将丢弃它。\n\n' : '') + `将生成正文（输出预算约 4096 tokens）。输入上下文估算 ${est.tokens.toLocaleString()} tokens，预计${fmtCost(est.cost)}。`,
      confirmText: '生成',
      action: () => void generateContinue(current)
    })
    return
  }

  // v0.22.0：确认后的生成主体（拆出：themed confirm 为异步触发；原 generate 主体逻辑不变）
  const generateContinue = async (current: string): Promise<void> => {
    if (!selectedChapter) return
    const prevContent = current
    generateBusyRef.current = true
    streamingRef.current = true
    setStreaming(true)
    setStreamStat(null)
    setActionError(null)
    setContent('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await generateChapterSse(
        id,
        selectedChapter,
        {
          onDelta: (text) => {
            // P20（U6）：rAF 合并——每帧只触发一次 setState + 统计（避免高频 delta 全页重渲染）
            pendingDeltaRef.current += text
            if (rAFRef.current !== null) return
            rAFRef.current = requestAnimationFrame(() => {
              rAFRef.current = null
              const batch = pendingDeltaRef.current
              pendingDeltaRef.current = ''
              setContent((prev) => prev + batch)
              // v0.21.0（审查 N1）：生成路径改由服务端记账（ai_words += wordCount）——
              // 此前 onDelta 本地累计会在保存时与服务端计数双计；选区 AI 操作仍走本地 delta
              const total = (editorRef.current?.view?.state.doc.toString() ?? '').length
              // v0.9.0（审查 C）：token 估算传正文文本本身——此前传"字数"的字符串（如 "12345" 数成 5 tokens）
              const t = estimateTokens(editorRef.current?.view?.state.doc.toString() ?? '')
              // v0.17.0（审查 A27）：删除死代码 `void pending`
              setStreamStat(`已生成 ${total.toLocaleString()} 字 · 约 ${t.toLocaleString()} tokens · ${fmtCost(estimateCost('', t).cost)}`)
            })
          },
          onDone: async (payload) => {
            // 批1-#3：内容已全量落定——清缓冲防重复追加
            if (rAFRef.current !== null) {
              cancelAnimationFrame(rAFRef.current)
              rAFRef.current = null
            }
            pendingDeltaRef.current = ''
            contentSettledRef.current = true
            setContent(payload.content)
            savedContentRef.current = payload.content
            dirtyRef.current = false
            setStreamStat(null)
            setActionMsg(`生成完成：${payload.wordCount} 字，缓存命中 ${payload.usage.cacheHit ?? 0}`)
            await invalidate()
            setStreaming(false)
            abortRef.current = null
          },
          onAborted: async (payload) => {
            if (rAFRef.current !== null) {
              cancelAnimationFrame(rAFRef.current)
              rAFRef.current = null
            }
            pendingDeltaRef.current = ''
            contentSettledRef.current = true
            setContent(payload.content)
            savedContentRef.current = payload.content
            dirtyRef.current = false
            setStreamStat(null)
            setActionMsg(`已中止，保留已生成 ${payload.wordCount} 字`)
            await invalidate()
            setStreaming(false)
            abortRef.current = null
          },
          onError: (message) => {
            // P9 A3：失败恢复生成前的内容（残留增量一并丢弃）
            if (rAFRef.current !== null) {
              cancelAnimationFrame(rAFRef.current)
              rAFRef.current = null
            }
            pendingDeltaRef.current = ''
            contentSettledRef.current = true
            if (prevContent) setContent(prevContent)
            setStreamStat(null)
            setActionError(message)
            setStreaming(false)
            abortRef.current = null
          },
          // P20（D1）：context 事件接入——预算/缓存诊断显示
          onContext: (payload) => {
            const p = payload as { budgetUsed?: number; budgetLimit?: number; frozenHash?: string }
            setStreamStat(
              `上下文 ${((p.budgetUsed ?? 0) / 1000).toFixed(1)}k / ${((p.budgetLimit ?? 0) / 1000).toFixed(1)}k tokens · 冻结 ${String(p.frozenHash ?? '').slice(0, 8)}`
            )
          }
        },
        controller.signal,
        buildInclude(),
        guidanceDraft.trim() || undefined
      )
    } catch {
      /* 异常路径已由 handlers 处理 */
    } finally {
      generateBusyRef.current = false
      streamingRef.current = false
      setStreaming(false)
      abortRef.current = null
      // 批1-#3（v0.7.2）：仅当无终端 handler 落定内容时才 flush rAF 缓冲（防尾段重复追加）
      if (!contentSettledRef.current && pendingDeltaRef.current) {
        const tail = pendingDeltaRef.current
        pendingDeltaRef.current = ''
        setContent((prev) => prev + tail)
      }
      contentSettledRef.current = false
    }
  }

  // P21-3：方案流水线（跑在章节上）
  const solutionsForRun = useQuery({ queryKey: ['studio-solutions', 'run'], queryFn: studioApi.solutions })
  const [solutionId, setSolutionId] = useState<number | null>(null)
  const [solutionRunSummary, setSolutionRunSummary] = useState<string | null>(null)
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
      setActionMsg(`方案生产完成：${r.wordCount ?? 0} 字${r.degraded ? '（部分步骤降级）' : ''}`)
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
      setActionMsg(`方案完成${r.run.degraded ? '（部分降级）' : ''}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const cancelGenerate = (): void => {
    abortRef.current?.abort()
  }

  // P9 B1：per-action busy 锁（防重复提交）
  const withBusy = async (key: string, fn: () => Promise<void> | void): Promise<void> => {
    // v0.17.0（审查 A2）：ref 守卫替代 state——双击同一帧内两次调用此前都能通过 `if (actionBusy)` 检查
    if (actionBusyRef.current) return
    actionBusyRef.current = key
    setActionBusy(key)
    try {
      await fn()
    } finally {
      actionBusyRef.current = null
      setActionBusy(null)
    }
  }

  const runReview = async (): Promise<void> => {    if (!selectedChapter) return
    setActionError(null)
    setActionMsg('审核中…')
    try {
      const r = await novelApi.review(id, selectedChapter)
      setReviewResult(r.review)
      const score = r.review.score as number
      setActionMsg(`审核完成：${score} 分${(r.review.needsFix as boolean) ? '，需要修复' : ''}`)
      await invalidate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  // v0.24.4（A4）：轻量本地校对（确定性检查 + 单次语义 extraction，可选传当前编辑器内容）
  const [proofreadIssues, setProofreadIssues] = useState<ProofreadIssue[] | null>(null)
  const runProofread = async (): Promise<void> => {
    if (!selectedChapter) return
    setActionError(null)
    setProofreadIssues(null)
    try {
      const r = await novelApi.proofread(id, selectedChapter, content || undefined)
      setProofreadIssues(r.issues)
      setActionMsg(`校对完成：${r.issues.length} 条${r.localCount > 0 ? `（${r.localCount} 条本地确定性问题）` : ''}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const fix = async (): Promise<void> => {
    if (!selectedChapter) return
    setActionError(null)
    setActionMsg('修复中…')
    try {
      const r = await novelApi.fix(id, selectedChapter)
      setContent(r.content)
      savedContentRef.current = r.content
      dirtyRef.current = false
      fixDoneRef.current = true
      if (r.rescore) {
        setReviewResult({ score: r.rescore.score, needsFix: r.rescore.needsFix } as Record<string, unknown>)
        setActionMsg(
          `修复完成（第 ${r.round} 轮），重审评分 ${r.rescore.score}${r.rescore.passed ? '，已达标 ✓' : '，未达标（建议人工修改）'}`
        )
      } else {
        setActionMsg(`修复完成（第 ${r.round} 轮）`)
      }
      await invalidate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const backfill = async (): Promise<void> => {
    if (!selectedChapter) return
    setActionError(null)
    setActionMsg('回灌提取中…')
    try {
      const r = await novelApi.backfill(id, selectedChapter)
      setBackfillResult(r)
      setActionMsg('回灌完成：角色状态 / 新事实 / 伏笔已进入待确认区')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  // v0.17.0（审查 A5）：每渲染刷新快捷键闭包缓存（effect 固定注册仍取最新实现）
  useEffect(() => {
    latestActionsRef.current = {
    saveContent,
    generate,
    withBusy,
    runReview,
    backfill,
    suggestContinue,
    acceptSuggestion,
    hasSuggestion: () => suggestion !== null
  }
  })

  const loadPending = async (): Promise<void> => {
    try {
      const r = await novelApi.pending(id)
      setPending(r)
      setShowPending(true)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  // v0.20.0：记忆面（角色状态/势力状态/待确认事实——显式查看与手动修正）
  const [memory, setMemory] = useState<MemoryData | null>(null)
  const [showMemory, setShowMemory] = useState(false)
  const [memoryBusy, setMemoryBusy] = useState(false)
  const loadMemory = async (): Promise<void> => {
    setMemoryBusy(true)
    try {
      const r = await novelApi.memory(id)
      setMemory(r)
      setShowMemory(true)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setMemoryBusy(false)
    }
  }
  // v0.21.0（审查 N4）：记忆面操作 busy 锁（ref 防连点并发 POST）
  const memoryPatchBusyRef = useRef(false)
  const [memoryPatchBusy, setMemoryPatchBusy] = useState(false)
  const patchCharState = async (name: string, state: string, remove: boolean): Promise<void> => {
    if (memoryPatchBusyRef.current) return
    memoryPatchBusyRef.current = true
    setMemoryPatchBusy(true)
    try {
      await novelApi.memoryCharacter(id, { name, state, remove })
      await loadMemory()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      memoryPatchBusyRef.current = false
      setMemoryPatchBusy(false)
    }
  }
  const patchFactionState = async (name: string, state: string): Promise<void> => {
    if (memoryPatchBusyRef.current) return
    memoryPatchBusyRef.current = true
    setMemoryPatchBusy(true)
    try {
      await novelApi.memoryFaction(id, { name, state })
      await loadMemory()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      memoryPatchBusyRef.current = false
      setMemoryPatchBusy(false)
    }
  }

  // A3：版本历史
  const loadVersions = async (): Promise<void> => {
    if (!selectedChapter) return
    try {
      const r = await novelApi.versions(id, selectedChapter)
      setVersions(r.versions)
      setShowVersions(true)
      setVersionDiff(null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const snapshotNow = async (): Promise<void> => {
    if (!selectedChapter) return
    try {
      await novelApi.createVersion(id, selectedChapter, '手动快照')
      setActionMsg('已创建版本快照')
      await loadVersions()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  // B1：加载上下文预览
  const loadContextPreview = async (): Promise<void> => {
    if (!selectedChapter) return
    try {
      const r = await novelApi.contextPreview(id, selectedChapter)
      setCtxSections(r.sections)
      setCtxToggles((prev) => {
        if (prev) return prev
        const init: Record<string, boolean> = {}
        for (const s of r.sections) init[s.key] = true
        return init
      })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  // B1：生成时带 include（勾选过滤）
  const buildInclude = (): string[] | undefined => {
    if (!ctxToggles) return undefined
    const enabled = Object.entries(ctxToggles)
      .filter(([, v]) => v)
      .map(([k]) => k)
    return enabled.length > 0 ? enabled : undefined
  }

  const confirmStates = async (): Promise<void> => {
    if (!backfillResult || !Array.isArray(backfillResult.characterStates)) return
    await withBusy('confirm', async () => {
      await novelApi.confirmState(id, backfillResult.characterStates as Array<{ name: string; state: string }>)
      confirmDoneRef.current = true
      setBackfillResult(null)
      setShowPending(false)
      setActionMsg('角色状态已确认入账')
    })
  }

  // P9 A1：选中章节变化 → 按需加载正文（竞态序号丢弃过期响应）
  useEffect(() => {
    if (!selectedChapter) return
    const seq = ++detailSeqRef.current
    contentLoadingRef.current = true
    setContentLoading(true)
    setContent('')
    loadedChapterRef.current = null
    savedContentRef.current = ''
    dirtyRef.current = false
    // v0.19.0：切换章节重置会话字数统计与续写建议
    aiDeltaRef.current = 0
    humanDeltaRef.current = 0
    setWordStats({ ai: 0, human: 0 })
    setSuggestion(null)
    // v0.24.2（F3）：切章重置版本 diff
    setVersionDiff(null)
    void novelApi
      .chapterDetail(id, selectedChapter)
      .then((d) => {
        if (seq !== detailSeqRef.current) return
        setContent(d.chapter.content ?? '')
        savedContentRef.current = d.chapter.content ?? ''
        loadedChapterRef.current = selectedChapter
      })
      .catch((err) => {
        if (seq !== detailSeqRef.current) return
        setActionError(`正文加载失败：${err instanceof Error ? err.message : String(err)}（重新选择章节可重试）`)
      })
      .finally(() => {
        if (seq === detailSeqRef.current) {
          contentLoadingRef.current = false
          setContentLoading(false)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChapter])

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
      setActionError('保存失败，已中断切换，请重试')
      return
    }
    setSelectedChapter(chapterId)
    // v0.21.0（审查 N2）：同步 ref + 中止在途续写请求 + seq 失效
    selectedChapterRef.current = chapterId
    sugAbortRef.current?.abort()
    sugSeqRef.current++
    setSuggestion(null)
    setReviewResult(null)
    setBackfillResult(null)
    setActionError(null)
  }

  // P9 B8：标题保存（由 ChapterToolbar 提交时调用；编辑态由工具条自持）
  const saveTitle = async (t: string): Promise<void> => {
    if (!selectedChapter || t === chapter?.title) return
    try {
      await novelApi.chapterPatch(id, selectedChapter, { title: t })
      await invalidate()
      setActionMsg('标题已更新')
      setTimeout(() => setActionMsg(null), 2000)
    } catch (err) {
      toast('error', `标题保存失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const exportLink = (format: 'txt' | 'md' | 'epub' | 'docx'): string => novelApi.exportUrl(id, format)

  // P9 B7：导出改为 fetch 下载（校验响应，成功/失败真实反馈）
  const [exportBusy, setExportBusy] = useState<string | null>(null)
  const exportChapter = async (format: 'txt' | 'md' | 'epub' | 'docx'): Promise<void> => {
    if (exportBusy) return
    setExportBusy(format)
    try {
      const res = await fetch(exportLink(format), { headers: authHeaders() })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${chapter?.title ?? `chapter-${id}`}.${format}`
      a.click()
      URL.revokeObjectURL(a.href)
      toast('ok', `已导出 ${format.toUpperCase()}`)
    } catch (err) {
      toast('error', `导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExportBusy(null)
    }
  }

  // P12 A3：本章进度矩阵信号（从现有状态推导，不新增请求）
  const progressSegments = useMemo<Array<[string, boolean]>>(() => {
    const taskReady = Boolean(chapter?.goal && Object.keys(chapter.goal).length > 0)
    const contextReady = ctxSections !== null
    const draftStarted = content.trim().length > 0
    const draftSaved =
      ['written', 'reviewed', 'done'].includes(chapter?.status ?? '') ||
      savedContentRef.current.trim().length > 0
    const reviewed = reviewResult !== null || ['reviewed', 'done'].includes(chapter?.status ?? '')
    const reviewable = ['reviewed', 'done'].includes(chapter?.status ?? '')
    return [
      ['任务单', taskReady],
      ['上下文', contextReady],
      ['草稿', draftStarted],
      ['保存', draftSaved],
      ['审核', reviewed],
      ['修复', fixDoneRef.current],
      ['回灌', backfillDoneRef.current || reviewResult !== null],
      ['快照', snapshotDoneRef.current],
      ['可审', reviewable]
    ]
  }, [chapter, ctxSections, content, reviewResult])

  // v0.15.0：反馈沉淀——把引导句固定为书级硬约束（导演/方案/生成/修复全链生效）
  const pinGuidance = (): void => {
    const t = guidanceDraft.trim()
    if (!t) return
    void (async () => {
      const d = await novelApi.detail(id)
      const cur = d.novel.constraints ?? []
      const next = cur.filter((c) => c.text !== t)
      const canon = extractProtagonistName(t)
      next.push({
        // v0.23.1（批次 B6）：约束 id 补随机后缀（同毫秒多次固定不撞 id）
        id: `c${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: t,
        level: 'must' as const,
        enabled: true,
        createdAt: new Date().toISOString(),
        ...(canon ? { keyword: canon, replaceWith: canon } : {})
      })
      await novelApi.patch(id, { constraints: next })
      setGuidanceDraft('')
    })().catch(() => undefined)
  }

  // A3：版本历史动作（数据操作留在本页，呈现交给 VersionHistoryPanel）
  const versionActions: VersionActions = {
    view: (v) => {
      if (!selectedChapter) return
      void withBusy(`vview-${v.id}`, async () => {
        try {
          const r = await novelApi.chapterVersionDetail(id, selectedChapter, v.id)
          setResourceDetail({ title: `版本 #${v.id}（${v.note} · ${v.createdAt}）`, body: r.version.content })
        } catch (err) {
          setActionError(err instanceof Error ? err.message : String(err))
        }
      })
    },
    restore: (v) => {
      if (!selectedChapter) return
      confirmFn({
        title: '恢复版本',
        message: `恢复为版本 #${v.id}？当前内容会先存入新版本，然后被替换。`,
        confirmText: '恢复',
        danger: true,
        action: () =>
          void withBusy(`vrestore-${v.id}`, async () => {
            try {
              const r = await novelApi.chapterVersionRestore(id, selectedChapter, v.id)
              setContent(r.content)
              savedContentRef.current = r.content
              dirtyRef.current = false
              setActionMsg(`已恢复版本 #${v.id}（${r.wordCount} 字），原内容已存为新版本`)
              await invalidate()
            } catch (err) {
              setActionError(err instanceof Error ? err.message : String(err))
            }
          })
      })
    },
    diff: (v) => {
      if (!selectedChapter) return
      void withBusy(`vdiff-${v.id}`, async () => {
        try {
          const d = await novelApi.chapterVersionDiff(id, selectedChapter, v.id)
          setVersionDiff(d)
        } catch (err) {
          setActionError(err instanceof Error ? err.message : String(err))
        }
      })
    }
  }

  return (
    <>
      {chapterPromptElement}
      {confirmDialog}
      {focusMode && (
        <div style={{ position: 'fixed', top: 8, right: 12, zIndex: 999, fontSize: 11 }} className="muted">
          🖊 专注模式 · Ctrl+Shift+F 退出 · Esc 退出
        </div>
      )}
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
        {/* 左：资源树（v0.25.0：拆至 ResourcePanel，其加载状态不再触发整页重渲染） */}
        <ResourcePanel
          novelId={id}
          hidden={focusMode}
          chapters={list}
          loading={chapters.isLoading}
          error={chapters.isError ? chapters.error : null}
          selectedChapter={selectedChapter}
          onSelectChapter={(cid) => void selectChapter(cid)}
          onShowDetail={setResourceDetail}
          onNewChapter={() => {
            void askChapterTitle({ title: '新章节标题（留空自动编号）', defaultValue: '' }).then((t) => {
              if (t === null) return
              setActionError(null)
              void withBusy('chapter-create', async () => {
                const r = await assetsApi.chapterCreate(id, { title: t.trim() || undefined })
                setActionMsg(`已创建章节 #${r.id}（空章，可编辑标题或直接生成）`)
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
            onPinGuidance={pinGuidance}
            exportBusy={exportBusy}
            onExport={(f: ExportFormat) => void exportChapter(f)}
            onSaveTitle={saveTitle}
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
              suggestion={suggestion}
              sugBusy={sugBusy}
              onAcceptSuggestion={acceptSuggestion}
              onRegenerateSuggestion={() => void suggestContinue()}
              onCloseSuggestion={() => setSuggestion(null)}
              onGenerate={() => void generate()}
              busy={actionBusy !== null}
              editorRef={editorRef}
            />
          )}
          <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)', fontSize: 12 }} className="muted">
            {streamStat && <span style={{ color: 'var(--accent-bright)' }}>{streamStat}</span>}
            {actionMsg && <span style={{ color: 'var(--ok)' }}>{actionMsg}</span>}
            {actionError && <span style={{ color: 'var(--danger)' }}>{actionError}</span>}
          </div>
        </div>

        {/* 右：动作面板（P10：推荐动作卡 + 分区） */}
        <div
          style={{
            width: 320,
            borderLeft: '1px solid var(--border)',
            padding: 12,
            overflowY: 'auto',
            background: 'var(--bg-panel)',
            display: focusMode ? 'none' : undefined
          }}
        >
          <h2 style={{ fontSize: 15, marginBottom: 12 }}>执行面板</h2>

          {/* P12 A3：本章进度矩阵 */}
          {selectedChapter && <ProgressMatrix segments={progressSegments} />}

          {/* 推荐动作卡：当前最该做的事 */}
          <div className="panel" style={{ background: 'var(--bg-card)', padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>当前推荐</div>
            {streaming ? (
              <button className="danger" style={{ width: '100%' }} onClick={cancelGenerate} disabled={actionBusy !== null}>
                取消生成（保留已生成部分）
              </button>
            ) : (
              <button
                className="primary"
                style={{ width: '100%', padding: '10px 14px', fontSize: 14 }}
                onClick={() => void generate()}
                disabled={!selectedChapter || actionBusy !== null || contentLoading}
              >
                {contentLoading ? '正文加载中…' : streaming ? '生成中…' : '✍️ 生成正文'}
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

          {/* 分区：质量与连续性 */}
          <div style={{ fontSize: 12, color: 'var(--text-faint)', margin: '12px 0 6px' }}>质量与连续性</div>
          <div className="col gap-2">
            <button
              onClick={() => void withBusy('review', () => runReview())}
              disabled={actionBusy !== null || !selectedChapter || !content}
            >
              {actionBusy === 'review' ? '审核中…' : 'AI 审核'}
            </button>
            {/* v0.24.4（A4）：轻量本地校对——确定性检查零 token + 单次语义 extraction */}
            <button
              onClick={() => void withBusy('proofread', runProofread)}
              disabled={actionBusy !== null || !selectedChapter || !content}
            >
              {actionBusy === 'proofread' ? '校对中…' : '本地校对'}
            </button>
            {proofreadIssues !== null && (
              <ProofreadPanel issues={proofreadIssues} onClose={() => setProofreadIssues(null)} />
            )}
            {/* P21-3：跑创作方案 + P30：以方案生产正文 */}
            <div className="col gap-2">
              <div className="row gap-2">
                <select
                  style={{ flex: 1, fontSize: 12 }}
                  value={solutionId ?? ''}
                  disabled={actionBusy !== null || !selectedChapter}
                  onChange={(e) => setSolutionId(Number(e.target.value) || null)}
                >
                  <option value="">方案流水线（可选）…</option>
                  {(solutionsForRun.data?.solutions ?? []).map((s) => (
                    <option key={Number(s.id)} value={Number(s.id)}>
                      {String(s.name)}（{Array.isArray(s.steps) ? (s.steps as unknown[]).length : 0} 步）
                    </option>
                  ))}
                </select>
                <button
                  className="sm primary"
                  disabled={actionBusy !== null || !selectedChapter || !content || !solutionId}
                  onClick={() => void withBusy('solution-run', () => runSolutionOnChapter())}
                >
                  {actionBusy === 'solution-run' ? '运行中…' : '跑方案'}
                </button>
                <button
                  className="sm"
                  style={{ color: 'var(--accent-bright)', borderColor: 'var(--accent)' }}
                  disabled={actionBusy !== null || !selectedChapter || content !== '' || !solutionId}
                  title="用方案的章节生产步骤接力生成正文（需空章节）"
                  onClick={() =>
                    confirmFn({
                      title: '方案接力生产',
                      message: '用方案步骤接力生产正文（将替换本章内容）？',
                      confirmText: '生产',
                      danger: true,
                      action: () => void withBusy('solution-produce', () => produceWithSolution())
                    })
                  }
                >
                  {actionBusy === 'solution-produce' ? '流水线生产中…' : '以方案生产正文'}
                </button>
              </div>
              {/* v0.10.0（批B/I2）：质量债自动修复徽标 */}
              <DebtFixBadge novelId={id} />
              {solutionRunSummary && (
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
                  {solutionRunSummary}
                </div>
              )}
            </div>
            <button
              onClick={() => void withBusy('fix', () => fix())}
              disabled={actionBusy !== null || !selectedChapter || !content}
            >
              {actionBusy === 'fix' ? '修复中…' : '修复 + 重审（限 2 轮）'}
            </button>
            <button
              onClick={() => void withBusy('backfill', () => backfill())}
              disabled={actionBusy !== null || !selectedChapter || !content}
            >
              {actionBusy === 'backfill' ? '回灌中…' : '状态回灌提取'}
            </button>
            <button onClick={() => void withBusy('pending', () => loadPending())} disabled={actionBusy !== null}>
              {actionBusy === 'pending' ? '加载中…' : '待确认区'}
            </button>
            {/* v0.20.0：记忆面（状态机显式查看/修正） */}
            <button onClick={() => void loadMemory()} disabled={actionBusy !== null || memoryBusy}>
              {memoryBusy ? '加载中…' : '记忆面'}
            </button>
          </div>

          {/* 分区：快照与上下文 */}
          <div style={{ fontSize: 12, color: 'var(--text-faint)', margin: '12px 0 6px' }}>快照与上下文</div>
          <div className="col gap-2">
            <button
              onClick={() => void withBusy('versions', () => loadVersions())}
              disabled={actionBusy !== null || !selectedChapter}
            >
              {actionBusy === 'versions' ? '加载中…' : '版本历史'}
            </button>
            <button
              onClick={() => void withBusy('snapshot', () => snapshotNow())}
              disabled={actionBusy !== null || !selectedChapter || !content}
            >
              {actionBusy === 'snapshot' ? '快照中…' : '存快照'}
            </button>
            <button
              onClick={() => void withBusy('context', () => loadContextPreview())}
              disabled={actionBusy !== null || !selectedChapter}
            >
              {actionBusy === 'context' ? '加载中…' : '写作上下文'}
            </button>
          </div>

          {reviewResult && (
            <ReviewResultPanel
              review={reviewResult}
              streaming={streaming}
              busy={actionBusy !== null}
              onAdopt={(advice) => {
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
            />
          )}

          {backfillResult && (
            <BackfillResultPanel
              result={backfillResult}
              busy={actionBusy !== null}
              onConfirm={() => void confirmStates()}
            />
          )}

          {showPending && <PendingPanel pending={pending} onClose={() => setShowPending(false)} />}

          {showMemory && (
            <MemoryPanel
              memory={memory}
              patchBusy={memoryPatchBusy}
              onPatchCharState={(name, state, remove) => void patchCharState(name, state, remove)}
              onPatchFactionState={(name, state) => void patchFactionState(name, state)}
              onClose={() => setShowMemory(false)}
            />
          )}

          {showVersions && (
            <VersionHistoryPanel
              versions={versions}
              versionDiff={versionDiff}
              busy={actionBusy !== null}
              streaming={streaming}
              actions={versionActions}
              onClose={() => setShowVersions(false)}
            />
          )}

          {ctxSections && ctxToggles && (
            <ContextPanel
              sections={ctxSections}
              toggles={ctxToggles}
              onToggle={(key) =>
                setCtxToggles((prev) => ({ ...(prev ?? {}), [key]: !(prev?.[key] ?? true) }))
              }
              onClose={() => {
                setCtxSections(null)
                setCtxToggles(null)
              }}
            />
          )}

          {resourceDetail && (
            <ResourceDetailPanel detail={resourceDetail} onClose={() => setResourceDetail(null)} />
          )}

          {/* D2：AI 对话侧栏（折叠） */}
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🤖 AI 对话（对话即创作）</summary>
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
              <HubChat novelId={id} />
            </div>
          </details>
        </div>
      </div>
    </>
  )
}

// P22-C1 章节列表项已拆至 ./chapter/ChapterListItem.tsx（批次 E1）
// v0.25.0（审查 S1）：资源树/编辑器/工具条/审核/记忆面/版本/上下文面板一并拆至 ./chapter/
