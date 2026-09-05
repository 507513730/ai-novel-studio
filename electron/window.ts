// 窗口与应用菜单（重构计划 R8 / spec §3.7）：窗口创建与安全策略的唯一实现。
// 安全面（契约测试锁定）：contextIsolation+sandbox、只放行 http/https 外链、
// 阻止导航离开本应用、titleBarOverlay 配色随主题。
import { BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getLastServerUrl, setMainWindow } from './state'

// v0.9.0（审查 #16）：只放行 http/https 外链（file:/smb:/自定义协议一律拒绝）
export function isAllowedExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

// v0.9.0（审查 #16）：阻止渲染进程将应用窗口导航到外部站点
export function isAllowedNavigation(
  url: string,
  devUrl: string | undefined,
  rendererUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href
): boolean {
  try {
    const target = new URL(url)
    if (target.username || target.password) return false
    if (devUrl) {
      const expected = new URL(devUrl)
      return (expected.protocol === 'http:' || expected.protocol === 'https:')
        && target.origin === expected.origin
    }
    const expected = new URL(rendererUrl)
    target.hash = expected.hash = ''
    target.search = expected.search = ''
    return target.protocol === 'file:' && target.href === expected.href
  } catch {
    return false
  }
}

export function createWindow(): void {
  const mainWindow = new BrowserWindow({
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
      // v0.9.0（审查 #16）：sandbox 开启——preload 仅用 ipcRenderer/contextBridge/process.platform，兼容
      sandbox: true
    }
  })
  setMainWindow(mainWindow)

  mainWindow.on('ready-to-show', () => mainWindow.show())
  // P11-1.2：renderer 加载完成后补发缓存的 server URL（竞态兜底）
  mainWindow.webContents.on('did-finish-load', () => {
    const url = getLastServerUrl()
    if (url) {
      mainWindow.webContents.send('server-ready', url)
    }
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, process.env.ELECTRON_RENDERER_URL)) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function createMenu(): void {
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
