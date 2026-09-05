// IPC 注册与 trusted sender 校验（重构计划 R8）：
// 全部 ipcMain 通道集中于此；破坏性操作（wipe/restore/export）限定主窗口顶层 frame
// （v0.17.0 审查 M19 / v0.23.1 A6——XSS 注入 iframe 无法绕过）。
import { app, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { getDataDir } from './serverProcess'
import { getLastServerUrl, getMainWindow, getServerProcess, SERVER_TOKEN } from './state'
import { shutdownServer } from './shutdown'
import { createBackupDirectory, listAutoBackups, removeAutoBackup, resolveBackupDirectory } from './backup'

// v0.25.0（审查 L4）：布尔版 sender 校验（供 ipcMain.on 使用，不抛错）
// 结构类型兼容 IpcMainInvokeEvent 与 IpcMainEvent（两者均含 sender / senderFrame）
export interface SenderEvent {
  sender: Electron.WebContents
  senderFrame?: Electron.WebFrameMain | null
}

// v0.17.0（审查 M19）：破坏性 IPC 只接受主窗口顶层 frame（XSS 注入 iframe 无法绕过）
export function isTrustedSender(event: SenderEvent): boolean {
  const w = getMainWindow()
  if (w === null) return false
  const fromMain = event.sender === w.webContents
  const topFrame = event.senderFrame === w.webContents.mainFrame
  return fromMain && topFrame
}

export function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) {
    throw new Error('untrusted sender')
  }
}

/** v0.23.1（批次 A6）：sender 校验布尔版（不抛错——IPC 返回 untrusted 语义） */
export function trusted(event: Electron.IpcMainInvokeEvent): boolean {
  try {
    assertTrustedSender(event)
    return true
  } catch {
    return false
  }
}

let dataOperationBusy = false

function registerDataHandler(
  channel: 'wipe-data' | 'export-backup' | 'restore-backup',
  handler: (event: Electron.IpcMainInvokeEvent) => Promise<unknown>
): void {
  ipcMain.handle(channel, async (event) => {
    if (dataOperationBusy) {
      return channel === 'wipe-data' ? false : { ok: false, error: '另一个数据管理操作正在进行，请稍后重试' }
    }
    dataOperationBusy = true
    try { return await handler(event) }
    finally { dataOperationBusy = false }
  })
}

// D129：自动备份与手动导出共用一致性快照协议。
export const AUTO_BACKUP_KEEP = 7

