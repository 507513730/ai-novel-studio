// IPC 注册与 trusted sender 校验（重构计划 R8）：
// 全部 ipcMain 通道集中于此；破坏性操作（wipe/restore/export）限定主窗口顶层 frame
// （v0.17.0 审查 M19 / v0.23.1 A6——XSS 注入 iframe 无法绕过）。
import { app, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { getDataDir } from './serverProcess'
import { getLastServerUrl, getMainWindow, getServerProcess, SERVER_TOKEN } from './state'
import { requestCheckpoint, shutdownServer } from './shutdown'

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

// v0.9.2（O4）：自动备份——每日 checkpoint 后复制主库到 backups/auto-*（轮转保留 N 份）
export const AUTO_BACKUP_KEEP = 7

export async function runAutoBackup(): Promise<void> {
  try {
    const dataDir = getDataDir()
    const dbFile = join(dataDir, 'ai-novel-studio.db')
    if (!existsSync(dbFile)) return
    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    const outDir = join(dataDir, 'backups', `auto-${stamp}`)
    if (existsSync(outDir)) return
    // v0.17.0（审查 M15）：await checkpoint 完成（此前 fire-and-forget → 可能复制陈旧主库）
    await requestCheckpoint()
    mkdirSync(outDir, { recursive: true })
    copyFileSync(dbFile, join(outDir, 'ai-novel-studio.db'))
    writeFileSync(
      join(outDir, 'backup-info.json'),
      JSON.stringify(
        {
          app: 'AI-Novel-Studio',
          version: app.getVersion(),
          createdAt: new Date().toISOString(),
          auto: true,
          files: ['ai-novel-studio.db']
        },
        null,
        2
      ),
      'utf8'
    )
    // 轮转：保留最近 AUTO_BACKUP_KEEP 份，其余删除
    const backupsDir = join(dataDir, 'backups')
    const dirs = readdirSync(backupsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('auto-'))
      .map((d) => d.name)
      .sort()
    while (dirs.length > AUTO_BACKUP_KEEP) {
      const oldest = dirs.shift()!
      rmSync(join(backupsDir, oldest), { recursive: true, force: true })
    }
    console.log('[main] 自动备份完成:', outDir)
  } catch (e) {
    console.error('[main] auto-backup error:', e)
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
  ipcMain.handle('wipe-data', async (event) => {
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
      const dirs = readdirSync(backupsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith('auto-'))
        .map((d) => d.name)
        .sort()
      const last = dirs.length > 0 ? dirs[dirs.length - 1] : null
      return { lastAt: last ? last.replace('auto-', '').replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/, '$1-$2-$3 $4:$5') : null, count: dirs.length, keep: AUTO_BACKUP_KEEP }
    } catch {
      return { lastAt: null, count: 0, keep: AUTO_BACKUP_KEEP }
    }
  })

  // P18 B + P20（S2）：导出备份（先 checkpoint 保证原子，只导出主库文件）
  ipcMain.handle('export-backup', async (event) => {
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
      // P20：请求 server 执行 wal_checkpoint(TRUNCATE)（WAL 落主库），保证备份原子
      // R8：checkpoint 请求统一走 shutdown.ts（原此处内联复制一份协议代码）
      await requestCheckpoint()
      const outDir = picked.filePath
      if (existsSync(outDir)) {
        // 同名目录已存在 → 清空重建（用户已确认覆盖意图）
        rmSync(outDir, { recursive: true, force: true })
      }
      mkdirSync(outDir, { recursive: true })
      // 只备份主库（checkpoint 后 wal/shm 为空；恢复时旧 wal/shm 一并清除防脏）
      const dbFile = join(dataDir, 'ai-novel-studio.db')
      if (!existsSync(dbFile)) return { ok: false, error: '数据库文件不存在，无法备份' }
      copyFileSync(dbFile, join(outDir, 'ai-novel-studio.db'))
      writeFileSync(
        join(outDir, 'backup-info.json'),
        JSON.stringify(
          {
            app: 'AI-Novel-Studio',
            version: app.getVersion(),
            createdAt: new Date().toISOString(),
            files: ['ai-novel-studio.db'],
            restoreNote: '恢复方式：设置页「从备份恢复」选择此目录（应用会先停止服务再替换，然后自动重启）'
          },
          null,
          2
        ),
        'utf8'
      )
      return { ok: true, path: outDir, copied: 1 }
    } catch (e) {
      console.error('[main] export-backup error:', e)
      return { ok: false, error: String(e) }
    }
  })

  // P18 B + P20（S2）：从备份恢复（停服务 → 替换主库 → 清 wal/shm → 重启服务 → 通知刷新）
  // 复核（52fca79，R8）：恢复前必须 await server 退出（防 SQLITE_BUSY），不触碰运行中数据库
  ipcMain.handle('restore-backup', async (event) => {
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
      // 定位备份目录：用户选的目录本身，或选的是文件取其目录
      const dir = existsSync(src) && !existsSync(join(src, 'ai-novel-studio.db'))
        ? join(src, '..')
        : src
      const dbFile = join(dir, 'ai-novel-studio.db')
      if (!existsSync(dbFile)) {
        return { ok: false, error: '所选位置没有 ai-novel-studio.db（不是有效备份）' }
      }
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
