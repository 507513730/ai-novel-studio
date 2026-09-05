// 重构计划 R8：Electron 安全面契约测试（node 环境下 mock electron 模块）。
// ① trusted sender 校验矩阵（主窗口顶层 frame——XSS iframe 防线，审查 M19/L4/A6）；
// ② get-server-token 对不可信 frame 返回空（null-Origin token 防线的 IPC 侧）；
// ③ wipe-data 不可信 sender 直接拒绝（破坏性操作不触达文件系统）；
// ④ 源级安全不变量：sandbox/contextIsolation、外链白名单、随机端口、safeStorage fail-closed。
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { ipcHandlers, ipcOnHandlers } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...a: unknown[]) => unknown>(),
  ipcOnHandlers: new Map<string, (event: unknown) => void>()
}))

vi.mock('electron', () => {
  const nativeTheme = { themeSource: 'system' }
  return {
    app: {
      getPath: () => '/tmp/user-data',
      getVersion: () => '0.0.0-test',
      isPackaged: false,
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      on: () => undefined,
      quit: () => undefined,
      exit: () => undefined
    },
    BrowserWindow: Object.assign(vi.fn(), { getAllWindows: () => [] }),
    ipcMain: {
      handle: (channel: string, fn: (...a: unknown[]) => unknown) => ipcHandlers.set(channel, fn),
      on: (channel: string, fn: (event: unknown) => void) => ipcOnHandlers.set(channel, fn)
    },
    nativeTheme,
    shell: { openPath: vi.fn(), openExternal: vi.fn() },
    safeStorage: { isEncryptionAvailable: () => true },
    Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn(() => []) },
    utilityProcess: { fork: vi.fn() },
    dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() }
  }
})

import { dialog } from 'electron'
import { isTrustedSender, registerIpcHandlers } from '../electron/ipc'
import { isAllowedExternalUrl, isAllowedNavigation } from '../electron/window'
import { setMainWindow, SERVER_TOKEN } from '../electron/state'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAIN_TS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../electron/window.ts'), 'utf8')

// 模拟主窗口（webContents.mainFrame 与 senderFrame 本身按引用比较）
function fakeWindow(): { window: unknown; webContents: unknown; mainFrame: unknown } {
  const mainFrame: { id: string; top?: unknown; parent: null } = { id: 'top', parent: null }
  mainFrame.top = mainFrame
  const webContents = { mainFrame }
  return { window: { webContents }, webContents, mainFrame }
}

function fakeEvent(fromWebContents: unknown, topFrame: unknown): unknown {
  return { sender: fromWebContents, senderFrame: topFrame }
}

beforeEach(() => {
  ipcHandlers.clear()
  ipcOnHandlers.clear()
  registerIpcHandlers()
})

describe('trusted sender 校验矩阵（R8）', () => {
  it('主窗口未就绪 → 一律不可信（preload 引导竞态窗口期收紧为拒绝写操作）', () => {
    setMainWindow(null)
    const fake = fakeWindow()
    expect(isTrustedSender(fakeEvent(fake.webContents, fake.mainFrame))).toBe(false)
  })

  it('主窗口顶层 frame → 可信；他窗 sender / 非顶层 frame → 不可信', () => {
    const main = fakeWindow()
    const other = fakeWindow()
    setMainWindow(main.window as never)
    expect(isTrustedSender(fakeEvent(main.webContents, main.mainFrame))).toBe(true)
    expect(isTrustedSender(fakeEvent(other.webContents, main.mainFrame))).toBe(false)
    expect(isTrustedSender(fakeEvent(main.webContents, other.mainFrame))).toBe(false)
  })

  it('get-server-token：不可信 frame 返回空串（token 不外泄）', () => {
    const main = fakeWindow()
    const other = fakeWindow()
    setMainWindow(main.window as never)
    const handler = ipcOnHandlers.get('get-server-token')!
    const trustedEv = { sender: main.webContents, senderFrame: main.mainFrame, returnValue: '' }
    handler(trustedEv)
    expect(trustedEv.returnValue).toBe(SERVER_TOKEN)
    const untrustedEv = { sender: other.webContents, senderFrame: other.mainFrame, returnValue: '' }
    handler(untrustedEv)
    expect(untrustedEv.returnValue).toBe('')
  })

  it('wipe-data：不可信 sender 直接拒绝（破坏性操作不触达文件系统）', async () => {
    const main = fakeWindow()
    const other = fakeWindow()
    setMainWindow(main.window as never)
    const handler = ipcHandlers.get('wipe-data')!
    const res = (await handler(fakeEvent(other.webContents, other.mainFrame))) as { ok?: boolean }
    expect(res).toBe(false)
  })
})

