import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { recoverInterruptedRestore, restoreBackup, type RestoreServices } from '../electron/restore'
import { BACKUP_DB } from '../electron/backup'

const failures = vi.hoisted(() => ({ renameAt: 0, renameCalls: 0, copyAt: 0, copyCalls: 0 }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (++failures.renameCalls === failures.renameAt) throw Error('injected rename failure')
      return fs.renameSync(...args)
    },
    copyFileSync: (...args: Parameters<typeof fs.copyFileSync>) => {
      if (++failures.copyCalls === failures.copyAt) throw Error('injected copy failure')
      return fs.copyFileSync(...args)
    }
  }
})
afterEach(() => Object.assign(failures, { renameAt: 0, renameCalls: 0, copyAt: 0, copyCalls: 0 }))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'novel-restore-'))
  const data = join(root, 'data')
  const source = join(root, 'source')
  mkdirSync(data)
  mkdirSync(source)
  writeFileSync(join(data, BACKUP_DB), 'original')
  writeFileSync(join(source, BACKUP_DB), 'candidate')
  const services: RestoreServices = {
    validate: vi.fn(async (input, output) => { copyFileSync(input, output) }),
    stop: vi.fn(async () => {}), start: vi.fn(async () => {}), activate: vi.fn(async () => {})
  }
  return { root, data, source, services }
}

describe('恢复切换保全原库', () => {
  it('暂存复制失败保留活动库并保持原服务', async () => {
    const f = fixture()
    failures.copyAt = 1
    await expect(restoreBackup(f.data, f.source, 'test', f.services)).rejects.toThrow('copy failure')
    expect(f.services.stop).not.toHaveBeenCalled()
    expect(readFileSync(join(f.data, BACKUP_DB), 'utf8')).toBe('original')
  })
  it.each([1, 2, 3])('第 %i 个文件移动失败可回退', async renameAt => {
    const f = fixture()
    writeFileSync(join(f.data, BACKUP_DB + '-wal'), 'old-wal')
    failures.renameAt = renameAt
    await expect(restoreBackup(f.data, f.source, 'test', f.services)).rejects.toThrow('rename failure')
    expect(readFileSync(join(f.data, BACKUP_DB), 'utf8')).toBe('original')
    expect(readFileSync(join(f.data, BACKUP_DB + '-wal'), 'utf8')).toBe('old-wal')
    expect(f.services.start).toHaveBeenLastCalledWith(false)
    expect(f.services.activate).not.toHaveBeenCalled()
  })
  it('回退复制再次失败时保留原件与journal，下次启动重试成功', async () => {
    const f = fixture()
    f.services.start = vi.fn(async () => { failures.copyAt = failures.copyCalls + 1; throw Error('startup') })
    await expect(restoreBackup(f.data, f.source, 'test', f.services)).rejects.toThrow('copy failure')
    expect(existsSync(join(f.data, 'restore-pending.json'))).toBe(true)
    failures.copyAt = 0
    recoverInterruptedRestore(f.data)
    expect(readFileSync(join(f.data, BACKUP_DB), 'utf8')).toBe('original')
    expect(existsSync(join(f.data, 'restore-pending.json'))).toBe(false)
  })
  it('校验失败不停止原服务、不改写原库', async () => {
    const f = fixture()
    f.services.validate = vi.fn(async () => { throw Error('损坏备份') })
    await expect(restoreBackup(f.data, f.source, 'test', f.services)).rejects.toThrow('损坏')
    expect(f.services.stop).not.toHaveBeenCalled()
    expect(readFileSync(join(f.data, BACKUP_DB), 'utf8')).toBe('original')
  })
  it('拒绝活动库和伪装成数据库的目录', async () => {
    const f = fixture()
    await expect(restoreBackup(f.data, f.data, 'test', f.services)).rejects.toThrow('活动数据库')
    const bad = join(f.root, 'bad')
    mkdirSync(bad)
    mkdirSync(join(bad, BACKUP_DB))
    await expect(restoreBackup(f.data, bad, 'test', f.services)).rejects.toThrow('普通文件')
    expect(f.services.validate).not.toHaveBeenCalled()
  })
  it('服务关闭失败不移动任何原库文件', async () => {
    const f = fixture()
    f.services.stop = vi.fn(async () => { throw Error('关闭失败') })
    await expect(restoreBackup(f.data, f.source, 'test', f.services)).rejects.toThrow('关闭失败')
    expect(readFileSync(join(f.data, BACKUP_DB), 'utf8')).toBe('original')
    expect(f.services.start).not.toHaveBeenCalled()
  })
  it('等待暂停启动确认后才提交、激活，并保留可供恢复的原库副本', async () => {
    const f = fixture()
    let ready!: () => void
    f.services.start = vi.fn(() => new Promise<void>(resolve => { ready = resolve }))
    const pending = restoreBackup(f.data, f.source, 'test', f.services)
    await vi.waitFor(() => expect(f.services.start).toHaveBeenCalledWith(true))
    expect(f.services.activate).not.toHaveBeenCalled()
    expect(existsSync(join(f.data, 'restore-pending.json'))).toBe(true)
    ready()
    const before = await pending
    expect(f.services.activate).toHaveBeenCalledOnce()
    expect(readFileSync(join(before, BACKUP_DB), 'utf8')).toBe('original')
    expect(readFileSync(join(f.data, BACKUP_DB), 'utf8')).toBe('candidate')
    expect(existsSync(join(before, 'backup-info.json'))).toBe(true)
    expect(existsSync(join(f.data, 'restore-pending.json'))).toBe(false)
  })
  it('新服务启动失败，先确认退出再恢复原库及旧 WAL', async () => {
    const f = fixture()
    writeFileSync(join(f.data, BACKUP_DB + '-wal'), 'old-wal')
    f.services.start = vi.fn(async (paused) => {
      if (paused) { writeFileSync(join(f.data, BACKUP_DB + '-wal'), 'new-wal'); throw Error('启动失败') }
      expect(readFileSync(join(f.data, BACKUP_DB), 'utf8')).toBe('original')
      expect(readFileSync(join(f.data, BACKUP_DB + '-wal'), 'utf8')).toBe('old-wal')
    })
    await expect(restoreBackup(f.data, f.source, 'test', f.services)).rejects.toThrow('启动失败')
    expect(f.services.stop).toHaveBeenCalledTimes(2)
    expect(f.services.start).toHaveBeenLastCalledWith(false)
    expect(f.services.activate).not.toHaveBeenCalled()
  })
  it('连续成功恢复只轮转已识别副本，夹带未知文件时保留', async () => {
    const f = fixture()
    const first = await restoreBackup(f.data, f.source, 'test', f.services)
    const second = await restoreBackup(f.data, f.source, 'test', f.services)
    expect(existsSync(first)).toBe(false)
    writeFileSync(join(second, 'user.txt'), 'keep')
    await restoreBackup(f.data, f.source, 'test', f.services)
    expect(readFileSync(join(second, 'user.txt'), 'utf8')).toBe('keep')
  })
})

