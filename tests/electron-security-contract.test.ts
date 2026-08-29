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

import { isTrustedSender, registerIpcHandlers } from '../electron/ipc'
import { isAllowedExternalUrl, isAllowedNavigation } from '../electron/window'
import { setMainWindow, SERVER_TOKEN } from '../electron/state'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAIN_TS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../electron/window.ts'), 'utf8')

// 模拟主窗口（webContents.mainFrame 与 senderFrame.top 同源比较按引用）
function fakeWindow(): { window: unknown; webContents: unknown; mainFrame: unknown } {
  const mainFrame = { id: 'top' }
  const webContents = { mainFrame }
  return { window: { webContents }, webContents, mainFrame }
}

function fakeEvent(fromWebContents: unknown, topFrame: unknown): unknown {
  return { sender: fromWebContents, senderFrame: { top: topFrame } }
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
    const trustedEv = { sender: main.webContents, senderFrame: { top: main.mainFrame }, returnValue: '' }
    handler(trustedEv)
    expect(trustedEv.returnValue).toBe(SERVER_TOKEN)
    const untrustedEv = { sender: other.webContents, senderFrame: { top: other.mainFrame }, returnValue: '' }
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

describe('窗口安全策略（R8 源级契约）', () => {
  it('外链只放行 http/https；file:/smb:/自定义协议拒绝', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com/a')).toBe(true)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('smb://host/share')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('导航白名单：打包态仅 file://，dev 态仅 dev URL', () => {
    expect(isAllowedNavigation('file:///app/index.html', undefined)).toBe(true)
    expect(isAllowedNavigation('https://evil.example', undefined)).toBe(false)
    expect(isAllowedNavigation('http://localhost:5173/x', 'http://localhost:5173')).toBe(true)
    expect(isAllowedNavigation('file:///app/index.html', 'http://localhost:5173')).toBe(false)
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
