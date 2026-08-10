import { contextBridge, ipcRenderer } from 'electron'

const api = {
  onServerReady: (callback: (baseUrl: string) => void): (() => void) => {
    const listener = (_event: unknown, baseUrl: string): void => callback(baseUrl)
    ipcRenderer.on('server-ready', listener)
    return () => ipcRenderer.removeListener('server-ready', listener)
  },
  // P11-1.2：主动拉取缓存的 server URL（防 IPC 消息竞态丢失）
  getServerUrl: (): Promise<string | null> => ipcRenderer.invoke('get-server-url') as Promise<string | null>,
  // P13 F0：主题同步（nativeTheme + 标题栏 overlay）
  setTheme: (theme: string): Promise<boolean> => ipcRenderer.invoke('theme-set', theme) as Promise<boolean>,
  // P16 P0：数据管理
  openDataDir: (): Promise<boolean> => ipcRenderer.invoke('open-data-dir') as Promise<boolean>,
  wipeData: (): Promise<boolean> => ipcRenderer.invoke('wipe-data') as Promise<boolean>,
  // P18 B：备份导出/恢复
  exportBackup: (): Promise<{ ok: boolean; canceled?: boolean; path?: string; copied?: number; error?: string }> =>
    ipcRenderer.invoke('export-backup') as Promise<{ ok: boolean; canceled?: boolean; path?: string; copied?: number; error?: string }>,
  restoreBackup: (): Promise<{ ok: boolean; canceled?: boolean; restoredFrom?: string; error?: string }> =>
    ipcRenderer.invoke('restore-backup') as Promise<{ ok: boolean; canceled?: boolean; restoredFrom?: string; error?: string }>,
  platform: process.platform
}

contextBridge.exposeInMainWorld('novelStudio', api)

export type NovelStudioApi = typeof api
