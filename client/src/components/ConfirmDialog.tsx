import { useEffect, useRef } from 'react'

// P13 F1：确认对话框（替代 window.confirm，暗色主题化 + Esc/遮罩关闭）

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}

interface ConfirmDialogProps {
  options: ConfirmOptions
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ options, onConfirm, onCancel }: ConfirmDialogProps): React.JSX.Element {
  // v0.17.0（审查 C33）：onCancel 经 ref 取最新值——监听只注册一次，父组件 inline 箭头不再反复拆装
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancelRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--z-modal)',
        padding: 24
      }}
      onClick={onCancel}
    >
      <div
        className="panel"
        style={{
          maxWidth: 420,
          width: '100%',
          background: 'var(--bg-panel)',
          boxShadow: 'var(--shadow-lg)',
          animation: 'fade-in-up 150ms ease'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{options.title}</div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>{options.message}</div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel}>取消</button>
          <button
            className={options.danger ? 'danger' : 'primary'}
            autoFocus
            onClick={() => {
              onConfirm()
              onCancel()
            }}
          >
            {options.confirmText ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}
