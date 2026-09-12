// 编辑会话 hook（重构计划 R7 / spec：正文状态、保存、字数分离、选区与 AI 插入的唯一归属）。
// 契约（R7 验收 + 既有纪律）：
// - 空内容保护：服务端已有正文时禁止空覆盖、禁止置 written（P9 A1）
// - saveContent 失败必须上抛（切章依赖中断语义，P9 A4）
// - 脏检查：与已保存内容一致不发请求；字数分离增量上报后清零（v0.19.0）
// 共享 ref（contentLoadingRef/streamingRef/loadedChapterRef/savedContentRef/dirtyRef）由页面创建传入——
// 它们是加载器/生成器/会话三方的协调管道。
import { useMemo, useRef, useState } from 'react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { Annotation, type AnnotationType } from '@codemirror/state'
import { useChapterSave } from './useChapterSave'
import { countCjk } from '../types'

// v0.19.0：AI 写入标记（字数分离：区分 AI 插入与人工输入）
export const aiWrite = Annotation.define<boolean>()

export interface EditorSessionDeps {
  novelId: number
  selectedChapter: number | null
  editorRef: React.MutableRefObject<ReactCodeMirrorRef | null>
  // 协调管道（页面创建，loader/generation 共享）
  streamingRef: React.MutableRefObject<boolean>
  contentLoadingRef: React.MutableRefObject<boolean>
  loadedChapterRef: React.MutableRefObject<number | null>
  savedContentRef: React.MutableRefObject<string>
  dirtyRef: React.MutableRefObject<boolean>
  readContent?: () => string
  invalidate: () => Promise<void>
  toast: (type: 'ok' | 'error' | 'info', msg: string) => void
  // 非静默保存结果提示（页面接 actionMsg；2s 自动清除）
  notify: (msg: string) => void
  // 保存失败写 actionError（与 toast 并行，保持原行为）
  onActionError: (msg: string | null) => void
}

export function useEditorSession(deps: EditorSessionDeps): {
  content: string
  setContent: React.Dispatch<React.SetStateAction<string>>
  saving: boolean
  saveError: string | null
  hasConflict: boolean
  resolveConflict: () => Promise<void>
  resolvingConflict: boolean
  wordStats: { ai: number; human: number }
  setWordStats: React.Dispatch<React.SetStateAction<{ ai: number; human: number }>>
  aiDeltaRef: React.MutableRefObject<number>
  humanDeltaRef: React.MutableRefObject<number>
  aiWrite: AnnotationType<boolean>
  selectionInfo: { text: string; cursor: number }
  updateSelectionInfo: () => void
  applySelection: (replacement: string) => void
  insertAt: (text: string, pos: number) => void
  insertAi: (text: string, pos: number) => void
  trackHumanWords: (update: {
    docChanged: boolean
    transactions: Array<{ annotation: (a: AnnotationType<boolean>) => boolean | undefined }>
    changes: { inserted?: string }
  }) => void
  saveContent: (opts?: { silent?: boolean; force?: boolean }) => Promise<void>
  readContent: () => string
  hanCount: number
} {
  const { editorRef, streamingRef } = deps

  const [content, updateContent] = useState('')
  const contentRef = useRef(content)
  const setContent: React.Dispatch<React.SetStateAction<string>> = (next) => {
    const value = typeof next === 'function' ? next(contentRef.current) : next
    contentRef.current = value
    updateContent(value)
  }
  const readContent = () => editorRef.current?.view?.state.doc.toString() ?? contentRef.current
  const [selectionInfo, setSelectionInfo] = useState<{ text: string; cursor: number }>({ text: '', cursor: -1 })
  const selectionRef = useRef({ text: '', cursor: -1 })
  // ============ v0.19.0：字数分离（人类/AI）============
  // 会话增量（ref 累计，保存时上报后清零）；总字数 = 服务端累计 + 会话增量
  const aiDeltaRef = useRef(0)
  const humanDeltaRef = useRef(0)
  const [wordStats, setWordStats] = useState<{ ai: number; human: number }>({ ai: 0, human: 0 })
  // P20（U5）：字数统计 memo（避免每次击键重渲染时 O(n) 扫描）
  const hanCount = useMemo(() => (content.match(/[\u4e00-\u9fff]/g) ?? []).length, [content])

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

  /** 累计 AI 字数 + 同步编辑器内容与选区（applySelection/insertAt/insertAi 共用收尾） */
  const settleEditorWrite = (view: NonNullable<ReactCodeMirrorRef['view']>, inserted: string, pos?: number): void => {
    if (pos !== undefined) {
      view.dispatch({ selection: { anchor: pos } })
    }
    const cjk = countCjk(inserted)
    if (cjk > 0) {
      aiDeltaRef.current += cjk
      setWordStats((s) => ({ ...s, ai: s.ai + cjk }))
    }
    setContent(view.state.doc.toString())
    updateSelectionInfo()
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
    }
    settleEditorWrite(view, replacement, from + replacement.length)
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
    settleEditorWrite(view, text)
  }

  /** AI 写入（标记来源 + 累计 AI 字数）——续写插入/选区工具共用 */
  const insertAi = (text: string, pos: number): void => {
    const view = editorRef.current?.view
    if (!view || !text) return
    const insertPos = Math.min(pos, view.state.doc.length)
    view.dispatch({
      changes: { from: insertPos, insert: text },
      selection: { anchor: insertPos + text.length },
      annotations: aiWrite.of(true)
    })
    settleEditorWrite(view, text)
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

  const { saving, saveContent, saveError, hasConflict, resolveConflict, resolvingConflict } = useChapterSave({ ...deps, content, setContent, readContent, aiDeltaRef, humanDeltaRef,
    onSavedDeltas: (ai, human) => setWordStats(s => ({ ai: Math.max(0, s.ai - ai), human: Math.max(0, s.human - human) })) })

  return {
    content,
    setContent,
    saving,
    saveError,
    hasConflict, resolveConflict, resolvingConflict,
    wordStats,
    setWordStats,
    aiDeltaRef,
    humanDeltaRef,
    aiWrite,
    selectionInfo,
    updateSelectionInfo,
    applySelection,
    insertAt,
    insertAi,
    trackHumanWords,
    saveContent,
    readContent,
    hanCount
  }
}
