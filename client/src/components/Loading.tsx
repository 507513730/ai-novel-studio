// v0.26.0（审查 P1-1）：统一加载占位——此前 23 处「加载中…」纯文字（统计页数据慢时整页空白无指示）
export function Loading({ label = '加载中…', lines = 3 }: { label?: string; lines?: number }): React.JSX.Element {
  const widths = ['62%', '86%', '48%', '74%']
  return (
    <div className="col gap-2" role="status" aria-live="polite" aria-label={label} style={{ padding: '4px 0' }}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton skeleton-text" style={{ width: widths[i % widths.length] }} />
      ))}
      <span className="muted t-small">{label}</span>
    </div>
  )
}
