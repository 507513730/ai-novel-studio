import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const state = vi.hoisted(() => ({ server: null as any }))
vi.mock('../electron/state', () => ({
  getServerProcess: () => state.server, setServerProcess: vi.fn(), setLastServerUrl: vi.fn()
}))
import { requestBackupSnapshot, shutdownServer } from '../electron/shutdown'
import { BACKUP_DB, BACKUP_PENDING, createBackupDirectory, listAutoBackups, removeAutoBackup, resolveBackupDirectory } from '../electron/backup'
import { handleUtilityCommand } from '../server/src/services/utilityCommands'

beforeEach(() => { state.server = null })
afterEach(() => { vi.useRealTimers() })

function fakeServer() {
  const server = new EventEmitter() as EventEmitter & { postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }
  server.postMessage = vi.fn()
  server.kill = vi.fn()
  state.server = server
  return server
}

describe('快照应答协议', () => {
  it('服务未启动时拒绝', async () => {
    await expect(requestBackupSnapshot('unused')).rejects.toThrow('服务未就绪')
  })
  it('不同请求必须使用不同 ID，只消费自己的应答并清理监听', async () => {
    const server = fakeServer()
    const first = requestBackupSnapshot('a')
    const second = requestBackupSnapshot('b')
    const [a, b] = server.postMessage.mock.calls.map(([message]) => message)
    expect(a.id).not.toBe(b.id)
    server.emit('message', { id: 'unrelated', type: 'backup-done' })
    expect(server.listenerCount('message')).toBe(2)
    server.emit('message', { id: b.id, type: 'backup-done' })
    server.emit('message', { id: a.id, type: 'backup-done' })
    await Promise.all([first, second])
    expect(server.listenerCount('message')).toBe(0)
    expect(server.listenerCount('exit')).toBe(0)
  })
  it.each(['reply-error', 'exit', 'send-error'])('失败不得伪装成功：%s', async (kind) => {
    const server = fakeServer()
    if (kind === 'send-error') server.postMessage.mockImplementation(() => { throw Error('发送失败') })
    const promise = requestBackupSnapshot('a')
    const rejected = expect(promise).rejects.toThrow()
    if (kind === 'exit') server.emit('exit', 1)
    if (kind === 'reply-error') server.emit('message', { id: server.postMessage.mock.calls[0][0].id, type: 'backup-error', error: '快照失败' })
    await rejected
    expect(server.listenerCount('message')).toBe(0)
    expect(server.listenerCount('exit')).toBe(0)
  })
  it('超时拒绝，迟到成功应答不能改变失败结果', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const promise = requestBackupSnapshot('a', 100)
    const rejected = expect(promise).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(100)
    await rejected
    server.emit('message', { id: server.postMessage.mock.calls[0][0].id, type: 'backup-done' })
    expect(server.listenerCount('message')).toBe(0)
  })
})

describe('关闭协议', () => {
  it('发送命令前注册退出监听，立即退出也不会丢失', async () => {
    const server = fakeServer()
    server.postMessage.mockImplementation(() => server.emit('exit', 0))
    await shutdownServer()
    expect(server.listenerCount('exit')).toBe(0)
  })
  it('并发关闭共享同一等待，不会提前放行第二个恢复请求', async () => {
    const server = fakeServer()
    const first = shutdownServer()
    const second = shutdownServer()
    expect(first).toBe(second)
    expect(server.postMessage).toHaveBeenCalledOnce()
    server.emit('exit', 0)
    await Promise.all([first, second])
  })
  it('kill 请求发出后仍须等待实际退出', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const promise = shutdownServer(10)
    let settled = false
    void promise.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(10)
    expect(server.kill).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    server.emit('exit', 0)
    await promise
    expect(server.listenerCount('exit')).toBe(0)
  })
  it('异常退出拒绝后续数据替换', async () => {
    const server = fakeServer()
    const promise = shutdownServer()
    server.emit('exit', 1)
    await expect(promise).rejects.toThrow('异常退出')
  })
})

