import { app, BrowserWindow, utilityProcess, shell, safeStorage, Menu, ipcMain, nativeTheme, dialog } from 'electron'
import { join } from 'node:path'
import { mkdirSync, rmSync, copyFileSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

let mainWindow: BrowserWindow | null = null
let serverProcess: Electron.UtilityProcess | null = null
// P11-1.2：缓存 server URL（防 server-ready 早于 renderer 监听导致消息丢失）
let lastServerUrl: string | null = null
// P20（S1）：renderer 调用本地 API 的鉴权 token（经 preload 注入，恶意网页拿不到）
const SERVER_TOKEN = randomBytes(32).toString('hex')

// P20（S2）：便携版数据目录统一（export/restore/wipe/open-data-dir 与 server 使用同一目录）
function getDataDir(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    const d = join(process.env.PORTABLE_EXECUTABLE_DIR, 'data')
    try {
      mkdirSync(d, { recursive: true })
      return d
    } catch {
      /* 不可写时回退 userData */
    }
  }
  return app.getPath('userData')
}

ipcMain.handle('get-server-url', () => lastServerUrl)
// P20（S1）：renderer 请求 token（sendSync 同步返回）
ipcMain.on('get-server-token', (event) => {
  event.returnValue = SERVER_TOKEN
})

// P13 F0：主题联动（nativeTheme 同步 + titleBarOverlay 配色）
const THEME_OVERLAY: Record<string, { color: string; symbolColor: string }> = {
  deepblue: { color: '#15171d', symbolColor: '#c7cdd8' },
  'feelfish-green': { color: '#181818', symbolColor: '#c7d1cb' },
  'purple-night': { color: '#1a1726', symbolColor: '#c3bfd8' },
  ocean: { color: '#13202c', symbolColor: '#b8cdd8' },
  amber: { color: '#211a13', symbolColor: '#cdbfae' },
  paper: { color: '#ffffff', symbolColor: '#4c554f' }
}
ipcMain.handle('theme-set', (_e, theme: string) => {
  const dark = theme !== 'paper'
  nativeTheme.themeSource = dark ? 'dark' : 'light'
  const overlay = THEME_OVERLAY[theme] ?? THEME_OVERLAY.deepblue
  mainWindow?.setTitleBarOverlay({ color: overlay.color, symbolColor: overlay.symbolColor, height: 40 })
  return true
})

