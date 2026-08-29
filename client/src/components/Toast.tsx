import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// P8-5：轻量全局 toast（操作反馈：成功/错误/信息）
type ToastType = 'ok' | 'error' | 'info'
interface Toast {
  id: number
  type: ToastType
  text: string
}

// P9 B6：模块级广播（供 unhandledrejection 等非组件环境使用）
let globalListener: ((type: ToastType, text: string) => void) | null = null
export function toastGlobal(type: ToastType, text: string): void {
  globalListener?.(type, text)
}

const ToastContext = createContext<{ toast: (type: ToastType, text: string) => void }>({
  toast: () => undefined
})

export function useToast(): { toast: (type: ToastType, text: string) => void } {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  // v0.17.0（审查 C34）：记录定时器，卸载时清理（此前 setTimeout 无 cleanup）
  const timersRef = useRef<number[]>([])

  const toast = useCallback((type: ToastType, text: string): void => {
    const id = ++seq.current
    // P22-C6：堆叠上限 3 条（连发不铺满屏幕）
    setToasts((t) => [...t, { id, type, text }].slice(-3))
    const timer = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((x) => x !== timer)
      setToasts((t) => t.filter((x) => x.id !== id))
    }, 3000)
    timersRef.current.push(timer)
  }, [])

  useEffect(() => {
    globalListener = toast
    return () => {
      // v0.17.0（审查 C34）：卸载时清掉未到期的消失定时器
      for (const t of timersRef.current) clearTimeout(t)
      timersRef.current = []
      globalListener = null
    }
  }, [toast])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        // v0.17.0（审查 C34）：aria-live 让读屏器播报 toast
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 'var(--z-toast)'
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: '10px 16px',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--fs-13)',
              background: 'var(--bg-elevated)',
              border: `1px solid ${
                t.type === 'ok' ? 'var(--ok)' : t.type === 'error' ? 'var(--danger)' : 'var(--border)'
              }`,
              color: t.type === 'ok' ? 'var(--ok)' : t.type === 'error' ? 'var(--danger)' : 'var(--text)',
              boxShadow: 'var(--shadow-lg)',
              maxWidth: 360,
              animation: 'toast-in 200ms ease'
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