export async function runAutoBackup(): Promise<void> {
  if (dataOperationBusy) return
  dataOperationBusy = true
  try {
    const dataDir = getDataDir()
    const dbFile = join(dataDir, 'ai-novel-studio.db')
    if (!existsSync(dbFile)) return
    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    const outDir = join(dataDir, 'backups', `auto-${stamp}`)
    if (existsSync(outDir)) return
    const backupsDir = join(dataDir, 'backups')
    mkdirSync(backupsDir, { recursive: true })
    await createBackupDirectory(dataDir, outDir, app.getVersion(), true)
    const dirs = listAutoBackups(backupsDir)
    while (dirs.length > AUTO_BACKUP_KEEP) removeAutoBackup(join(backupsDir, dirs.shift()!))
    console.log('[main] 自动备份完成:', outDir)
  } catch (e) {
    console.error('[main] auto-backup error:', e)
  } finally {
    dataOperationBusy = false
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('get-server-url', () => getLastServerUrl())
  // D127：主窗口在加载 preload 前已注册；缺失窗口或 frame 时拒绝返回 token。
  ipcMain.on('get-server-token', (event) => {
    event.returnValue = isTrustedSender(event) ? SERVER_TOKEN : ''
  })

  // P16 P0：数据管理（打开数据目录 / 清除全部数据）——P20 统一便携版目录
  ipcMain.handle('open-data-dir', () => {
    void shell.openPath(getDataDir())
    return true
  })
  registerDataHandler('wipe-data', async (event) => {
    try {
      assertTrustedSender(event)
    } catch (e) {
      console.error('[main] wipe-data rejected:', e)
      return false
    }
    try {
      // v0.17.0（审查 H6）：先优雅关闭 server（释放 db/WAL 句柄）再删——此前直接 app.exit 不触发
      // before-quit → Windows 上 EBUSY 静默失败 + 孤儿进程
      await shutdownServer()
      const dataDir = getDataDir()
      if (dataDir) {
        rmSync(dataDir, { recursive: true, force: true })
      }
    } catch (e) {
      console.error('[main] wipe-data error:', e)
      return false
    }
    app.exit(0)
    return true
  })

  // 设置页展示：最近自动备份时间 + 份数
  ipcMain.handle('get-auto-backup-info', () => {
    try {
      const backupsDir = join(getDataDir(), 'backups')
      if (!existsSync(backupsDir)) return { lastAt: null, count: 0, keep: AUTO_BACKUP_KEEP }
      const dirs = listAutoBackups(backupsDir)
      const last = dirs.length > 0 ? dirs[dirs.length - 1] : null
      return { lastAt: last ? last.replace('auto-', '').replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/, '$1-$2-$3 $4:$5') : null, count: dirs.length, keep: AUTO_BACKUP_KEEP }
    } catch {
      return { lastAt: null, count: 0, keep: AUTO_BACKUP_KEEP }
    }
  })

  // D129：导出到新目录，成功确认快照后才写完成清单。
  registerDataHandler('export-backup', async (event) => {
    try {
      assertTrustedSender(event)
      const dataDir = getDataDir()
      const now = new Date()
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
      const defaultName = `ai-novel-studio-backup-${stamp}`
      const w = getMainWindow()
      const picked = await dialog.showSaveDialog(w!, {
        title: '导出数据备份',
        defaultPath: join(app.getPath('documents'), defaultName),
        buttonLabel: '导出备份',
        properties: ['createDirectory']
      })
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
      const outDir = picked.filePath
      await createBackupDirectory(dataDir, outDir, app.getVersion())
      return { ok: true, path: outDir, copied: 1 }
    } catch (e) {
      console.error('[main] export-backup error:', e)
      return { ok: false, error: String(e) }
    }
  })

  // P18 B + P20（S2）：从备份恢复（停服务 → 替换主库 → 清 wal/shm → 重启服务 → 通知刷新）
  // 复核（52fca79，R8）：恢复前必须 await server 退出（防 SQLITE_BUSY），不触碰运行中数据库
  registerDataHandler('restore-backup', async (event) => {
    try {
      assertTrustedSender(event)
      const dataDir = getDataDir()
      const w = getMainWindow()
      const picked = await dialog.showOpenDialog(w!, {
        title: '选择备份（目录或其中的 db 文件）',
        properties: ['openDirectory', 'openFile']
      })
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true }
      const src = picked.filePaths[0]
      const dir = resolveBackupDirectory(src)
      const dbFile = join(dir, 'ai-novel-studio.db')
      // P20：版本提示（不同版本备份允许恢复——迁移层幂等补齐列；仅提示）
      const infoFile = join(dir, 'backup-info.json')
      let backupVersion = '未知'
      if (existsSync(infoFile)) {
        try {
          const info = JSON.parse(readFileSync(infoFile, 'utf8')) as { version?: string }
          backupVersion = info.version ?? '未知'
        } catch {
          /* 忽略损坏的 info */
        }
      }
      if (backupVersion !== app.getVersion()) {
        const ok = await dialog.showMessageBox(getMainWindow()!, {
          type: 'warning',
          title: '版本不一致',
          message: `备份来自 v${backupVersion}，当前应用为 v${app.getVersion()}。\n恢复后将以当前应用打开旧备份数据（数据库会自动补齐缺失字段）。\n继续恢复？`,
          buttons: ['继续恢复', '取消'],
          defaultId: 1
        })
        if (ok.response !== 0) return { ok: false, canceled: true }
      }
      // 1) 停服务（Windows 下数据库文件被 server 独占，必须释放）
      const hadServer = getServerProcess() !== null
      if (hadServer) {
        // v0.17.0（审查 M18）：await 进程退出（带超时兜底）替代固定 800ms 启发式——防 SQLITE_BUSY
        await shutdownServer()
      }
      // 2) 替换主库 + 清除旧 wal/shm（恢复后由 SQLite 按主库重建 WAL）
      copyFileSync(dbFile, join(dataDir, 'ai-novel-studio.db'))
      for (const f of ['ai-novel-studio.db-wal', 'ai-novel-studio.db-shm']) {
        const t = join(dataDir, f)
        if (existsSync(t)) rmSync(t, { force: true })
      }
      // 3) 重启服务（startServer 由 serverProcess 模块提供，经 main 注入避免环依赖）
      if (hadServer && startServerRef) {
        try {
          startServerRef()
        } catch (e) {
          console.error('[main] restore: server restart failed:', e)
          return { ok: true, warning: '数据已恢复，但服务重启失败，请手动重启应用', restoredFrom: dir }
        }
      }
      // 4) 通知渲染端刷新（恢复后旧页面状态已失效）
      getMainWindow()?.webContents.send('data-restored')
      return { ok: true, restoredFrom: dir }
    } catch (e) {
      console.error('[main] restore-backup error:', e)
      return { ok: false, error: String(e) }
    }
  })
}

// startServer 由 main 注入（serverProcess 模块不反向依赖 ipc）
let startServerRef: (() => void) | null = null
export function setStartServerRef(fn: () => void): void {
  startServerRef = fn
}