// P16 P0：数据管理（打开数据目录 / 清除全部数据）——P20 统一便携版目录
ipcMain.handle('open-data-dir', () => {
  void shell.openPath(getDataDir())
  return true
})
ipcMain.handle('wipe-data', () => {
  try {
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

// P18 B + P20（S2）：导出备份（先 checkpoint 保证原子，只导出主库文件）
ipcMain.handle('export-backup', async () => {
  try {
    const dataDir = getDataDir()
    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    const defaultName = `ai-novel-studio-backup-${stamp}`
    const picked = await dialog.showSaveDialog(mainWindow!, {
      title: '导出数据备份',
      defaultPath: join(app.getPath('documents'), defaultName),
      buttonLabel: '导出备份',
      properties: ['createDirectory']
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    // P20：请求 server 执行 wal_checkpoint(TRUNCATE)（WAL 落主库），保证备份原子
    const sp = serverProcess
    if (sp) {
      await new Promise<void>((resolve) => {
        const id = `cp-${Date.now()}`
        const onMsg = (msg: unknown): void => {
          const m = msg as { type?: string; id?: string }
          if (m?.id === id && (m.type === 'checkpoint-done' || m.type === 'checkpoint-error')) {
            sp.off('message', onMsg)
            resolve()
          }
        }
        sp.on('message', onMsg)
        sp.postMessage({ type: 'checkpoint', id })
        setTimeout(resolve, 5000) // 兜底：5s 内未应答也继续（WAL 可能为空）
      })
    }
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
ipcMain.handle('restore-backup', async () => {
  try {
    const dataDir = getDataDir()
    const picked = await dialog.showOpenDialog(mainWindow!, {
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
      const ok = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        title: '版本不一致',
        message: `备份来自 v${backupVersion}，当前应用为 v${app.getVersion()}。\n恢复后将以当前应用打开旧备份数据（数据库会自动补齐缺失字段）。\n继续恢复？`,
        buttons: ['继续恢复', '取消'],
        defaultId: 1
      })
      if (ok.response !== 0) return { ok: false, canceled: true }
    }
    // 1) 停服务（Windows 下数据库文件被 server 独占，必须释放）
    const hadServer = serverProcess !== null
    if (serverProcess) {
      const proc = serverProcess
      serverProcess = null
      proc.kill()
      await new Promise((r) => setTimeout(r, 800))
    }
    // 2) 替换主库 + 清除旧 wal/shm（恢复后由 SQLite 按主库重建 WAL）
    copyFileSync(dbFile, join(dataDir, 'ai-novel-studio.db'))
    for (const f of ['ai-novel-studio.db-wal', 'ai-novel-studio.db-shm']) {
      const t = join(dataDir, f)
      if (existsSync(t)) rmSync(t, { force: true })
    }
    // 3) 重启服务
    if (hadServer) {
      try {
        startServer()
      } catch (e) {
        console.error('[main] restore: server restart failed:', e)
        return { ok: true, warning: '数据已恢复，但服务重启失败，请手动重启应用', restoredFrom: dir }
      }
    }
    // 4) 通知渲染端刷新（恢复后旧页面状态已失效）
    mainWindow?.webContents.send('data-restored')
    return { ok: true, restoredFrom: dir }
  } catch (e) {
    console.error('[main] restore-backup error:', e)
    return { ok: false, error: String(e) }
  }
})

function getServerEntry(): string {
  return join(__dirname, 'server.js')
}

function startServer(): void {
  // P6-3 + P20（S2）：portable 版数据跟随可执行文件（与备份/恢复/清数据统一目录）
  const userData = getDataDir()
  serverProcess = utilityProcess.fork(getServerEntry(), [], {
    env: {
      ...(process.env as Record<string, string>),
      AI_NOVEL_USER_DATA: userData,
      AI_NOVEL_APP_VERSION: app.getVersion(),
      AI_NOVEL_PORT: process.env.ELECTRON_RENDERER_URL ? '3000' : '0',
      SERVER_TOKEN
    },
    serviceName: 'ai-novel-server',
    stdio: 'inherit'
  })
  serverProcess.on('message', (msg: unknown) => {
    const m = msg as { type?: string; port?: number; error?: string; id?: string; value?: string }
    if (m?.type === 'ready' && typeof m.port === 'number') {
      console.log(`[main] server ready on http://127.0.0.1:${m.port}`)
      lastServerUrl = `http://127.0.0.1:${m.port}/api`
      if (mainWindow && !mainWindow.webContents.isLoading()) {
        mainWindow.webContents.send('server-ready', lastServerUrl)
      }
    } else if (m?.type === 'error') {
      console.error('[main] server error:', m.error)
    } else if ((m?.type === 'encrypt' || m?.type === 'decrypt') && typeof m.id === 'string') {
      handleCrypto(m as { type: 'encrypt' | 'decrypt'; id: string; value?: string })
    }
  })
  serverProcess.on('exit', (code) => {
    console.log(`[main] server process exited with code ${code}`)
    serverProcess = null
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'AI 小说创作工作台',
    // P12 B3：无边框标题栏（Windows 保留原生窗口按钮 + 自定义标题栏拖拽区）
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: '#15171d', symbolColor: '#c7cdd8', height: 40 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  // P11-1.2：renderer 加载完成后补发缓存的 server URL（竞态兜底）
  mainWindow.webContents.on('did-finish-load', () => {
    if (lastServerUrl) {
      mainWindow?.webContents.send('server-ready', lastServerUrl)
    }
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function handleCrypto(m: { type: 'encrypt' | 'decrypt'; id: string; value?: string }): void {
  const reply = (payload: Record<string, unknown>): void => {
    serverProcess?.postMessage({ type: 'crypto-result', id: m.id, ...payload })
  }
  try {
    if (m.type === 'encrypt' && m.value !== undefined) {
      if (!safeStorage.isEncryptionAvailable()) {
        reply({ value: m.value })
        return
      }
      reply({ value: safeStorage.encryptString(m.value).toString('base64') })
    } else if (m.type === 'decrypt' && m.value !== undefined) {
      if (!safeStorage.isEncryptionAvailable() || !m.value) {
        reply({ value: m.value })
        return
      }
      reply({ value: safeStorage.decryptString(Buffer.from(m.value, 'base64')) })
    }
  } catch (err) {
    reply({ error: String(err) })
  }
}

function createMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '文件',
      submenu: [
        { label: '退出', role: 'quit', accelerator: isMac ? 'Cmd+Q' : 'Alt+F4' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  createMenu()
  startServer()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    serverProcess?.kill()
  } catch {
    /* ignore */
  }
  serverProcess = null
})
