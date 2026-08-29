// 优雅关闭（重构计划 R8）：checkpoint 请求与 server 进程优雅退出的唯一实现。
// 契约：shutdown = 通知 shutdown → 等退出（超时 kill 兜底）→ 清理 URL（Windows 孤儿进程防线，审查 H6）。
import { getServerProcess, setLastServerUrl, setServerProcess } from './state'

/** 请求 server 执行 WAL checkpoint（等待应答或超时兜底）——v0.17.0（审查 M15）自动备份/导出备份共用 */
export function requestCheckpoint(timeoutMs = 5000): Promise<void> {
  const sp = getServerProcess()
  if (!sp) return Promise.resolve()
  const spRef: NonNullable<typeof sp> = sp
  return new Promise<void>((resolve) => {
    const id = `cp-${Date.now()}`
    const timer = setTimeout(() => {
      try {
        sp.off('message', onMsg)
      } catch {
        /* ignore */
      }
      resolve()
    }, timeoutMs)
    function onMsg(msg: unknown): void {
      const m = msg as { type?: string; id?: string }
      if (m?.id === id && (m.type === 'checkpoint-done' || m.type === 'checkpoint-error')) {
        clearTimeout(timer)
        try {
          spRef.off('message', onMsg)
        } catch {
          /* ignore */
        }
        resolve()
      }
    }
    spRef.on('message', onMsg)
    spRef.postMessage({ type: 'checkpoint', id })
  })
}

/** v0.17.0（审查 H6/M17/M18）：优雅关闭 server（通知 shutdown → 等退出 → kill 兜底）并清缓存 */
export function shutdownServer(timeoutMs = 3000): Promise<void> {
  const sp = getServerProcess()
  setServerProcess(null)
  setLastServerUrl(null)
  if (!sp) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        sp.kill()
      } catch {
        /* ignore */
      }
      resolve()
    }, timeoutMs)
    try {
      sp.postMessage({ type: 'shutdown' })
    } catch {
      clearTimeout(timer)
      try {
        sp.kill()
      } catch {
        /* ignore */
      }
      resolve()
      return
    }
    sp.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
