// 章节正文加载 hook（重构计划 R7 / spec：按需详情加载 + 竞态序号丢弃过期响应）。
// 契约（P9 A1 + R7）：
// - 正文仅经独立详情端点按需加载（列表不带 content）
// - 快速切章：序号（detailSeqRef）丢弃过期响应，只有最新一次落定
// - 切章重置：内容/已存快照/脏标记/会话字数/续写建议/版本 diff
import { useEffect, useRef, useState } from 'react'
import { novelApi } from '../../../api'

export interface ChapterLoaderDeps {
  novelId: number
  selectedChapter: number | null
  setContent: React.Dispatch<React.SetStateAction<string>>
  savedContentRef: React.MutableRefObject<string>
  dirtyRef: React.MutableRefObject<boolean>
  loadedChapterRef: React.MutableRefObject<number | null>
  // 协调管道：session.saveContent 读取；生成期间挂起
  contentLoadingRef: React.MutableRefObject<boolean>
  // 切章时的会话侧重置（字数统计/续写建议/版本 diff——归属各自的 hook/页面）
  resetSessionBits: () => void
  onSwitchError: (msg: string) => void
}

export function useChapterLoader(deps: ChapterLoaderDeps): {
  contentLoading: boolean
  contentLoadingRef: React.MutableRefObject<boolean>
} {
  const {
    novelId,
    selectedChapter,
    setContent,
    savedContentRef,
    dirtyRef,
    loadedChapterRef,
    contentLoadingRef,
    resetSessionBits,
    onSwitchError
  } = deps
  const [contentLoading, setContentLoading] = useState(false)
  const detailSeqRef = useRef(0)

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
    resetSessionBits()
    void novelApi
      .chapterDetail(novelId, selectedChapter)
      .then((d) => {
        if (seq !== detailSeqRef.current) return
        setContent(d.chapter.content ?? '')
        savedContentRef.current = d.chapter.content ?? ''
        loadedChapterRef.current = selectedChapter
      })
      .catch((err) => {
        if (seq !== detailSeqRef.current) return
        onSwitchError(`正文加载失败：${err instanceof Error ? err.message : String(err)}（重新选择章节可重试）`)
      })
      .finally(() => {
        if (seq === detailSeqRef.current) {
          contentLoadingRef.current = false
          setContentLoading(false)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChapter])

  return { contentLoading, contentLoadingRef }
}
