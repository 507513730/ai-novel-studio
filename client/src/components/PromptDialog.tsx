import { useEffect, useRef, useState } from 'react'

// ============================================================
// P27 0b：应用内输入对话框（替代 window.prompt——Electron 下不弹窗）
// 与 ConfirmDialog 同套视觉；返回 Promise<string | null>
// ============================================================

export function usePrompt(): {
  prompt: (opts: { title: string; defaultValue?: string; placeholder?: string; confirmLabel?: string }) => Promise<string | null>
  element: React.JSX.Element | null
} {
  const [state, setState] = useState<{
    title: string
    defaultValue: string
    placeholder: string
    confirmLabel: string
    resolve: (v: string | null) => void
  } | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const stateRef = useRef<{ resolve: (v: string | null) => void } | null>(null)

  useEffect(() => {
    if (state) {
      setValue(state.defaultValue ?? '')
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [state])

  // v0.9.0（审查 C）：prompt 前先 resolve 上一个（防连续调用悬挂 promise）；close 统一经 stateRef
  const prompt = (opts: { title: string; defaultValue?: string; placeholder?: string; confirmLabel?: string }): Promise<string | null> =>
    new Promise((resolve) => {
      stateRef.current?.resolve(null)
      const entry: {
        title: string
        defaultValue: string
        placeholder: string
        confirmLabel: string
        resolve: (v: string | null) => void
      } = {
        title: opts.title,
        defaultValue: opts.defaultValue ?? '',
        placeholder: opts.placeholder ?? '',
        confirmLabel: opts.confirmLabel ?? '确定',
        resolve: (v) => {
          stateRef.current = null
          resolve(v)
        }
      }
      stateRef.current = entry
      setState(entry)
    })

  const close = (result: string | null): void => {
    stateRef.current?.resolve(result)
    stateRef.current = null
    setState(null)
  }

  const element = state ? (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={() => close(null)}
    >
      <div
        className="panel"
        style={{ width: 380, background: 'var(--bg-elevated)', padding: 16 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={state.title}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{state.title}</div>
        <input
          ref={inputRef}
          style={{ width: '100%', boxSizing: 'border-box' }}
          value={value}
          placeholder={state.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') close(value)
            if (e.key === 'Escape') close(null)
          }}
        />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="sm" onClick={() => close(null)}>
            取消
          </button>
          <button className="sm primary" onClick={() => close(value)} disabled={!value.trim()}>
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { prompt, element }
}
