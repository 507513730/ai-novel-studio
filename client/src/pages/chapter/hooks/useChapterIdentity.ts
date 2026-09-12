import { useCallback, useEffect, useRef } from 'react'

export interface ChapterIdentity {
  novelId: number
  chapterId: number | null
  epoch: number
}

export function useChapterIdentity(novelId: number, chapterId: number | null) {
  const current = useRef<ChapterIdentity>({ novelId, chapterId, epoch: 0 })
  const mounted = useRef(true)
  if (current.current.novelId !== novelId || current.current.chapterId !== chapterId) {
    current.current = { novelId, chapterId, epoch: current.current.epoch + 1 }
  }
  const capture = useCallback((): ChapterIdentity => ({ ...current.current }), [])
  const invalidate = useCallback(() => { current.current = { ...current.current, epoch: current.current.epoch + 1 } }, [])
  const isActive = useCallback((value: ChapterIdentity) => mounted.current &&
    value.novelId === current.current.novelId && value.chapterId === current.current.chapterId &&
    value.epoch === current.current.epoch, [])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; invalidate() }
  }, [invalidate])
  return { capture, isActive, invalidate }
}
