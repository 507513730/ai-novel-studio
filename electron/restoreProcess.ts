import { utilityProcess } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getServerProcess } from './state'

export function validateRestoreCopy(source: string, output: string): Promise<void> {
  const worker = utilityProcess.fork(join(__dirname, 'server.js'), [], {
    env: { ...process.env as Record<string, string>, AI_NOVEL_RESTORE_SOURCE: source, AI_NOVEL_RESTORE_OUTPUT: output },
    serviceName: 'ai-novel-restore-validation', stdio: 'pipe'
  })
  // 消费输出但不向日志转发库内容或迁移错误。
  worker.stdout?.resume()
  worker.stderr?.resume()
  return new Promise((resolve, reject) => {
    let verified = false
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; worker.kill() }, 60_000)
    worker.on('message', (message) => { verified = message?.type === 'restore-validated' })
    worker.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0 && verified && !timedOut) resolve()
      else reject(new Error(timedOut ? '备份校验超时，原数据未更改' : '备份校验失败：数据库损坏、结构不兼容或版本过新，原数据未更改'))
    })
  })
}

export function waitForServerReady(start: () => Electron.UtilityProcess, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = start()
    const timer = setTimeout(() => finish(new Error('恢复后服务启动超时')), timeoutMs)
    function finish(error?: Error): void {
      clearTimeout(timer)
      server.off('message', onMessage)
      server.off('exit', onExit)
      if (error) reject(error)
      else resolve()
    }
    function onMessage(message: { type?: string; port?: number }): void {
      if (message?.type === 'ready' && typeof message.port === 'number') finish()
      else if (message?.type === 'error') finish(new Error('恢复后服务启动失败'))
    }
    function onExit(): void { finish(new Error('恢复后服务提前退出')) }
    server.on('message', onMessage)
    server.once('exit', onExit)
  })
}

export function activateRestoredServer(): Promise<void> {
  const server = getServerProcess()
  if (!server) return Promise.reject(new Error('恢复服务已退出；原库副本已保留，请重启应用'))
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const timer = setTimeout(() => finish(new Error('恢复已提交，服务激活超时；请重启应用')), 10_000)
    function finish(error?: Error): void {
      clearTimeout(timer)
      server!.off('message', onMessage)
      server!.off('exit', onExit)
      if (error) reject(error)
      else resolve()
    }
    function onExit(): void { finish(new Error('恢复服务已退出，请重启应用')) }
    function onMessage(message: { type?: string; id?: string }): void {
      if (message?.type === 'activated' && message.id === id) finish()
    }
    server.on('message', onMessage)
    server.once('exit', onExit)
    try { server.postMessage({ type: 'activate-restored', id }) }
    catch { finish(new Error('恢复已提交，请重启应用完成激活')) }
  })
}
