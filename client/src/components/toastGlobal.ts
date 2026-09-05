import { createContext, useContext } from 'react'

export type ToastType = 'ok' | 'error' | 'info'
export type Notify = (type: ToastType, text: string) => void
export const ToastContext = createContext<{ toast: Notify }>({ toast: () => undefined })

let globalListener: Notify | null = null
export function bindGlobalToast(listener: Notify): () => void {
  globalListener = listener
  return () => { if (globalListener === listener) globalListener = null }
}
export function toastGlobal(type: ToastType, text: string): void { globalListener?.(type, text) }
export function useToast(): { toast: Notify } { return useContext(ToastContext) }
