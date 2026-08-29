// 主题联动（重构计划 R8 / P13 F0）：nativeTheme 同步 + titleBarOverlay 配色。
import { ipcMain, nativeTheme } from 'electron'
import { getMainWindow } from './state'
import { assertTrustedSender } from './ipc'

// P13 F0：主题联动（nativeTheme 同步 + titleBarOverlay 配色）
export const THEME_OVERLAY: Record<string, { color: string; symbolColor: string }> = {
  deepblue: { color: '#15171d', symbolColor: '#c7cdd8' },
  'feelfish-green': { color: '#181818', symbolColor: '#c7d1cb' },
  'purple-night': { color: '#1a1726', symbolColor: '#c3bfd8' },
  ocean: { color: '#13202c', symbolColor: '#b8cdd8' },
  amber: { color: '#211a13', symbolColor: '#cdbfae' },
  paper: { color: '#ffffff', symbolColor: '#4c554f' },
  sepia: { color: '#faf3e0', symbolColor: '#4a3f2f' }
}

export function registerThemeIpc(): void {
  ipcMain.handle('theme-set', (event, theme: string) => {
    // v0.23.1（批次 A6）：窗口外观变更同样限定主窗口顶层 frame（对齐破坏性 IPC 防线）
    try {
      assertTrustedSender(event)
    } catch {
      return false
    }
    const dark = theme !== 'paper' && theme !== 'sepia'
    nativeTheme.themeSource = dark ? 'dark' : 'light'
    const overlay = THEME_OVERLAY[theme] ?? THEME_OVERLAY.deepblue
    getMainWindow()?.setTitleBarOverlay({ color: overlay.color, symbolColor: overlay.symbolColor, height: 40 })
    return true
  })
}
