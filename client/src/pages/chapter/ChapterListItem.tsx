import { memo } from 'react'
import type { ChapterSummary } from '../../types'

// v0.23.1（批次 E1）：自 ChapterExecutionPage 提取（P22-C1 memo 隔离不变）
// P22-C1：章节页 memo 隔离（100+ 章节时性能）
export const ChapterListItem = memo(function ChapterListItem({
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