describe('IPC frame 边界回归', () => {
  it('同窗口子 frame 即使 top 指向主 frame 也必须拒绝', async () => {
    const main = fakeWindow()
    setMainWindow(main.window as never)
    const child = { top: main.mainFrame, parent: main.mainFrame }
    const event = { sender: main.webContents, senderFrame: child, returnValue: '' }
    expect(isTrustedSender(event as never)).toBe(false)
    ipcOnHandlers.get('get-server-token')!(event)
    expect(event.returnValue).toBe('')
    expect(await ipcHandlers.get('wipe-data')!(event)).toBe(false)
  })

  it.each([null, undefined])('缺失 senderFrame (%s) 时拒绝', (senderFrame) => {
    const main = fakeWindow()
    setMainWindow(main.window as never)
    const event = { sender: main.webContents, senderFrame, returnValue: '' }
    expect(isTrustedSender(event as never)).toBe(false)
    ipcOnHandlers.get('get-server-token')!(event)
    expect(event.returnValue).toBe('')
  })

  it('主窗口尚未就绪时不能获取 token', () => {
    setMainWindow(null)
    const main = fakeWindow()
    const event = { sender: main.webContents, senderFrame: main.mainFrame, returnValue: '' }
    ipcOnHandlers.get('get-server-token')!(event)
    expect(event.returnValue).toBe('')
  })
})

describe('数据管理跨操作互斥', () => {
  it('导出对话框未结束时拒绝恢复，取消后释放锁', async () => {
    const main = fakeWindow()
    setMainWindow(main.window as never)
    let cancelDialog!: () => void
    vi.mocked(dialog.showSaveDialog).mockImplementationOnce(() => new Promise((resolve) => {
      cancelDialog = () => resolve({ canceled: true, filePath: '' })
    }))
    const event = fakeEvent(main.webContents, main.mainFrame)
    const exporting = ipcHandlers.get('export-backup')!(event)
    try {
      expect(await ipcHandlers.get('restore-backup')!(event)).toEqual({
        ok: false, error: '另一个数据管理操作正在进行，请稍后重试'
      })
    } finally { cancelDialog() }
    expect(await exporting).toEqual({ ok: false, canceled: true })
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' })
    expect(await ipcHandlers.get('export-backup')!(event)).toEqual({ ok: false, canceled: true })
  })
})

describe('窗口安全策略（R8 源级契约）', () => {
  it('外链只放行 http/https；file:/smb:/自定义协议拒绝', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com/a')).toBe(true)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('smb://host/share')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('导航白名单：打包态仅 renderer 入口，dev 态仅相同 origin', () => {
    expect(isAllowedNavigation('file:///app/index.html', undefined, 'file:///app/index.html')).toBe(true)
    expect(isAllowedNavigation('https://evil.example', undefined)).toBe(false)
    expect(isAllowedNavigation('http://localhost:5173/x', 'http://localhost:5173')).toBe(true)
    expect(isAllowedNavigation('file:///app/index.html', 'http://localhost:5173')).toBe(false)
  })

  it.each([
    'http://localhost:51730/x',
    'http://localhost:5173@evil.example/x',
    'https://localhost:5173/x',
    'not a URL'
  ])('拒绝开发地址前缀伪装或非法导航：%s', (url) => {
    expect(isAllowedNavigation(url, 'http://localhost:5173')).toBe(false)
  })

  it('打包入口允许 hash/search，不允许其他本地文件', () => {
    const entry = 'file:///app/renderer/index.html'
    expect(isAllowedNavigation(entry + '?theme=dark#/settings', undefined, entry)).toBe(true)
    expect(isAllowedNavigation('file:///app/other.html', undefined, entry)).toBe(false)
    expect(isAllowedNavigation('file://remote/app/renderer/index.html', undefined, entry)).toBe(false)
    expect(isAllowedNavigation('http://localhost/', 'invalid')).toBe(false)
  })

  it('webPreferences 安全三件套在源中成立（sandbox/contextIsolation/nodeIntegration）', () => {
    expect(MAIN_TS).toContain('sandbox: true')
    expect(MAIN_TS).toContain('contextIsolation: true')
    expect(MAIN_TS).toContain('nodeIntegration: false')
  })

  it('safeStorage fail-closed 文案在源中成立（拒绝明文落库/拒绝解密直传）', () => {
    const crypto = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../electron/serverProcess.ts'), 'utf8')
    expect(crypto).toContain('refusing to store plaintext key')
    expect(crypto).toContain('cannot decrypt key')
  })

  it('随机端口契约：打包态 AI_NOVEL_PORT=0，仅 dev 固定 3000', () => {
    const sp = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../electron/serverProcess.ts'), 'utf8')
    expect(sp).toContain("process.env.ELECTRON_RENDERER_URL ? '3000' : '0'")
  })
})
