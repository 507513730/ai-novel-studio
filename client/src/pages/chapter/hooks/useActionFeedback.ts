import { useRef, useState } from 'react'

// v0.26.0（批次 B）：动作反馈原语（busy 锁/非静默提示/错误位）——session 与 actions 的公共底层，
// 拆出以解「session 需要 notify、actions 需要 content」的循环依赖（AGENTS #38 先抽 hook）
export interface ActionFeedback {
  actionBusy: string | null
  actionMsg: string | null
  actionError: string | null
  setActionError: (msg: string | null) => void
  notify: (msg: string) => void
  withBusy: (key: string, fn: () => Promise<void> | void) => Promise<void>
}

export function useActionFeedback(): ActionFeedback {
  // v0.17.0（审查 A2）：withBusy 用 ref 做 TOCTOU 守卫（state 更新前双击会双跑）
  const actionBusyRef = useRef<string | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // 非静默结果提示（保存/生成/动作完成；2s 自动清除）
  const notify = (msg: string): void => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(null), 2000)
  }

  // P9 B1：per-action busy 锁（防重复提交）
  const withBusy = async (key: string, fn: () => Promise<void> | void): Promise<void> => {
    if (actionBusyRef.current) return
    actionBusyRef.current = key
    setActionBusy(key)
    try {
      await fn()
    } finally {
      actionBusyRef.current = null
      setActionBusy(null)
    }
  }

  return { actionBusy, actionMsg, actionError, setActionError, notify, withBusy }
}
