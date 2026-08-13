import { useEffect, useRef, useState, useMemo, memo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { Annotation, type AnnotationType } from '@codemirror/state'
import { novelEditorTheme } from '../editor/theme'
import { novelApi, generateChapterSse, styleApi, studioApi, assetsApi, authHeaders, automationApi } from '../api'
import { usePrompt } from '../components/PromptDialog'
import { onShortcut } from '../utils/shortcuts'
import type { ChapterSummary, WorldData } from '../types'
import { SelectionToolbar } from '../editor/SelectionToolbar'
import { HubChat } from '../components/HubChat'
import { useToast } from '../components/Toast'
import { BookOpenText, Users, Map, Scale, Pin, Wand2 } from 'lucide-react'
import { estimateCost, estimateTokens, fmtCost } from '../utils/costEstimate'

// v0.19.0：AI 写入标记（字数分离：区分 AI 插入与人工输入）
const aiWrite = Annotation.define<boolean>()

/** 中文字符计数（字数分离口径：与 word_count 一致） */
function countCjk(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length
}

// v0.15.0：「主角必须叫 Jing」类文本 → 提取规范名
function extractProtagonistNameFromDraft(text: string): string {
  if (!text.includes('主角')) return ''
  const m = text.match(/(?:必须|要|应|请)?(?:叫|是|名为|名)[「"“'（(]*([^\s」"“”'’）)、。，！？!?]{1,12})/)
  return m ? m[1] : ''
}

// v0.20.0：记忆面小组件——角色状态追加（Enter 提交）
function CharStateAdd({ name, onAdd }: { name: string; onAdd: (s: string) => void }): React.JSX.Element {
  const [draft, setDraft] = useState('')
  return (
    <input
      style={{ width: 140, fontSize: 11, padding: '2px 6px' }}
      placeholder={`给 ${name} 加状态…`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && draft.trim()) {
          onAdd(draft.trim())
          setDraft('')
        }
      }}
    />
  )
}

// v0.20.0：记忆面小组件——势力当前状态修正（Enter 保存）
function FactionStateEdit({
  current,
  onSave
}: {
  current: string
  onSave: (s: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  return (
    <input
      style={{ width: 160, fontSize: 11, padding: '2px 6px' }}
      placeholder={current ? `当前：${current}` : '设置势力状态…'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && draft.trim()) {
          onSave(draft.trim())
          setDraft('')
        }
      }}
    />
  )
}

// v0.10.0（批B/I2）：质量债待修复徽标——整本生产后自动修复队列的显性入口
// 用户必须"看得明白"：徽标显示待修复章节数，点击后任务入队（任务中心可见），修复上限由服务端保证
function DebtFixBadge({ novelId }: { novelId: number }): React.JSX.Element | null {
  const { toast } = useToast()
  const [fixing, setFixing] = useState(false)
  const debts = useQuery<{ pendingDebts: number }>({
    queryKey: ['debts', novelId],
    queryFn: () => automationApi.debts(novelId),
    refetchInterval: 30_000
  })
  const pending = debts.data?.pendingDebts ?? 0
  if (pending === 0) return null
  return (
    <div
      className="row"
      style={{
        gap: 8,
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 'var(--radius)',
        background: 'rgba(255,193,7,.08)',
        border: '1px solid rgba(255,193,7,.3)',
        fontSize: 12
      }}
    >
      <span style={{ color: 'var(--warn)' }}>⚙ 待自动修复 {pending} 章（评分低于 75 的章节）</span>
      <button
        className="sm"
        disabled={fixing}
        onClick={() => {
          setFixing(true)
          void automationApi
            .debtsFix(novelId)
            .then(() => {
              toast('ok', '自动修复任务已入队（任务中心可查看进度）')
              void debts.refetch()
            })
            .catch((err) => toast('error', err instanceof Error ? err.message : String(err)))
            .finally(() => setFixing(false))
        }}
      >
        {fixing ? '排队中…' : '立即修复'}
      </button>
    </div>
  )
}

export function ChapterExecutionPage(): React.JSX.Element {
  const { novelId } = useParams()
  const { toast } = useToast()
  const navigate = useNavigate()
  const id = Number(novelId)
  const queryClient = useQueryClient()
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null)
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
  const [pending, setPending] = useState<{ pendingFacts: Array<{ id: number; content: string }>; pendingCharacters: Array<{ id: number; name: string; profile: Record<string, string> }> } | null>(null)
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
  // A1：选区/光标状态（ref 缓存防 onUpdate 无限重渲染）
  const [selectionInfo, setSelectionInfo] = useState<{ text: string; cursor: number }>({ text: '', cursor: -1 })
  const selectionRef = useRef({ text: '', cursor: -1 })
  // A2：标题内联编辑
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleSubmittedRef = useRef(false)
  // A3：版本历史
  const [versions, setVersions] = useState<Array<{ id: number; note: string; createdAt: string; wordCount: number; preview: string }> | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  // B1：写作上下文可视化
  const [ctxSections, setCtxSections] = useState<Array<{ key: string; label: string; chars: number; tokens: number }> | null>(null)
  const [ctxToggles, setCtxToggles] = useState<Record<string, boolean> | null>(null)
  // D1：左栏资源树（章节/角色/设定/规则 分组）
  const [resourceTab, setResourceTab] = useState<'chapters' | 'characters' | 'world' | 'rules'>('chapters')
  const [resourceChars, setResourceChars] = useState<Array<{ id: number; name: string; status: string; profile: Record<string, unknown> }> | null>(null)
  const [resourceWorld, setResourceWorld] = useState<WorldData | null>(null)
  const [resourceRules, setResourceRules] = useState<Array<{ id: number; name: string; features: Array<Record<string, unknown>> }> | null>(null)
  const [resourceDetail, setResourceDetail] = useState<{ title: string; body: string } | null>(null)
  const [resourceLoading, setResourceLoading] = useState(false)
  const [resourceError, setResourceError] = useState<string | null>(null)

  // D1：加载资源（角色/设定/规则）（P9 B5：loading + 错误 + 重试三态）
  const loadResourceTab = async (tab: 'chapters' | 'characters' | 'world' | 'rules'): Promise<void> => {
    setResourceTab(tab)
    setResourceDetail(null)
    setResourceError(null)
    try {
      if (tab === 'characters' && !resourceChars) {
        setResourceLoading(true)
        const r = await novelApi.characters(id)
        setResourceChars(r.characters)
      } else if (tab === 'world' && !resourceWorld) {
        setResourceLoading(true)
        const r = await novelApi.world(id)
        // v0.17.0（审查 A29）：消除 `as unknown as Record` 双转型——状态直接持 WorldData 类型
        setResourceWorld(r.world)
      } else if (tab === 'rules' && !resourceRules) {
        setResourceLoading(true)
        const r = await styleApi.list(id)
        setResourceRules(r.assets)
      }
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : String(err))
    } finally {
      setResourceLoading(false)
    }
  }

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
  const suggestContinue = async (): Promise<void> => {
    const view = editorRef.current?.view
    if (!view || !selectedChapter || sugBusy || streaming) return
    const pos = view.state.selection.main.head
    setSugBusy(true)
    setActionError(null)
    try {
      const r = await novelApi.aiAction(id, selectedChapter, { action: 'continue', cursorPosition: pos })
      setSuggestion({ text: r.content, pos: r.appliedAt ?? pos })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setSugBusy(false)
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
  const list = chapters.data?.chapters ?? []
  const chapter = list.find((c) => c.id === selectedChapter)
  // v0.19.0：字数分离展示（服务端累计 + 会话增量）
  const statsShow = chapter
    ? { ai: (chapter.aiWords ?? 0) + wordStats.ai, human: (chapter.humanWords ?? 0) + wordStats.human }
    : { ai: wordStats.ai, human: wordStats.human }

  useEffect(() => {
    if (!selectedChapter && list.length > 0) {
      const first = list.find((c) => c.status === 'planned') ?? list[0]
      setSelectedChapter(first.id)
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        void latestActionsRef.current?.suggestContinue()
        return
      }
      if (e.key === 'Tab') {
        latestActionsRef.current?.acceptSuggestion()
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
    // P9 A3：有未保存内容时二次确认（生成会清空编辑器）
    if (current.trim() && current !== savedContentRef.current) {
      if (!window.confirm('当前章节有未保存内容，重新生成将丢弃它。继续？')) return
    }
    // P12 D1：生成前成本确认（防误触额度）
    const est = estimateCost(current, 4096)
    if (!window.confirm(`将生成正文（输出预算约 4096 tokens）。输入上下文估算 ${est.tokens.toLocaleString()} tokens，预计${fmtCost(est.cost)}。继续？`)) {
      return
    }
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
              // v0.19.0：流式生成计入 AI 字数
              const cjk = countCjk(batch)
              if (cjk > 0) {
                aiDeltaRef.current += cjk
                setWordStats((s) => ({ ...s, ai: s.ai + cjk }))
              }
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
    if (!window.confirm('用方案步骤接力生产正文（将替换本章内容）？')) return
    setActionError(null)
    setSolutionRunSummary(null)
    // v0.17.0（审查 A4）：此前无 try/catch——失败时异常穿透 withBusy 的 finally，按钮卡在 busy 态
    try {
      const r = await studioApi.solutionProduceChapter(solutionId, id, selectedChapter)
      setContent(r.content)
      savedContentRef.current = r.content
      dirtyRef.current = false
      setActionMsg(`方案生产完成：${r.wordCount} 字${r.degraded ? '（部分步骤降级）' : ''}`)
      setSolutionRunSummary(r.outputs.map((o, i) => `${i + 1}.${o.role}${o.ok ? '' : ' ✗'}`).join(' | '))
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

  const runReview = async (): Promise<void> => {
    if (!selectedChapter) return
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
    latestActionsRef.current = { saveContent, generate, withBusy, runReview, backfill, suggestContinue, acceptSuggestion }
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
  const [memory, setMemory] = useState<{
    characters: Array<{ name: string; states: string[] }>
    factions: Array<{ name: string; currentState: string }>
    pendingFacts: Array<{ id: number; content: string }>
  } | null>(null)
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
  const patchCharState = async (name: string, state: string, remove: boolean): Promise<void> => {
    try {
      await novelApi.memoryCharacter(id, { name, state, remove })
      await loadMemory()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }
  const patchFactionState = async (name: string, state: string): Promise<void> => {
    try {
      await novelApi.memoryFaction(id, { name, state })
      await loadMemory()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  // A3：版本历史
  const loadVersions = async (): Promise<void> => {
    if (!selectedChapter) return
    try {
      const r = await novelApi.versions(id, selectedChapter)
      setVersions(r.versions)
      setShowVersions(true)
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
    setReviewResult(null)
    setBackfillResult(null)
    setActionError(null)
  }

  // P9 B8：标题内联保存（单一提交入口 + 失败提示）
  const saveTitle = (): void => {
    const t = titleDraft.trim()
    if (!t || !selectedChapter || t === chapter?.title) {
      setEditingTitle(false)
      return
    }
    void novelApi
      .chapterPatch(id, selectedChapter, { title: t })
      .then(() => invalidate())
      .then(() => {
        setActionMsg('标题已更新')
        setTimeout(() => setActionMsg(null), 2000)
      })
      .catch((err) => {
        toast('error', `标题保存失败：${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setEditingTitle(false))
  }

  const exportLink = (format: 'txt' | 'md' | 'epub'): string => novelApi.exportUrl(id, format)

  // P9 B7：导出改为 fetch 下载（校验响应，成功/失败真实反馈）
  const [exportBusy, setExportBusy] = useState<string | null>(null)
  const exportChapter = async (format: 'txt' | 'md' | 'epub'): Promise<void> => {
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

  return (
    <>
      {chapterPromptElement}
      {focusMode && (
        <div style={{ position: 'fixed', top: 8, right: 12, zIndex: 999, fontSize: 11 }} className="muted">
          🖊 专注模式 · Ctrl+Shift+F 退出 · Esc 退出
        </div>
      )}
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 左：资源树（D1：章节/角色/设定/规则 分组） */}
      <div style={{ width: 260, borderRight: '1px solid var(--border)', padding: 12, overflowY: 'auto', background: 'var(--bg-panel)', display: focusMode ? 'none' : undefined }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {(
              [
                ['chapters', '章节', BookOpenText],
                ['characters', '角色', Users],
                ['world', '设定', Map],
                ['rules', '规则', Scale]
              ] as Array<['chapters' | 'characters' | 'world' | 'rules', string, typeof BookOpenText]>
            ).map(([k, label, Icon]) => (
              <button
                key={k}
                className={`nav-tab${resourceTab === k ? ' active' : ''}`}
                onClick={() => void loadResourceTab(k)}
              >
                <Icon size={12} className="icon-gap" />
                {label}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 4 }}>
            {/* P23（N2）：手动新建章节 */}
            <button
              className="sm"
              title="手动新建空章节（可改标题后生成正文）"
              onClick={() => {
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
            >
              + 章节
            </button>
            <button className="sm" onClick={() => navigate(`/novels/${id}`)}>
              工作台
            </button>
          </div>
        </div>

        {resourceTab === 'chapters' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {list.map((c) => (
              // P22-C1：memo 化列表项（100+ 章时避免整列表重渲染）
              <ChapterListItem
                key={c.id}
                c={c}
                selected={selectedChapter === c.id}
                onSelect={() => void selectChapter(c.id)}
              />
            ))}
            {chapters.isLoading && <p className="muted t-small">加载中…</p>}
            {chapters.isError && (
              <p className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
                加载失败：{String(chapters.error)}
              </p>
            )}
            {!chapters.isLoading && !chapters.isError && list.length === 0 && (
              <p className="muted t-small">还没有章节，请先在工作台生成章节清单。</p>
            )}
          </div>
        )}

        {resourceTab === 'characters' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {resourceLoading && <p className="muted t-small">加载中…</p>}
            {resourceError && (
              <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
                加载失败：{resourceError}
                <button className="sm ml-2" onClick={() => void loadResourceTab('characters')}>重试</button>
              </div>
            )}
            {resourceChars?.map((c) => (
              <div
                key={c.id}
                // v0.17.0（审查 A21）：可点击 div 补键盘可达（参考 ChapterListItem 模式）
                role="button"
                tabIndex={0}
                onClick={() => setResourceDetail({ title: c.name, body: Object.entries(c.profile).map(([k, v]) => `${k}：${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n') })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setResourceDetail({ title: c.name, body: Object.entries(c.profile).map(([k, v]) => `${k}：${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n') })
                  }
                }}
                style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: 'var(--bg-card)' }}
              >
                {c.name}
                <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{c.status === 'pending' ? '待确认' : '正式'}</span>
              </div>
            ))}
            {resourceChars === null && !resourceLoading && !resourceError && (
              <p className="muted t-small">点击上方「👤 角色」加载</p>
            )}
          </div>
        )}

        {resourceTab === 'world' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {resourceLoading && <p className="muted t-small">加载中…</p>}
            {resourceError && (
              <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
                加载失败：{resourceError}
                <button className="sm ml-2" onClick={() => void loadResourceTab('world')}>重试</button>
              </div>
            )}
            {resourceWorld && Object.entries(resourceWorld.manual ?? {}).map(([k, v]) => (
              <div
                key={k}
                role="button"
                tabIndex={0}
                onClick={() => setResourceDetail({ title: k, body: String(v) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setResourceDetail({ title: k, body: String(v) })
                  }
                }}
                style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: 'var(--bg-card)' }}
              >                {k}
              </div>
            ))}
            {resourceWorld === null && !resourceLoading && !resourceError && (
              <p className="muted t-small">点击上方「🌍 设定」加载</p>
            )}
          </div>
        )}

        {resourceTab === 'rules' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {resourceLoading && <p className="muted t-small">加载中…</p>}
            {resourceError && (
              <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
                加载失败：{resourceError}
                <button className="sm ml-2" onClick={() => void loadResourceTab('rules')}>重试</button>
              </div>
            )}
            {resourceRules?.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => setResourceDetail({ title: r.name, body: (r.features as Array<Record<string, unknown>>).map((f) => `✓ ${String(f.name)}：${String(f.description ?? '')}`).join('\n') })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setResourceDetail({ title: r.name, body: (r.features as Array<Record<string, unknown>>).map((f) => `✓ ${String(f.name)}：${String(f.description ?? '')}`).join('\n') })
                  }
                }}
                style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: 'var(--bg-card)' }}
              >
                {r.name}
              </div>
            ))}
            {resourceRules === null && !resourceLoading && !resourceError && (
              <p className="muted t-small">点击上方「📐 规则」加载</p>
            )}
          </div>
        )}
      </div>

      {/* 中：编辑器 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="row" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', justifyContent: 'space-between' }}>
          <div className="row">
            {editingTitle && selectedChapter ? (
              <input
                style={{ width: 240 }}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  // P9 B8：Enter 已提交则跳过 blur 双发
                  if (titleSubmittedRef.current) {
                    titleSubmittedRef.current = false
                    return
                  }
                  void saveTitle()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur()
                    titleSubmittedRef.current = true
                    void saveTitle()
                  } else if (e.key === 'Escape') {
                    setEditingTitle(false)
                  }
                }}
                autoFocus
              />
            ) : (
              <strong
                style={{ cursor: 'pointer' }}
                title="点击编辑标题"
                onClick={() => {
                  setTitleDraft(chapter?.title ?? '')
                  setEditingTitle(true)
                }}
              >
                {chapter?.title ?? '选择章节'}
              </strong>
            )}
            {chapter?.summary && <span className="muted t-small">{chapter.summary}</span>}
            <span className="muted t-small">｜{hanCount} 字</span>
            {/* v0.19.0：人类/AI 字数分离（NovelCraft 学习——你的字 vs AI 贡献） */}
            <span className="muted t-small" style={{ color: 'var(--ok)' }}>
              ｜我的 {statsShow.human.toLocaleString()} · AI {statsShow.ai.toLocaleString()}
            </span>
          </div>
          <div className="row flex-wrap">
            <button onClick={() => void saveContent().catch(() => undefined)} disabled={saving || contentLoading || streaming}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button onClick={() => void generate()} disabled={streaming || !selectedChapter || contentLoading}>
              {streaming ? '生成中…' : 'AI 生成正文'}
            </button>
            <input
              style={{ flex: '1 1 200px', minWidth: 180 }}
              placeholder="可选：对本次生成的额外要求（如：本章要引入新反派伏笔、节奏放慢写细节）…"
              value={guidanceDraft}
              disabled={streaming}
              onChange={(e) => setGuidanceDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !streaming) void generate() }}
            />
            {/* v0.15.0：反馈沉淀——把这句要求固定为硬约束（全链生效） */}
            <button
              className="sm"
              title="把这句话设为书级硬约束（导演/方案/生成/修复全链强制生效）"
              disabled={streaming || !guidanceDraft.trim()}
              onClick={() => {
                const t = guidanceDraft.trim()
                if (!t) return
                void (async () => {
                  const d = await novelApi.detail(id)
                  const cur = d.novel.constraints ?? []
                  const list = cur.filter((c) => c.text !== t)
                  const canon = extractProtagonistNameFromDraft(t)
                  list.push({
                    id: `c${Date.now()}`,
                    text: t,
                    level: 'must' as const,
                    enabled: true,
                    createdAt: new Date().toISOString(),
                    ...(canon ? { keyword: canon, replaceWith: canon } : {})
                  })
                  await novelApi.patch(id, { constraints: list })
                  setGuidanceDraft('')
                })().catch(() => undefined)
              }}
            >
              <Pin size={12} /> 固定为约束
            </button>
            <span style={{ margin: '0 8px', color: 'var(--border)' }}>|</span>
            <button className="sm" style={{ color: 'var(--accent)', background: 'transparent', border: 'none' }} disabled={exportBusy !== null} onClick={() => void exportChapter('txt')}>
              {exportBusy === 'txt' ? '导出中…' : 'TXT'}
            </button>
            <button className="sm" style={{ color: 'var(--accent)', background: 'transparent', border: 'none' }} disabled={exportBusy !== null} onClick={() => void exportChapter('md')}>
              {exportBusy === 'md' ? '导出中…' : 'MD'}
            </button>
            <button className="sm" style={{ color: 'var(--accent)', background: 'transparent', border: 'none' }} disabled={exportBusy !== null} onClick={() => void exportChapter('epub')}>
              {exportBusy === 'epub' ? '导出中…' : 'EPUB'}
            </button>
          </div>
        </div>
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
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          <CodeMirror
            value={content}
            editable={!streaming}
            onChange={(v) => {
              dirtyRef.current = true
              setContent(v)
            }}
            onUpdate={(u) => {
              updateSelectionInfo()
              // v0.19.0：人工输入统计（AI 来源已在 dispatch 侧累计）
              trackHumanWords(u as never)
            }}
            height="100%"
            theme={novelEditorTheme}
            extensions={[markdown()]}
            style={{ height: '100%' }}
            ref={editorRef}
          />
          {/* v0.19.0：光标续写建议浮层（Cmd/Ctrl+J 生成 → Tab 插入 / Esc 关闭） */}
          {(suggestion || sugBusy) && !streaming && selectedChapter && (
            <div
              style={{
                position: 'absolute',
                left: 8,
                right: 8,
                bottom: 8,
                zIndex: 20,
                background: 'var(--bg-panel)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-m)',
                boxShadow: 'var(--shadow-lg)',
                padding: '8px 12px'
              }}
            >
              {sugBusy && !suggestion ? (
                <div className="row" style={{ gap: 8, fontSize: 12, color: 'var(--text-dim)' }}>
                  <Wand2 size={13} /> 正在生成续写建议…
                </div>
              ) : suggestion ? (
                <div className="col" style={{ gap: 6 }}>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <Wand2 size={13} color="var(--accent-bright)" />
                    <strong style={{ fontSize: 12 }}>AI 续写建议</strong>
                    <span className="muted t-small">（{countCjk(suggestion.text)} 字）</span>
                    <span style={{ flex: 1 }} />
                    <button className="sm primary" onClick={acceptSuggestion}>Tab 插入</button>
                    <button className="sm" onClick={() => void suggestContinue()}>↻ 再生成</button>
                    <button className="sm" onClick={() => setSuggestion(null)}>Esc 关闭</button>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.7,
                      color: 'var(--text)',
                      maxHeight: 96,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      padding: '6px 8px',
                      background: 'var(--bg-card)',
                      borderRadius: 6
                    }}
                  >
                    {suggestion.text}
                  </div>
                </div>
              ) : null}
            </div>
          )}
          {/* P10：空状态引导（参考项目：编辑器空置时给引导） */}
          {!contentLoading && !streaming && !content && selectedChapter && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                zIndex: 5
              }}
            >
              <div
                className="panel"
                style={{
                  background: 'var(--bg-panel)',
                  maxWidth: 380,
                  padding: '20px 24px',
                  textAlign: 'center',
                  pointerEvents: 'auto',
                  boxShadow: 'var(--shadow-lg)'
                }}
              >
                <div style={{ fontSize: 16, marginBottom: 8 }}>📝 本章还没有正文</div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 14 }}>
                  点击下方按钮，AI 将根据本章任务单、写作上下文与角色账本生成正文。
                  {chapter?.summary ? <><br />本章概要：{chapter.summary}</> : null}
                </div>
                <button className="primary" onClick={() => void generate()} disabled={actionBusy !== null}>
                  ✍️ 生成正文
                </button>
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)', fontSize: 12 }} className="muted">
          {streamStat && <span style={{ color: 'var(--accent-bright)' }}>{streamStat}</span>}
          {actionMsg && <span style={{ color: 'var(--ok)' }}>{actionMsg}</span>}
          {actionError && <span style={{ color: 'var(--danger)' }}>{actionError}</span>}
        </div>
      </div>

      {/* 右：动作面板（P10：推荐动作卡 + 分区） */}
      <div style={{ width: 320, borderLeft: '1px solid var(--border)', padding: 12, overflowY: 'auto', background: 'var(--bg-panel)', display: focusMode ? 'none' : undefined }}>
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>执行面板</h2>

        {/* P12 A3：本章进度矩阵（信号从现有状态推导） */}
        {selectedChapter && (() => {
          const taskReady = Boolean(chapter?.goal && Object.keys(chapter.goal).length > 0)
          const contextReady = ctxSections !== null
          const draftStarted = content.trim().length > 0
          const draftSaved = ['written', 'reviewed', 'done'].includes(chapter?.status ?? '') || savedContentRef.current.trim().length > 0
          const reviewed = reviewResult !== null || ['reviewed', 'done'].includes(chapter?.status ?? '')
          const repaired = fixDoneRef.current
          const backfilled = backfillDoneRef.current || reviewResult !== null
          const snapshotted = snapshotDoneRef.current
          const reviewable = ['reviewed', 'done'].includes(chapter?.status ?? '')
          const segs: Array<[string, boolean]> = [
            ['任务单', taskReady],
            ['上下文', contextReady],
            ['草稿', draftStarted],
            ['保存', draftSaved],
            ['审核', reviewed],
            ['修复', repaired],
            ['回灌', backfilled],
            ['快照', snapshotted],
            ['可审', reviewable]
          ]
          const doneCount = segs.filter(([, v]) => v).length
          return (
            <div className="panel" style={{ background: 'var(--bg-card)', padding: 12, marginBottom: 12 }}>
              <div className="row justify-between">
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>本章进度</span>
                <span style={{ fontSize: 12, color: 'var(--accent-bright)' }}>{doneCount}/{segs.length}</span>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                {segs.map(([label, done]) => (
                  <div key={label} title={`${label}${done ? ' ✓' : ''}`} className="flex-1">
                    <div
                      style={{
                        height: 4,
                        borderRadius: 2,
                        background: done ? 'var(--ok)' : 'var(--bg-input)',
                        transition: 'background 200ms'
                      }}
                    />
                    <div style={{ fontSize: 9, color: done ? 'var(--ok)' : 'var(--text-faint)', marginTop: 3, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

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
          {/* P21-3：跑创作方案（工坊定义的 agent 流水线）+ P30：以方案生产正文（whole_book 步骤） */}
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
                  <option key={Number(s.id)} value={Number(s.id)}>{String(s.name)}（{Array.isArray(s.steps) ? (s.steps as unknown[]).length : 0} 步）</option>
                ))}
              </select>
              <button
                className="sm primary"
                disabled={actionBusy !== null || !selectedChapter || !content || !solutionId}
                onClick={() => void withBusy('solution-run', () => runSolutionOnChapter())}
              >
                {actionBusy === 'solution-run' ? '运行中…' : '跑方案'}
              </button>
              {/* P30：以方案生产正文（whole_book 步骤接力，空章节专用） */}
              <button
                className="sm"
                style={{ color: 'var(--accent-bright)', borderColor: 'var(--accent)' }}
                disabled={actionBusy !== null || !selectedChapter || content !== '' || !solutionId}
                title="用方案的章节生产步骤接力生成正文（需空章节）"
                onClick={() => void withBusy('solution-produce', () => produceWithSolution())}
              >
                {actionBusy === 'solution-produce' ? '流水线生产中…' : '以方案生产正文'}
              </button>
            </div>
            {/* v0.10.0（批B/I2）：质量债自动修复徽标——整本生产后待修复章节 + 一键触发 */}
            <DebtFixBadge novelId={id} />
            {solutionRunSummary && (
              <div className="muted" style={{ fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto', background: 'var(--bg-panel)', borderRadius: 6, padding: 6 }}>
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
          <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
            <div className="row justify-between">
              <strong>审核结果</strong>
              <span className="badge">评分 {String(reviewResult.score)}</span>
            </div>
            {Array.isArray(reviewResult.issues) && (reviewResult.issues as Array<Record<string, unknown>>).length > 0 && (
              <>
                {/* P19 ⑧：优先优化建议（severity 排序 top 3，一键采纳重写） */}
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: 'var(--accent-bright)' }}>优先优化建议（按优先级）</span>
                  <ol style={{ margin: '6px 0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(reviewResult.issues as Array<Record<string, unknown>>)
                      .slice()
                      .sort((a, b) => {
                        const w: Record<string, number> = { high: 0, medium: 1, low: 2 }
                        return (w[String(a.severity)] ?? 3) - (w[String(b.severity)] ?? 3)
                      })
                      .slice(0, 3)
                      .map((issue, i) => (
                        <li key={i}>
                          {String(issue.problem)} <span className="muted">→ {String(issue.suggestion)}</span>
                        </li>
                      ))}
                  </ol>
                </div>
                <button
                  className="sm"
                  style={{ marginTop: 10, color: 'var(--accent-bright)', borderColor: 'var(--accent)' }}
                  disabled={streaming || actionBusy !== null}
                  onClick={() => {
                    const top = (reviewResult.issues as Array<Record<string, unknown>>)
                      .slice()
                      .sort((a, b) => {
                        const w: Record<string, number> = { high: 0, medium: 1, low: 2 }
                        return (w[String(a.severity)] ?? 3) - (w[String(b.severity)] ?? 3)
                      })
                      .slice(0, 3)
                    const advice = top
                      .map((i) => `${String(i.location)}：${String(i.problem)}（建议：${String(i.suggestion)}）`)
                      .join('；')
                    if (!window.confirm(`将按以下建议重新生成本章（当前内容会被替换）：\n\n${advice.slice(0, 300)}`)) return
                    setGuidanceDraft(advice)
                    void generate()
                  }}
                >
                  采纳建议并重写
                </button>
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)' }}>
                  {(reviewResult.issues as Array<Record<string, unknown>>).map((issue, i) => (
                    <div key={i} style={{ marginTop: 8, fontSize: 12, paddingTop: 8 }}>
                      <span className="badge" style={issue.severity === 'high' ? { color: '#ff6b6b', background: 'rgba(255,107,107,0.12)' } : {}}>
                        {String(issue.severity)}
                      </span>
                      <div style={{ marginTop: 4 }}>{String(issue.problem)}</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>建议：{String(issue.suggestion)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {backfillResult && (
          <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
            <strong>回灌提取（待确认）</strong>
            {Array.isArray(backfillResult.characterStates) && (backfillResult.characterStates as Array<{ name: string; state: string }>).length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                {backfillResult.characterStates.map((cs, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>• {cs.name}：{cs.state}</div>
                ))}
              </div>
            )}
            {Array.isArray(backfillResult.newFacts) && (backfillResult.newFacts as Array<{ content: string }>).length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <span className="muted">新事实：</span>
                {backfillResult.newFacts.map((f, i) => <div key={i}>• {f.content}</div>)}
              </div>
            )}
            {Array.isArray(backfillResult.foreshadows) && (backfillResult.foreshadows as Array<{ content: string }>).length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <span className="muted">新伏笔：</span>
                {backfillResult.foreshadows.map((f, i) => <div key={i}>• {f.content}</div>)}
              </div>
            )}
            <button className="primary" style={{ marginTop: 10 }} disabled={actionBusy !== null} onClick={() => void confirmStates()}>
              确认角色状态入账
            </button>
          </div>
        )}

        {showPending && (
          <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
            <div className="row justify-between">
              <strong>待确认区</strong>
              <button onClick={() => setShowPending(false)} style={{ fontSize: 12, padding: '2px 6px' }}>关闭</button>
            </div>
            {pending && pending.pendingFacts.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <span className="muted">未确认事实：</span>
                {pending.pendingFacts.map((f) => <div key={f.id}>• {f.content}</div>)}
              </div>
            )}
            {pending && pending.pendingCharacters.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <span className="muted">待确认角色：</span>
                {pending.pendingCharacters.map((c) => <div key={c.id}>• {c.name}</div>)}
              </div>
            )}
            {pending && pending.pendingFacts.length === 0 && pending.pendingCharacters.length === 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>暂无待确认项</p>
            )}
          </div>
        )}

        {/* v0.20.0：记忆面面板（角色状态/势力状态/待确认事实——可手动修正） */}
        {showMemory && (
          <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
            <div className="row justify-between">
              <strong>记忆面</strong>
              <button onClick={() => setShowMemory(false)} style={{ fontSize: 12, padding: '2px 6px' }}>关闭</button>
            </div>
            <div className="muted" style={{ fontSize: 11, margin: '6px 0' }}>
              状态机显式视图——AI 回灌与手动修正共用同一账本；可增删角色状态、修正势力状态。
            </div>
            {memory && (
              <>
                <div style={{ fontSize: 12, marginTop: 8 }}>
                  <span className="muted">角色状态：</span>
                  {memory.characters.filter((c) => c.states.length > 0).length === 0 && (
                    <span className="muted">（暂无——运行「状态回灌提取」后生成）</span>
                  )}
                  {memory.characters
                    .filter((c) => c.states.length > 0)
                    .map((c) => (
                      <div key={c.name} className="row" style={{ gap: 6, flexWrap: 'wrap', padding: '3px 0', alignItems: 'center' }}>
                        <strong style={{ minWidth: 90 }}>{c.name}</strong>
                        {c.states.map((s) => (
                          <span key={s} className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-bright)' }}>
                            {s}
                            <button
                              style={{ marginLeft: 4, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
                              onClick={() => void patchCharState(c.name, s, true)}
                              title="删除此状态"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                        <CharStateAdd name={c.name} onAdd={(s) => void patchCharState(c.name, s, false)} />
                      </div>
                    ))}
                </div>
                <div style={{ fontSize: 12, marginTop: 10 }}>
                  <span className="muted">势力状态：</span>
                  {memory.factions.length === 0 && <span className="muted">（世界观未生成势力）</span>}
                  {memory.factions.map((f) => (
                    <div key={f.name} className="row" style={{ gap: 6, flexWrap: 'wrap', padding: '3px 0', alignItems: 'center' }}>
                      <strong style={{ minWidth: 90 }}>{f.name}</strong>
                      <span className="muted">{f.currentState || '（无）'}</span>
                      <FactionStateEdit
                        current={f.currentState}
                        onSave={(s) => void patchFactionState(f.name, s)}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, marginTop: 10 }}>
                  <span className="muted">待确认事实（{memory.pendingFacts.length}）：</span>
                  {memory.pendingFacts.map((f) => <div key={f.id}>• {f.content}</div>)}
                </div>
              </>
            )}
          </div>
        )}

        {showVersions && (
          <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
            <div className="row justify-between">
              <strong>版本历史</strong>
              <button onClick={() => setShowVersions(false)} style={{ fontSize: 12, padding: '2px 6px' }}>关闭</button>
            </div>
            {versions && versions.length === 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>暂无版本（生成正文时会自动存快照）</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {versions?.map((v) => (
                <div key={v.id} style={{ fontSize: 12, padding: '6px 10px', background: 'var(--bg-panel)', borderRadius: 6 }}>
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                    <span className="badge">#{v.id}</span>
                    <span className="muted t-small">{v.note} · {v.createdAt} · {v.wordCount} 字</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.preview}
                  </div>
                  {/* P20（U1）：查看全文 + 恢复此版本（版本历史可用了） */}
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <button
                      className="sm"
                      disabled={actionBusy !== null}
                      onClick={() => {
                        if (!selectedChapter) return
                        void withBusy(`vview-${v.id}`, async () => {
                          try {
                            const r = await novelApi.chapterVersionDetail(id, selectedChapter, v.id)
                            setResourceDetail({ title: `版本 #${v.id}（${v.note} · ${v.createdAt}）`, body: r.version.content })
                          } catch (err) {
                            setActionError(err instanceof Error ? err.message : String(err))
                          }
                        })
                      }}
                    >
                      查看
                    </button>
                    <button
                      className="sm"
                      style={{ color: 'var(--accent-bright)', borderColor: 'var(--accent)' }}
                      disabled={actionBusy !== null || streaming}
                      onClick={() => {
                        if (!selectedChapter) return
                        if (!window.confirm(`恢复为版本 #${v.id}？当前内容会先存入新版本，然后被替换。`)) return
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
                      }}
                    >
                      恢复
                    </button>
                  </div>
                </div>
              ))}
            </div>
      </div>
        )}

        {ctxSections && ctxToggles && (
          <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
            <div className="row justify-between">
              <strong>写作上下文（生成时注入）</strong>
              <button onClick={() => { setCtxSections(null); setCtxToggles(null) }} style={{ fontSize: 12, padding: '2px 6px' }}>关闭</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {ctxSections.map((s) => (
                <label key={s.key} className="row" style={{ fontSize: 12, cursor: 'pointer', justifyContent: 'space-between' }}>
                  <span className="row gap-2">
                    <input
                      type="checkbox"
                      checked={ctxToggles[s.key] ?? true}
                      // v0.17.0（审查 A28）：消除 `prev!` 非空断言（面板渲染前已保证非空，仍做兜底）
                      onChange={() => setCtxToggles((prev) => ({ ...(prev ?? {}), [s.key]: !(prev?.[s.key] ?? true) }))}
                    />
                    {s.key}
                  </span>
                  <span className="muted t-small">{Math.round(s.tokens)} tokens</span>
                </label>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
              取消勾选后，该段不注入生成上下文（可省 token，但可能影响一致性）。勾选改动在下次生成时生效。
            </p>
          </div>
        )}

        {resourceDetail && (
          <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
            <div className="row justify-between">
              <strong className="t3">{resourceDetail.title}</strong>
              <button onClick={() => setResourceDetail(null)} style={{ fontSize: 12, padding: '2px 6px' }}>✕</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 300, overflowY: 'auto' }}>
              {resourceDetail.body || '（无内容）'}
            </div>
          </div>
        )}

        {/* D2：AI 对话侧栏（折叠） */}
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🤖 AI 对话（对话即创作）</summary>
          <div style={{ marginTop: 8, height: 320, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-card)' }}>
            <HubChat novelId={id} />
          </div>
        </details>
      </div>
    </div>
    </>
  )
}

// P22-C1：章节页 memo 隔离（100+ 章节时性能）
const ChapterListItem = memo(function ChapterListItem({
  c,
  selected,
  onSelect
}: {
  c: ChapterSummary
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const stColor =
    c.status === 'reviewed' || c.status === 'done'
      ? 'var(--ok)'
      : c.status === 'written'
        ? 'var(--accent)'
        : c.status === 'failed'
          ? 'var(--danger)'
          : 'var(--text-faint)'
  return (
    <div
      role="button"
      tabIndex={0}
      className={`list-item${selected ? ' active' : ''}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="row justify-between">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.title || `第 ${c.id} 章`}
        </span>
        {c.wordCount > 0 && <span className="muted t-small">{c.wordCount}</span>}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 2 }}>
        <span
          style={{ width: 7, height: 7, borderRadius: 4, background: stColor, display: 'inline-block', flexShrink: 0 }}
        />
        <span className="muted t-small">
          {c.status} {c.volumeTitle ? `· ${c.volumeTitle}` : ''}
        </span>
      </div>
      <div style={{ fontSize: 10, marginTop: 2, color: 'var(--text-faint)' }}>
        {c.status === 'planned' && '下一步：生成正文'}
        {c.status === 'written' && '下一步：AI 审核'}
        {['reviewed', 'done'].includes(c.status) && '✓ 可进入下一章'}
        {c.status === 'failed' && '⚠️ 生成失败，可重试'}
      </div>
    </div>
  )
})
