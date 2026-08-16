import { useCallback, useRef, useState } from 'react'

// v0.23.1（批次 E3）：共享操作防重 hook——抽取 ChapterExecutionPage withBusy 的 ref 守卫语义
// （v0.17.0 审查 A2：state 更新前的同帧双击会绕过 `if (busy)` 检查——ref 同步置位防 TOCTOU）。
// 此前 VolumePanel/SetupPanel/TasksPage 等各持一份 state-only 实现（同帧双击可双跑）。
export interface ActionRunOptions {
  onError?: (message: string) => void
  onDone?: () => void | Promise<void>
  onStart?: () => void
}

export function useActionRun(opts: ActionRunOptions = {}): {
  busy: string | null
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>
  isBusy: () => boolean
} {
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef<string | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const run = useCallback(async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = key
    setBusy(key)
    optsRef.current.onStart?.()
    try {
      await fn()
      await optsRef.current.onDone?.()
    } catch (err) {
      optsRef.current.onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }, [])
  return { busy, run, isBusy: () => busyRef.current !== null }
}