describe('备份目录安全与一致性', () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'novel-backup-test-'))
    const data = join(root, 'data')
    mkdirSync(data)
    writeFileSync(join(data, BACKUP_DB), 'source sentinel')
    return { root, data }
  }
  it('拒绝现有目标与活动数据目录，不删除哨兵文件', async () => {
    const { root, data } = fixture()
    const target = join(root, 'documents')
    mkdirSync(target)
    writeFileSync(join(target, 'user.txt'), 'keep')
    const snapshot = vi.fn()
    await expect(createBackupDirectory(data, target, 'test', false, snapshot)).rejects.toThrow()
    await expect(createBackupDirectory(data, data, 'test', false, snapshot)).rejects.toThrow()
    await expect(createBackupDirectory(data, root, 'test', false, snapshot)).rejects.toThrow()
    expect(readFileSync(join(target, 'user.txt'), 'utf8')).toBe('keep')
    expect(readFileSync(join(data, BACKUP_DB), 'utf8')).toBe('source sentinel')
    expect(snapshot).not.toHaveBeenCalled()
  })
  it('快照失败保留进行中标记，不生成成功 manifest', async () => {
    const { root, data } = fixture()
    const target = join(root, 'failed')
    await expect(createBackupDirectory(data, target, 'test', false, async () => { throw Error('injected') })).rejects.toThrow('injected')
    expect(existsSync(join(target, BACKUP_PENDING))).toBe(true)
    expect(existsSync(join(target, 'backup-info.json'))).toBe(false)
  })
  it('恢复拒绝未完成目录，不误退回父目录的备份', () => {
    const { root, data } = fixture()
    const incomplete = join(data, 'incomplete')
    mkdirSync(incomplete)
    writeFileSync(join(incomplete, BACKUP_PENDING), '{}')
    expect(() => resolveBackupDirectory(incomplete)).toThrow('备份未完成')
    const empty = join(data, 'empty')
    mkdirSync(empty)
    expect(() => resolveBackupDirectory(empty)).toThrow('不是有效备份')
    expect(resolveBackupDirectory(join(data, BACKUP_DB))).toBe(data)
    expect(() => resolveBackupDirectory(root)).toThrow('不是有效备份')
  })
  it('轮转仅删除受管备份，保留夹带的用户文件与未知目录', async () => {
    const { root, data } = fixture()
    const snapshot = async (path: string) => { writeFileSync(path, 'snapshot') }
    const managed = join(root, 'auto-20260905-0100')
    const mixed = join(root, 'auto-20260905-0200')
    await createBackupDirectory(data, managed, 'test', true, snapshot)
    await createBackupDirectory(data, mixed, 'test', true, snapshot)
    writeFileSync(join(mixed, 'user.txt'), 'keep')
    expect(listAutoBackups(root)).toEqual(['auto-20260905-0100'])
    removeAutoBackup(mixed)
    expect(readFileSync(join(mixed, 'user.txt'), 'utf8')).toBe('keep')
    removeAutoBackup(managed)
    expect(existsSync(managed)).toBe(false)
  })
  it('从真实 WAL 生成快照，包含未 checkpoint 数据且独立于后续写入', async () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-snapshot-test-'))
    const data = join(root, 'data')
    mkdirSync(data)
    const db = new DatabaseSync(join(data, BACKUP_DB), { timeout: 5000 })
    try {
      db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE chapter(id INTEGER PRIMARY KEY, content TEXT); INSERT INTO chapter VALUES(1, 'before')")
      const target = join(root, 'snapshot')
      await createBackupDirectory(data, target, 'test', false, async (destination) => {
        const reply = vi.fn()
        handleUtilityCommand({ data: { type: 'backup-snapshot', id: 'test', destination } }, db, reply, vi.fn())
        expect(reply).toHaveBeenCalledWith({ type: 'backup-done', id: 'test' })
      })
      db.exec("INSERT INTO chapter VALUES(2, 'after')")
      const copy = new DatabaseSync(join(target, BACKUP_DB), { readOnly: true, timeout: 5000 })
      try {
        expect(copy.prepare('SELECT count(*) AS n FROM chapter').get()?.n).toBe(1)
        expect(Object.values(copy.prepare('PRAGMA quick_check').get()!)).toEqual(['ok'])
      } finally { copy.close() }
      expect(existsSync(join(target, BACKUP_PENDING))).toBe(false)
    } finally { db.close() }
  })
  it('只处理 message.data；快照目标存在时返回失败且不覆盖文件', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-command-test-'))
    const destination = join(root, 'existing.db')
    writeFileSync(destination, 'keep')
    const db = new DatabaseSync(':memory:')
    const shutdown = vi.fn()
    const reply = vi.fn()
    try {
      handleUtilityCommand({ type: 'shutdown' }, db, reply, shutdown)
      expect(shutdown).not.toHaveBeenCalled()
      handleUtilityCommand({ data: { type: 'shutdown' } }, db, reply, shutdown)
      expect(shutdown).toHaveBeenCalledOnce()
      handleUtilityCommand({ data: { type: 'backup-snapshot', id: 'test', destination } }, db, reply, shutdown)
      expect(reply.mock.calls[0][0]).toMatchObject({ type: 'backup-error', id: 'test' })
      expect(readFileSync(destination, 'utf8')).toBe('keep')
    } finally { db.close() }
  })
})
