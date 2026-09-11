import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  whenReady: vi.fn<() => Promise<void>>(),
  quit: vi.fn(),
  showErrorBox: vi.fn(),
  recover: vi.fn(),
  start: vi.fn(),
  createWindow: vi.fn(),
  dataDir: 'D:/isolated-restore-test/data'
}))

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: () => true,
    whenReady: mocks.whenReady,
    on: vi.fn(),
    quit: mocks.quit
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showErrorBox: mocks.showErrorBox }
}))
vi.mock('../electron/state', () => ({ getMainWindow: vi.fn(), setMainWindow: vi.fn() }))
vi.mock('../electron/window', () => ({ createMenu: vi.fn(), createWindow: mocks.createWindow }))
vi.mock('../electron/serverProcess', () => ({ getDataDir: () => mocks.dataDir, startServer: mocks.start }))
vi.mock('../electron/restore', () => ({ recoverInterruptedRestore: mocks.recover }))
vi.mock('../electron/ipc', () => ({ registerIpcHandlers: vi.fn(), runAutoBackup: vi.fn(), setStartServerRef: vi.fn() }))
vi.mock('../electron/theme', () => ({ registerThemeIpc: vi.fn() }))
vi.mock('../electron/updater', () => ({ initUpdater: vi.fn(), checkForUpdatesQuietly: vi.fn() }))
vi.mock('../electron/shutdown', () => ({ shutdownServer: vi.fn(async () => {}) }))

let ready: () => void

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  const promise = new Promise<void>((resolve) => { ready = resolve })
  mocks.whenReady.mockReturnValue(promise)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('恢复中断后的应用启动', () => {
  it('损坏恢复记录显示保留副本的位置并退出，不启动服务或窗口', async () => {
    mocks.recover.mockImplementation(() => { throw new Error('恢复记录无效') })
    await import('../electron/main')
    expect(mocks.recover).not.toHaveBeenCalled()

    ready()
    await Promise.resolve()

    expect(mocks.recover).toHaveBeenCalledWith(mocks.dataDir)
    expect(mocks.showErrorBox).toHaveBeenCalledOnce()
    expect(mocks.showErrorBox).toHaveBeenCalledWith('数据恢复未完成', expect.stringContaining(mocks.dataDir))
    expect(mocks.showErrorBox.mock.calls[0][1]).toContain('已保留原库与恢复副本')
    expect(mocks.quit).toHaveBeenCalledOnce()
    expect(mocks.showErrorBox.mock.invocationCallOrder[0]).toBeLessThan(mocks.quit.mock.invocationCallOrder[0])
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.createWindow).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('恢复处理成功后才启动服务和窗口', async () => {
    await import('../electron/main')
    expect(mocks.start).not.toHaveBeenCalled()

    ready()
    await Promise.resolve()

    expect(mocks.recover).toHaveBeenCalledOnce()
    expect(mocks.recover).toHaveBeenCalledWith(mocks.dataDir)
    expect(mocks.start).toHaveBeenCalledOnce()
    expect(mocks.createWindow).toHaveBeenCalledOnce()
    expect(mocks.recover.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0])
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.createWindow.mock.invocationCallOrder[0])
    expect(mocks.showErrorBox).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
  })
})
