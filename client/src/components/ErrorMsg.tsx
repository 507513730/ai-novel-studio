// P8-3：统一错误提示；P12 B5：支持重试按钮
export function ErrorMsg({
  error,
  marginTop = 0,
  onRetry
}: {
  error: string | null
  marginTop?: number
  onRetry?: () => void
}): React.JSX.Element | null {
  if (!error) return null
  return (
    <div className="row" style={{ marginTop, alignItems: 'flex-start', gap: 8 }}>
      <div className="error-msg" style={{ flex: 1 }}>
        {error}
      </div>
      {onRetry && (
        <button className="sm" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  )
}
