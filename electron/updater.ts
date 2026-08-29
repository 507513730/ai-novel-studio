// 应用更新（重构计划 R8 / v0.16.0）：electron-updater 生命周期唯一实现。
// 契约：静态导入（v0.16.2）、打包态启用/便携版跳过、手动确认下载、
// 广播与 invoke 返回一致（含 currentVersion，v0.16.3）、高危操作限定主窗口顶层 frame。
import { app, BrowserWindow, ipcMain } from 'electron'
// v0.16.2：静态导入（动态 import() 对 CJS 包命名导出检测失败 → autoUpdater undefined → 检查更新报错）
import { autoUpdater } from 'electron-updater'
import { trusted } from './ipc'

let updaterEnabled = false
let updaterStatus: Record<string, unknown> = { state: 'idle' }

function broadcastUpdater(): void {
  // v0.16.3：广播与 invoke 返回一致——都带 currentVersion（此前广播缺版本号 → 覆盖后显示「v—」）
  const payload = { ...updaterStatus, currentVersion: app.getVersion() }
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('updater-status', payload)
  }
}

/** v0.16.2：防御兜底——更新模块不可用时返回明确错误（不再裸抛 undefined 读取） */
function updaterBusy(message = '更新模块不可用（当前环境不支持自动更新）'): Record<string, unknown> {
  updaterStatus = { state: 'error', message }
  broadcastUpdater()
  return { ok: false, reason: 'unavailable' }
}

export function initUpdater(): void {
  if (!app.isPackaged) {
    console.log('[updater] 开发模式——跳过自动更新初始化')
    return
  }
  // 便携版不支持自更新（electron-updater 限制）——跳过（设置页提示手动下载）
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    console.log('[updater] 便携版——不支持自动更新')
    return
  }
  // v0.16.2：静态导入后直接初始化（无动态 import 竞态）
  updaterEnabled = true
  autoUpdater.autoDownload = false // 手动确认后下载（静默检查只发现不下载）
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => {
    updaterStatus = { state: 'checking' }
    broadcastUpdater()
  })
  autoUpdater.on('update-available', (info) => {
    updaterStatus = { state: 'available', version: info.version, releaseDate: info.releaseDate, downloaded: false }
    broadcastUpdater()
  })
  autoUpdater.on('update-not-available', () => {
    updaterStatus = { state: 'up-to-date' }
    broadcastUpdater()
  })
  autoUpdater.on('download-progress', (p) => {
    updaterStatus = { state: 'downloading', percent: Math.round(p.percent), transferred: p.transferred, total: p.total }
    broadcastUpdater()
  })
  autoUpdater.on('update-downloaded', (info) => {
    updaterStatus = { state: 'downloaded', version: info.version, downloaded: true }
    broadcastUpdater()
  })
  autoUpdater.on('error', (err) => {
    updaterStatus = { state: 'error', message: String(err?.message ?? err) }
    broadcastUpdater()
  })
}

export function checkForUpdatesQuietly(): void {
  if (!updaterEnabled || typeof autoUpdater?.checkForUpdates !== 'function') return
  autoUpdater.checkForUpdates().catch(() => {
    /* 静默失败 */
  })
}

// IPC：手动检查 / 下载 / 重启安装 / 当前状态
// v0.23.1（批次 A6）：updater 三操作限定主窗口顶层 frame（quitAndInstall 为高危操作）
function registerUpdaterIpc(): void {
  ipcMain.handle('updater-check', (event) => {
    if (!trusted(event)) return { ok: false, reason: 'untrusted' }
    if (!updaterEnabled || typeof autoUpdater?.checkForUpdates !== 'function') {
      return updaterBusy()
    }
    updaterStatus = { state: 'checking' }
    broadcastUpdater()
    autoUpdater
      .checkForUpdates()
      .catch((err) => {
        updaterStatus = { state: 'error', message: String(err?.message ?? err) }
        broadcastUpdater()
      })
    return { ok: true }
  })
  ipcMain.handle('updater-download', (event) => {
    if (!trusted(event)) return { ok: false, reason: 'untrusted' }
    if (!updaterEnabled || typeof autoUpdater?.downloadUpdate !== 'function') {
      return updaterBusy()
    }
    autoUpdater.downloadUpdate().catch((err) => {
      updaterStatus = { state: 'error', message: String(err?.message ?? err) }
      broadcastUpdater()
    })
    return { ok: true }
  })
  ipcMain.handle('updater-install', (event) => {
    if (!trusted(event)) return { ok: false, reason: 'untrusted' }
    if (!updaterEnabled || typeof autoUpdater?.quitAndInstall !== 'function') {
      return updaterBusy()
    }
    autoUpdater.quitAndInstall()
    return { ok: true }
  })
  ipcMain.handle('updater-status', () => ({ ...updaterStatus, currentVersion: app.getVersion() }))
}

registerUpdaterIpc()
