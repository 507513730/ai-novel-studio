// P16 P2：统一空状态组件
export function EmptyState({
  icon = '📭',
  title,
  desc,
  action
}: {
  icon?: string
  title: string
  desc?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center', padding: '36px 20px' }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 15, marginBottom: 5 }}>{title}</div>
      {desc && <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>{desc}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}
