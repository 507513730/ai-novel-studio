import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
const state = vi.hoisted(() => ({ server: null as any, fork: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: state.fork } }))
vi.mock('../electron/state', () => ({ getServerProcess: () => state.server }))
import { activateRestoredServer, validateRestoreCopy, waitForServerReady } from '../electron/restoreProcess'

function worker() {
  const process = Object.assign(new EventEmitter(), { kill: vi.fn(), postMessage: vi.fn() })
  state.server = process
  return process
}
afterEach(() => vi.useRealTimers())

describe('恢复独立进程确认', () => {
  it('校验成功消息不足以放行，必须等进程关闭', async () => {
    const process = worker()
    state.fork.mockReturnValue(process)
    const pending = validateRestoreCopy('source', 'output')
    let done = false
    void pending.then(() => { done = true })
    process.emit('message', { type: 'restore-validated' })
    await Promise.resolve()
    expect(done).toBe(false)
    process.emit('exit', 0)
    await pending
  })
  it('零退出缺少成功应答也拒绝', async () => {
    const process = worker()
    state.fork.mockReturnValue(process)
    const pending = validateRestoreCopy('source', 'output')
    process.emit('exit', 0)
    await expect(pending).rejects.toThrow('校验失败')
  })
  it.each(['error', 'exit', 'timeout'])('新服务 %s 不当作成功', async kind => {
    vi.useFakeTimers()
    const process = worker()
    const pending = waitForServerReady(() => process as never, 50)
    const rejected = expect(pending).rejects.toThrow()
    if (kind === 'error') process.emit('message', { type: 'error' })
    if (kind === 'exit') process.emit('exit', 1)
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(50)
    await rejected
    expect(process.listenerCount('message')).toBe(0)
    expect(process.listenerCount('exit')).toBe(0)
  })
  it('ready 必须带监听端口', async () => {
    const process = worker()
    const pending = waitForServerReady(() => process as never)
    process.emit('message', { type: 'ready' })
    expect(process.listenerCount('message')).toBe(1)
    process.emit('message', { type: 'ready', port: 12345 })
    await pending
    expect(process.listenerCount('message')).toBe(0)
  })
  it('激活只消费本次请求确认', async () => {
    const process = worker()
    const pending = activateRestoredServer()
    const [{ id }] = process.postMessage.mock.calls[0]
    process.emit('message', { type: 'activated', id: 'stale' })
    expect(process.listenerCount('message')).toBe(1)
    process.emit('message', { type: 'activated', id })
    await pending
    expect(process.listenerCount('message')).toBe(0)
  })
})
