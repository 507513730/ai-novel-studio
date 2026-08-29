// Electron 主进程——纯装配层（重构计划 R8 / spec §3.7）。
// 窗口/菜单 → window.ts；server 进程 → serverProcess.ts；IPC 与 sender 校验 → ipc.ts；
// 主题 → theme.ts；更新 → updater.ts；优雅关闭 → shutdown.ts。
// 本文件只负责应用生命周期编排，不含业务实现。
import { app, BrowserWindow } from 'electron'
import { getMainWindow, setMainWindow } from './state'
import { createMenu, createWindow } from './window'
import { startServer } from './serverProcess'
import { registerIpcHandlers, runAutoBackup, setStartServerRef } from './ipc'
import { registerThemeIpc } from './theme'
import { initUpdater, checkForUpdatesQuietly } from './updater'
import { shutdownServer } from './shutdown'

// v0.22.3：单实例锁——再次点击快捷方式不新开窗口，而是唤出已有实例（Electron 官方 API：
// requestSingleInstanceLock 须在 ready 前调用；未获得锁 = 已有实例在跑 → 本实例立即退出，
// 由主实例 second-instance 事件处理聚焦。另杜绝"双 server 抢真实库"隐患）
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.whenReady().then(() => {
  createMenu()
  // restore-backup 需要重启 server——由 ipc 模块经注入调用（避免环依赖）
  setStartServerRef(startServer)
  registerIpcHandlers()
  registerThemeIpc()
  startServer()
  createWindow()

  // v0.22.3：第二实例触发 → 唤出主窗口（最小化则恢复，未聚焦则聚焦）
  app.on('second-instance', () => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // v0.9.2（O4）：每日自动备份——启动 5 分钟后首备（等 server 就绪），之后每 24h
  setTimeout(() => void runAutoBackup(), 5 * 60 * 1000)
  setInterval(() => void runAutoBackup(), 24 * 60 * 60 * 1000)

  // v0.16.0：应用更新——打包态启用（开发模式禁用）；启动 5s 后静默检查（不打扰）
  initUpdater()
  setTimeout(() => checkForUpdatesQuietly(), 5000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// v0.23.1（批次 A6）：优雅退出防重入——preventDefault + await shutdownServer（最长 3s，含 kill 兜底）
// 后再真正退出；此前 void 不等待，app 可能在 server.close 完成前就退出截断清理
let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  void shutdownServer().then(() => {
    setMainWindow(null)
    app.quit()
  })
})
