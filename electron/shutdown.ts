import { randomUUID } from 'node:crypto'
import { getServerProcess, setLastServerUrl, setServerProcess } from './state'

export function requestBackupSnapshot(destination: string, timeoutMs = 30_000): Promise<void> {
  const server = getServerProcess()
  if (!server) return Promise.reject(new Error('备份失败：服务未就绪'))
  return new Promise<void>((resolve, reject) => {
    const id = randomUUID()
    const timer = setTimeout(() => finish(new Error('备份超时：未收到快照完成确认')), timeoutMs)
    function finish(error?: Error): void {
      clearTimeout(timer)
      server!.off('message', onMessage)
      server!.off('exit', onExit)
      if (error) reject(error)
      else resolve()
    }
    function onExit(): void { finish(new Error('备份失败：服务已退出')) }
    function onMessage(value: unknown): void {
      const message = value as { id?: string; type?: string; error?: string } | null
      if (message?.id !== id) return
      if (message.type === 'backup-done') finish()
      else if (message.type === 'backup-error') finish(new Error(message.error || '备份快照失败'))
    }
    server.on('message', onMessage)
    server.once('exit', onExit)
    try { server.postMessage({ type: 'backup-snapshot', id, destination }) }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
  })
}

let shutdownPromise: Promise<void> | null = null

export function shutdownServer(timeoutMs = 3000): Promise<void> {
  if (shutdownPromise) return shutdownPromise
  const server = getServerProcess()
  setServerProcess(null)
  setLastServerUrl(null)
  if (!server) return Promise.resolve()
  const pending = new Promise<void>((resolve, reject) => {
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(forceStop, timeoutMs)
    function finish(error?: Error): void {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      server!.off('exit', onExit)
      if (error) reject(error)
      else resolve()
    }
    function onExit(code: number): void {
      finish(code === 0 ? undefined : new Error('服务异常退出，未执行数据替换'))
    }
    function forceStop(): void {
      clearTimeout(timer)
      killTimer = setTimeout(() => finish(new Error('未确认服务退出，禁止替换数据')), 2000)
      try { server!.kill() }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    }
    server.once('exit', onExit)
    try { server.postMessage({ type: 'shutdown' }) }
    catch { forceStop() }
  })
  shutdownPromise = pending.finally(() => { shutdownPromise = null })
  return shutdownPromise
}
