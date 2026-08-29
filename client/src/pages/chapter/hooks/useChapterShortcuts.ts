import { useEffect } from 'react'
import { onShortcut } from '../../../utils/shortcuts'

// v0.26.0（批次 B）：章节页全局键盘/自动保存编排从页面拆出（AGENTS #38 先抽 hook）
// 覆盖：P27 快捷键（保存/生成/审核/回灌/专注模式）、v0.19.0 Cmd+J 续写 + Tab 接受、
// P9 C6 beforeunload 保护、P9 D16 Esc 关浮层、A2 失焦自动保存、P20 U3 30s 定时保存

/** 快捷键与自动保存依赖的动作集合（页面每渲染经 bindActions 注入最新闭包） */
export interface ChapterActionRef {
  saveContent: (o?: { silent?: boolean }) => Promise<void>
  generate: () => Promise<void>
  withBusy: (key: string, fn: () => Promise<void> | void) => Promise<void>
  runReview: () => Promise<void>
  backfill: () => Promise<void>
  suggestContinue: () => Promise<void>
  acceptSuggestion: () => void
  hasSuggestion: () => boolean
}

export function useChapterShortcuts(deps: {
  /** v0.17.0（审查 A5）：快捷键闭包缓存——effect 固定注册，回调经此恒取最新版函数 */
  latestActionsRef: React.RefObject<ChapterActionRef | null>
  /** 每渲染调用，返回最新动作集合（由页面组装 hooks 返回值） */
  bindActions: () => ChapterActionRef
  setFocusMode: React.Dispatch<React.SetStateAction<boolean>>
  closeAllPanels: () => void
  resetSuggestion: () => void
  selectedChapter: number | null
  dirtyRef: React.RefObject<boolean>
  streamingRef: React.RefObject<boolean>
  contentLoadingRef: React.RefObject<boolean>
}): void {
  const { latestActionsRef, bindActions, setFocusMode, closeAllPanels, resetSuggestion, selectedChapter, dirtyRef, streamingRef, contentLoadingRef } = deps
  const saveContent = (o?: { silent?: boolean }): Promise<void> => latestActionsRef.current?.saveContent(o) ?? Promise.resolve()

  // v0.17.0（审查 A5）：每渲染刷新快捷键闭包缓存（effect 固定注册仍取最新实现）
  useEffect(() => {
    latestActionsRef.current = bindActions()
  })

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // P9 D16：Esc 关闭浮动面板（版本历史/待确认/上下文/资源详情）+ 专注模式 + 续写建议
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      closeAllPanels()
      // v0.17.0（审查 A3）：提示文案写了「Esc 退出」，此前 Esc 并不退出专注模式
      setFocusMode(false)
      // v0.19.0：Esc 关闭续写建议
      resetSuggestion()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A2：Ctrl+S 保存（CodeMirror keymap）+ P22-C4 快捷键（生成/审核/回灌）
  useEffect(() => {
    const l = latestActionsRef
    const unsubs = [
      onShortcut('save', () => void l.current?.saveContent().catch(() => undefined)),
      onShortcut('generate', () => void l.current?.generate()),
      onShortcut('review', () => void l.current?.withBusy('review', () => void l.current?.runReview())),
      onShortcut('backfill', () => void l.current?.withBusy('backfill', () => void l.current?.backfill())),
      onShortcut('focus-mode', () => setFocusMode((v) => !v))
    ]
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [selectedChapter])

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
}
