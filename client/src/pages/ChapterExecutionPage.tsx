import { useEffect, useRef, useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { novelEditorTheme } from '../editor/theme'
import { novelApi, generateChapterSse, styleApi, studioApi } from '../api'
import { SelectionToolbar } from '../editor/SelectionToolbar'
import { HubChat } from '../components/HubChat'
import { useToast } from '../components/Toast'
import { BookOpenText, Users, Map, Scale } from 'lucide-react'
import { estimateCost, estimateTokens, fmtCost } from '../utils/costEstimate'

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
  // P20（U6）：流式 rAF 合并缓冲
  const pendingDeltaRef = useRef('')
  const rAFRef = useRef<number | null>(null)
  // P19 ④：单次生成引导输入（生成后保留，供参考）
  const [guidanceDraft, setGuidanceDraft] = useState('')
  // P12 A3：章节进度矩阵信号（跨渲染记录，不新增请求）
  const fixDoneRef = useRef(false)
  const backfillDoneRef = useRef(false)
  const confirmDoneRef = useRef(false)
  const snapshotDoneRef = useRef(false)
  // P20（U5）：字数统计 memo（避免每次击键重渲染时 O(n) 扫描）
  const hanCount = useMemo(() => (content.match(/[\u4e00-\u9fff]/g) ?? []).length, [content])
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
  const [resourceWorld, setResourceWorld] = useState<Record<string, unknown> | null>(null)
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
        setResourceWorld(r.world as unknown as Record<string, unknown>)
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

  // A1：应用选区替换
  const applySelection = (replacement: string): void => {
    const view = editorRef.current?.view
    if (!view) return
    const { from, to } = view.state.selection.main
    if (to > from) {
      view.dispatch({ changes: { from, to, insert: replacement } })
      view.dispatch({ selection: { anchor: from + replacement.length } })
    }
    setContent(view.state.doc.toString())
    updateSelectionInfo()
  }

  // A1：在指定位置插入
  const insertAt = (text: string, pos: number): void => {
    const view = editorRef.current?.view
    if (!view) return
    const insertPos = Math.min(pos, view.state.doc.length)
    view.dispatch({ changes: { from: insertPos, insert: text }, selection: { anchor: insertPos + text.length } })
    setContent(view.state.doc.toString())
    updateSelectionInfo()
  }

  const chapters = useQuery({
    queryKey: ['chapters', id],
    queryFn: () => novelApi.chapters(id)
  })
  const list = chapters.data?.chapters ?? []
  const chapter = list.find((c) => c.id === selectedChapter)

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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['chapters', id] })
  }

  // A2：Ctrl+S 保存（CodeMirror keymap）
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // P9 D16：输入框/文本域聚焦时不触发全局保存
      const t = e.target as HTMLElement | null
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveContent().catch(() => undefined)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChapter, content])

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
            const pending = (pendingDeltaRef.current += text)
            if (rAFRef.current !== null) return
            rAFRef.current = requestAnimationFrame(() => {
              rAFRef.current = null
              const batch = pendingDeltaRef.current
              pendingDeltaRef.current = ''
              setContent((prev) => prev + batch)
              const total = (editorRef.current?.view?.state.doc.toString() ?? '').length
              const t = estimateTokens(total.toString())
              setStreamStat(`已生成 ${total.toLocaleString()} 字 · 约 ${t.toLocaleString()} tokens · ${fmtCost(estimateCost('', t).cost)}`)
              void pending
            })
          },
          onDone: async (payload) => {
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
            // P9 A3：失败恢复生成前的内容
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
      // P20（U6）：清理 rAF 缓冲（未刷入的 delta 直接落到 state，保证内容不丢）
      if (rAFRef.current !== null) {
        cancelAnimationFrame(rAFRef.current)
        rAFRef.current = null
      }
      if (pendingDeltaRef.current) {
        const tail = pendingDeltaRef.current
        pendingDeltaRef.current = ''
        setContent((prev) => prev + tail)
      }
    }
  }

  // P21-3：方案流水线（跑在章节上）
  const solutionsForRun = useQuery({ queryKey: ['studio-solutions', 'run'], queryFn: studioApi.solutions })
  const [solutionId, setSolutionId] = useState<number | null>(null)
  const [solutionRunSummary, setSolutionRunSummary] = useState<string | null>(null)
  const runSolutionOnChapter = async (): Promise<void> => {
    if (!selectedChapter || !solutionId) return
    setSolutionRunSummary(null)
    setActionError(null)
    const r = await studioApi.solutionRun(solutionId, id, selectedChapter)
    setSolutionRunSummary(r.run.degraded ? `⚠ 部分步骤降级\n${r.summary}` : r.summary)
    setActionMsg(`方案完成${r.run.degraded ? '（部分降级）' : ''}`)
  }

  const cancelGenerate = (): void => {
    abortRef.current?.abort()
  }

  // P9 B1：per-action busy 锁（防重复提交）
  const withBusy = async (key: string, fn: () => Promise<void>): Promise<void> => {
    if (actionBusy) return
    setActionBusy(key)
    try {
      await fn()
    } finally {
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

  const loadPending = async (): Promise<void> => {
    try {
      const r = await novelApi.pending(id)
      setPending(r)
      setShowPending(true)
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
      const res = await fetch(exportLink(format))
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
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 左：资源树（D1：章节/角色/设定/规则 分组） */}
      <div style={{ width: 260, borderRight: '1px solid var(--border)', padding: 12, overflowY: 'auto', background: 'var(--bg-panel)' }}>
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
                <Icon size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                {label}
              </button>
            ))}
          </div>
          <button className="sm" onClick={() => navigate(`/novels/${id}`)}>
            工作台
          </button>
        </div>

        {resourceTab === 'chapters' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {list.map((c) => {
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
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  className={`list-item${selectedChapter === c.id ? ' active' : ''}`}
                  onClick={() => void selectChapter(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      void selectChapter(c.id)
                    }
                  }}
                >
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.title || `第 ${c.id} 章`}
                    </span>
                    {c.wordCount > 0 && <span className="muted" style={{ fontSize: 11 }}>{c.wordCount}</span>}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 2 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 4,
                        background: stColor,
                        display: 'inline-block',
                        flexShrink: 0
                      }}
                    />
                    <span className="muted" style={{ fontSize: 11 }}>
                      {c.status} {c.volumeTitle ? `· ${c.volumeTitle}` : ''}
                    </span>
                  </div>
                  {/* P12 B1：下一步提示 */}
                  <div style={{ fontSize: 10, marginTop: 2, color: 'var(--text-faint)' }}>
                    {c.status === 'planned' && '下一步：生成正文'}
                    {c.status === 'written' && '下一步：AI 审核'}
                    {['reviewed', 'done'].includes(c.status) && '✓ 可进入下一章'}
                    {c.status === 'failed' && '⚠️ 生成失败，可重试'}
                  </div>
                </div>
              )
            })}
            {chapters.isLoading && <p className="muted" style={{ fontSize: 12 }}>加载中…</p>}
            {chapters.isError && (
              <p className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
                加载失败：{String(chapters.error)}
              </p>
            )}
            {!chapters.isLoading && !chapters.isError && list.length === 0 && (
              <p className="muted" style={{ fontSize: 12 }}>还没有章节，请先在工作台生成章节清单。</p>
            )}
          </div>
        )}

        {resourceTab === 'characters' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {resourceLoading && <p className="muted" style={{ fontSize: 12 }}>加载中…</p>}
            {resourceError && (
              <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
                加载失败：{resourceError}
                <button className="sm" style={{ marginLeft: 6 }} onClick={() => void loadResourceTab('characters')}>重试</button>
              </div>
            )}
            {resourceChars?.map((c) => (
              <div
                key={c.id}
                onClick={() => setResourceDetail({ title: c.name, body: Object.entries(c.profile).map(([k, v]) => `${k}：${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n') })}
                style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: 'var(--bg-card)' }}
              >
                {c.name}
                <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{c.status === 'pending' ? '待确认' : '正式'}</span>
              </div>
            ))}
            {resourceChars === null && !resourceLoading && !resourceError && (
              <p className="muted" style={{ fontSize: 12 }}>点击上方「👤 角色」加载</p>
            )}
          </div>
        )}

        {resourceTab === 'world' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {resourceLoading && <p className="muted" style={{ fontSize: 12 }}>加载中…</p>}
            {resourceError && (
              <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
                加载失败：{resourceError}
                <button className="sm" style={{ marginLeft: 6 }} onClick={() => void loadResourceTab('world')}>重试</button>
              </div>
            )}
            {resourceWorld && Object.entries((resourceWorld as { manual?: Record<string, string> }).manual ?? {}).map(([k, v]) => (
              <div key={k} onClick={() => setResourceDetail({ title: k, body: String(v) })} style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: 'var(--bg-card)' }}>
                {k}
              </div>
            ))}
            {resourceWorld === null && !resourceLoading && !resourceError && (
              <p className="muted" style={{ fontSize: 12 }}>点击上方「🌍 设定」加载</p>
            )}
          </div>
        )}

        {resourceTab === 'rules' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {resourceLoading && <p className="muted" style={{ fontSize: 12 }}>加载中…</p>}
            {resourceError && (
              <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
                加载失败：{resourceError}
                <button className="sm" style={{ marginLeft: 6 }} onClick={() => void loadResourceTab('rules')}>重试</button>
              </div>
            )}
            {resourceRules?.map((r) => (
              <div
                key={r.id}
                onClick={() => setResourceDetail({ title: r.name, body: (r.features as Array<Record<string, unknown>>).map((f) => `✓ ${String(f.name)}：${String(f.description ?? '')}`).join('\n') })}
                style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: 'var(--bg-card)' }}
              >
                {r.name}
              </div>
            ))}
            {resourceRules === null && !resourceLoading && !resourceError && (
              <p className="muted" style={{ fontSize: 12 }}>点击上方「📐 规则」加载</p>
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
            {chapter?.summary && <span className="muted" style={{ fontSize: 12 }}>{chapter.summary}</span>}
            <span className="muted" style={{ fontSize: 12 }}>｜{hanCount} 字</span>          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
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
            onUpdate={updateSelectionInfo}
            height="100%"
            theme={novelEditorTheme}
            extensions={[markdown()]}
            style={{ height: '100%' }}
            ref={editorRef}
          />
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
      <div style={{ width: 320, borderLeft: '1px solid var(--border)', padding: 12, overflowY: 'auto', background: 'var(--bg-panel)' }}>
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
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>本章进度</span>
                <span style={{ fontSize: 12, color: 'var(--accent-bright)' }}>{doneCount}/{segs.length}</span>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                {segs.map(([label, done]) => (
                  <div key={label} title={`${label}${done ? ' ✓' : ''}`} style={{ flex: 1 }}>
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
        <div className="col" style={{ gap: 8 }}>
          <button
            onClick={() => void withBusy('review', () => runReview())}
            disabled={actionBusy !== null || !selectedChapter || !content}
          >
            {actionBusy === 'review' ? '审核中…' : 'AI 审核'}
          </button>
          {/* P21-3：跑创作方案（工坊定义的 agent 流水线） */}
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <select
                style={{ flex: 1, fontSize: 12 }}
                value={solutionId ?? ''}
                disabled={actionBusy !== null || !selectedChapter || !content}
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
            </div>
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
        </div>

        {/* 分区：快照与上下文 */}
        <div style={{ fontSize: 12, color: 'var(--text-faint)', margin: '12px 0 6px' }}>快照与上下文</div>
        <div className="col" style={{ gap: 8 }}>
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
            <div className="row" style={{ justifyContent: 'space-between' }}>
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
            <div className="row" style={{ justifyContent: 'space-between' }}>
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

        {showVersions && (
          <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
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
                    <span className="muted" style={{ fontSize: 11 }}>{v.note} · {v.createdAt} · {v.wordCount} 字</span>
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
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>写作上下文（生成时注入）</strong>
              <button onClick={() => { setCtxSections(null); setCtxToggles(null) }} style={{ fontSize: 12, padding: '2px 6px' }}>关闭</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {ctxSections.map((s) => (
                <label key={s.key} className="row" style={{ fontSize: 12, cursor: 'pointer', justifyContent: 'space-between' }}>
                  <span className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={ctxToggles[s.key] ?? true}
                      onChange={() => setCtxToggles((prev) => ({ ...prev!, [s.key]: !(prev![s.key] ?? true) }))}
                    />
                    {s.key}
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>{Math.round(s.tokens)} tokens</span>
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
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 13 }}>{resourceDetail.title}</strong>
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
  )
}
