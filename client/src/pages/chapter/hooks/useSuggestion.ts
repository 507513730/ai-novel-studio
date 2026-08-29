import { useRef, useState } from 'react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { novelApi } from '../../../api'

// v0.26.0（批次 B）：光标续写建议从页面拆出（AGENTS #38 先抽 hook）——
// 行为与 v0.19.0/v0.21.0 保持一致：abort 控制 + seq 校验防跨章串内容
export interface SuggestionState {
  text: string
  pos: number
}

export function useSuggestion(options: {
  novelId: number
  editorRef: React.RefObject<ReactCodeMirrorRef | null>
  selectedChapterRef: React.RefObject<number | null>
  selectedChapter: number | null
  streaming: boolean
  insertAi: (text: string, pos: number) => void
  onActionError: (msg: string | null) => void
}): {
  suggestion: SuggestionState | null
  setSuggestion: (s: SuggestionState | null) => void
  sugBusy: boolean
  suggestContinue: () => Promise<void>
  acceptSuggestion: () => void
  resetSuggestion: () => void
  hasSuggestion: () => boolean
} {
  const { novelId, editorRef, selectedChapterRef, selectedChapter, streaming, insertAi, onActionError } = options
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null)
  const [sugBusy, setSugBusy] = useState(false)
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
    onActionError(null)
    try {
      const r = await novelApi.aiAction(novelId, capturedChapter, { action: 'continue', cursorPosition: pos }, ctrl.signal)
      if (seq !== sugSeqRef.current || selectedChapterRef.current !== capturedChapter) return
      setSuggestion({ text: r.content, pos: r.appliedAt ?? pos })
    } catch (err) {
      if (ctrl.signal.aborted) return
      if (seq === sugSeqRef.current) onActionError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === sugSeqRef.current) setSugBusy(false)
    }
  }

  const acceptSuggestion = (): void => {
    if (!suggestion) return
    insertAi(suggestion.text, suggestion.pos)
    setSuggestion(null)
  }

  // 切章/关浮层时调用：中止在途请求 + seq 失效 + 清建议
  const resetSuggestion = (): void => {
    sugAbortRef.current?.abort()
    sugSeqRef.current++
    setSuggestion(null)
  }

  const hasSuggestion = (): boolean => suggestion !== null

  return { suggestion, setSuggestion, sugBusy, suggestContinue, acceptSuggestion, resetSuggestion, hasSuggestion }
}
