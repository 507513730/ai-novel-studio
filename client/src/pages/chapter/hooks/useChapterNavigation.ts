import { useRef } from 'react'
import { useChapterIdentity } from './useChapterIdentity'

export function useChapterNavigation(options: {
  novelId: number
  selectedChapter: number | null
  streamingRef: React.RefObject<boolean>
  saveContent: (opts?: { silent?: boolean; force?: boolean }) => Promise<void>
  onSelect: (chapterId: number) => void
  onError: (message: string) => void
  onStreaming: () => void
  canLeaveWithoutSave?: () => boolean
  onReload?: () => void
}) {
  const identity = useChapterIdentity(options.novelId, options.selectedChapter)
  const requestSeq = useRef(0)
  const selectChapter = async (chapterId: number): Promise<void> => {
    const seq = ++requestSeq.current
    const origin = identity.capture()
    if (options.streamingRef.current) { options.onStreaming(); return }
    if (chapterId === options.selectedChapter) {
      if (options.canLeaveWithoutSave?.()) options.onReload?.()
      return
    }
    try {
      if (!options.canLeaveWithoutSave?.()) await options.saveContent({ silent: true })
      if (seq !== requestSeq.current || !identity.isActive(origin)) return
      if (options.streamingRef.current) { options.onStreaming(); return }
      identity.invalidate()
      options.onSelect(chapterId)
    } catch {
      if (seq === requestSeq.current && identity.isActive(origin)) options.onError('保存失败，已中断切换，请重试')
    }
  }
  return { selectChapter }
}
