import React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** v0.25.0（审查 L2）：出错区域名称（如「章节执行」），用于错误提示文案 */
  name?: string
  /** v0.25.0（审查 L2）：该值变化时自动复位（路由切换即恢复，不必重载应用） */
  resetKey?: unknown
}

interface ErrorBoundaryState {
  hasError: boolean
  message: string
  resetKey: unknown
}

// E3：错误兜底
// v0.25.0（审查 L2）：支持 name + resetKey——此前仅 root 一层、无复位能力，
// 任一页面抛错即整应用白屏且只能刷新（未保存章节正文丢失）。
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, message: '', resetKey: props.resetKey }
  }

  static getDerivedStateFromError(err: unknown): Partial<ErrorBoundaryState> {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) }
  }

  // resetKey 变化（路由切换）→ 自动清除错误态；未变化时保持，避免吞掉错误
  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, message: '', resetKey: props.resetKey }
    }
    return null
  }

  private reset = (): void => {
    this.setState({ hasError: false, message: '' })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      const label = this.props.name ? `「${this.props.name}」` : ''
      return (
        <div style={{ padding: 40 }} className="panel">
          <h2>{label}页面出错了</h2>
          <p className="muted">{this.state.message}</p>
          <p className="muted t-small">
            其余页面不受影响——可继续从左侧导航切换。若正文中尚有未保存内容，请先重试页面再手动保存。
          </p>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="primary" onClick={this.reset}>
              重试此页
            </button>
            <button onClick={() => window.location.reload()}>重新加载应用</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
