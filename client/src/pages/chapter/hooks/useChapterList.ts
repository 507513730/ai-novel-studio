import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { novelApi, apiFetch } from '../../../api'
import type { ChapterSummary } from '../../../types'

// v0.26.0（批次 B）：章节列表数据采集从页面拆出（AGENTS #38 先抽 hook）——
// 列表查询/派生统计/字数分离展示/初始选中，行为与拆分前一致
export function useChapterList(options: {
  novelId: number
  selectedChapter: number | null
  selectedChapterRef: React.RefObject<number | null>
  onSelect: (id: number) => void
  wordStats: { ai: number; human: number }
}): {
  list: ChapterSummary[]
  chapter: ChapterSummary | undefined
  chapterIdx: number
  chapterStats: { total: number; written: number; failed: number; remaining: number }
  statsShow: { ai: number; human: number }
  quickWords: Record<string, string>
  isLoading: boolean
  error: unknown
} {
  const { novelId, selectedChapter, selectedChapterRef, onSelect, wordStats } = options

  const chapters = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => novelApi.chapters(novelId)
  })
  // v0.24.4（A2）：快捷词词典（编辑器 ";" 补全）——设置页维护，60s 缓存
  const writingSettings = useQuery({
    queryKey: ['writing-settings'],
    queryFn: () => apiFetch('/settings/writing') as Promise<{ quickWords?: Record<string, string> }>,
    staleTime: 60_000
  })
  // v0.25.0（审查 L1）：memo 化——此前 `?? []` 每次渲染都产生新数组引用，
  // 导致依赖 list 的 useMemo（chapterStats）与 useEffect（初始选中）每渲染都重跑
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
      onSelect(first.id)
      // v0.21.0（审查 N2）：初始选中同步 ref
      selectedChapterRef.current = first.id
    }
  }, [list, selectedChapter, onSelect, selectedChapterRef])

  return { list, chapter, chapterIdx, chapterStats, statsShow, quickWords: writingSettings.data?.quickWords ?? {}, isLoading: chapters.isLoading, error: chapters.isError ? chapters.error : null }
}
