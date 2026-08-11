import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'

// P16 P2 + P23 批0：统一空状态组件
// icon 用 lucide 组件（不用 emoji 字符串——杜绝编码/渲染成 "?" 的问题）
export function EmptyState({
  icon: Icon = Inbox,
  title,
  desc,
  action
}: {
  icon?: LucideIcon
  title: string
  desc?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center', padding: '36px 20px' }}>
      <div style={{ fontSize: 36, marginBottom: 10, display: 'flex', justifyContent: 'center', opacity: 0.5 }}>
        <Icon size={36} />
      </div>
      <div style={{ fontSize: 15, marginBottom: 5 }}>{title}</div>
      {desc && <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>{desc}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}