describe('启动时重放未完成恢复', () => {
  it.each(['before-move', 'partial-move', 'installed', 'committed'])('中断位置 %s', (phase) => {
    const f = fixture()
    const work = mkdtempSync(join(f.data, 'restore-'))
    mkdirSync(join(work, 'before'))
    writeFileSync(join(work, 'restore.json'), JSON.stringify({ app: 'AI-Novel-Studio', original: [BACKUP_DB], createdAt: 'test' }))
    writeFileSync(join(f.data, 'restore-pending.json'), JSON.stringify({ directory: basename(work) }))
    if (phase !== 'before-move') renameSync(join(f.data, BACKUP_DB), join(work, 'before', BACKUP_DB))
    if (phase === 'installed' || phase === 'committed') writeFileSync(join(f.data, BACKUP_DB), 'candidate')
    if (phase === 'committed') writeFileSync(join(work, 'committed'), '{}')
    recoverInterruptedRestore(f.data)
    expect(readFileSync(join(f.data, BACKUP_DB), 'utf8')).toBe(phase === 'committed' ? 'candidate' : 'original')
    recoverInterruptedRestore(f.data)
    expect(existsSync(join(f.data, 'restore-pending.json'))).toBe(false)
  })
  it('恶意目录记录拒绝启动，保留全部文件', () => {
    const f = fixture()
    writeFileSync(join(f.data, 'restore-pending.json'), JSON.stringify({ directory: '../source' }))
    expect(() => recoverInterruptedRestore(f.data)).toThrow('目录记录无效')
    expect(readdirSync(f.source)).toEqual([BACKUP_DB])
  })
})
