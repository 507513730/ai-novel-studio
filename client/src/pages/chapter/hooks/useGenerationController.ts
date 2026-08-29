// 生成控制器 hook（重构计划 R7 / spec：SSE 生成流的唯一归属）。
// 契约（R7 验收 + 既有纪律）：
// - SSE 累积：onDelta 经 rAF 合并缓冲（P20 U6）；终端 handler（done/aborted/error）落定后不再 flush（批1-#3 防尾段重复）
// - 中止兜底：generateBusyRef 防重入；unmount/组件级取消经 abortRef；error 恢复生成前内容（P9 A3）
// - 服务端记账（v0.21.0 N1）：onDelta 不本地累计 AI 字数
// - 成本确认：生成前 themed confirm（未保存 + 成本合并一次确认，v0.22.0）
import { useEffect, useRef, useState } from 'react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { generateChapterSse } from '../../../api'
import { estimateCost, estimateTokens, fmtCost } from '../../../utils/costEstimate'

export interface GenerationControllerDeps {
  novelId: number
  selectedChapter: number | null
  editorRef: React.MutableRefObject<ReactCodeMirrorRef | null>
  content: string
  // 协调管道（session/loader 持有）
  savedContentRef: React.MutableRefObject<string>
  dirtyRef: React.MutableRefObject<boolean>
  streamingRef: React.MutableRefObject<boolean>
  setContent: React.Dispatch<React.SetStateAction<string>>
  confirmFn: (cfg: {
    title: string
    message: string
    confirmText?: string
    danger?: boolean
    action: () => void
  }) => void
  guidanceDraft: string
  buildInclude: () => string[] | undefined
  invalidate: () => Promise<void>
  onActionError: (msg: string | null) => void
  // onDone/onAborted 的完成提示（页面接 actionMsg）
  onGenerated: (msg: string) => void
}

export function useGenerationController(deps: GenerationControllerDeps): {
  streaming: boolean
  streamStat: string | null
  generate: () => Promise<void>
  cancelGenerate: () => void
} {
  const {
    novelId,
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
    onActionError,
    onGenerated
  } = deps

  const [streaming, setStreaming] = useState(false)
  // P12 C2：生成中实时估算显示
  const [streamStat, setStreamStat] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const generateBusyRef = useRef(false)
  // P20（U6）：流式 rAF 合并缓冲
  const pendingDeltaRef = useRef('')
  const rAFRef = useRef<number | null>(null)
  // 批1-#3（v0.7.2）：内容已由 onDone/onAborted/onError 落定的标记——落定后不再 flush rAF 缓冲（防尾段重复追加）
  const contentSettledRef = useRef(false)

  // P2.2 🟢14：组件卸载时中止生成流（防止继续 setState + 浪费额度）
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

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
    onActionError(null)
    setContent('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await generateChapterSse(
        novelId,
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
            onGenerated(`生成完成：${payload.wordCount} 字，缓存命中 ${payload.usage.cacheHit ?? 0}`)
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
            onGenerated(`已中止，保留已生成 ${payload.wordCount} 字`)
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
            onActionError(message)
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

  const cancelGenerate = (): void => {
    abortRef.current?.abort()
  }

  return { streaming, streamStat, generate, cancelGenerate }
}
