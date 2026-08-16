import { contextBridge, ipcRenderer } from 'electron'

// P20（S1）：renderer 调用本地 API 的鉴权 token（main 生成注入，恶意网页拿不到）
// sendSync 在 preload 加载期同步取得（renderer 进程 env 不含 main 的 SERVER_TOKEN）
const SERVER_TOKEN = ipcRenderer.sendSync('get-server-token') as string

const api = {
  serverToken: SERVER_TOKEN,
  onServerReady: (callback: (baseUrl: string) => void): (() => void) => {
    const listener = (_event: unknown, baseUrl: string): void => callback(baseUrl)
    ipcRenderer.on('server-ready', listener)
    return () => ipcRenderer.removeListener('server-ready', listener)
  },
  // P11-1.2：主动拉取缓存的 server URL（防 IPC 消息竞态丢失）
  getServerUrl: (): Promise<string | null> => ipcRenderer.invoke('get-server-url') as Promise<string | null>,
  // v0.23.1（批次 A2）：server 异常退出通知（M16 补全——main 侧早已发送，此前 preload 未暴露、renderer 收不到）
  onServerLost: (callback: (code: string) => void): (() => void) => {
    const listener = (_event: unknown, code: string): void => callback(code)
    ipcRenderer.on('server-lost', listener)
    return () => ipcRenderer.removeListener('server-lost', listener)
  },
  // P13 F0：主题同步（nativeTheme + 标题栏 overlay）
  setTheme: (theme: string): Promise<boolean> => ipcRenderer.invoke('theme-set', theme) as Promise<boolean>,
  // P16 P0：数据管理
  openDataDir: (): Promise<boolean> => ipcRenderer.invoke('open-data-dir') as Promise<boolean>,
  wipeData: (): Promise<boolean> => ipcRenderer.invoke('wipe-data') as Promise<boolean>,
  // P18 B + P20（S2）：备份导出/恢复（恢复会停止并重启服务，恢复后触发 onDataRestored）
  exportBackup: (): Promise<{ ok: boolean; canceled?: boolean; path?: string; copied?: number; error?: string }> =>
    ipcRenderer.invoke('export-backup') as Promise<{ ok: boolean; canceled?: boolean; path?: string; copied?: number; error?: string }>,
  // v0.9.2（O4）：每日自动备份信息（设置页展示最近备份时间/份数）
  getAutoBackupInfo: (): Promise<{ lastAt: string | null; count: number; keep: number }> =>
    ipcRenderer.invoke('get-auto-backup-info') as Promise<{ lastAt: string | null; count: number; keep: number }>,
  restoreBackup: (): Promise<{ ok: boolean; canceled?: boolean; restoredFrom?: string; warning?: string; error?: string }> =>
    ipcRenderer.invoke('restore-backup') as Promise<{ ok: boolean; canceled?: boolean; restoredFrom?: string; warning?: string; error?: string }>,
  onDataRestored: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('data-restored', listener)
    return () => ipcRenderer.removeListener('data-restored', listener)
  },
  // v0.16.0：应用更新（仅打包态可用；便携版返回 unsupported）
  updaterCheck: (): Promise<{ ok: boolean; reason?: string; state?: unknown }> =>
    ipcRenderer.invoke('updater-check') as Promise<{ ok: boolean; reason?: string; state?: unknown }>,
  updaterDownload: (): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('updater-download') as Promise<{ ok: boolean; reason?: string }>,
  updaterInstall: (): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('updater-install') as Promise<{ ok: boolean; reason?: string }>,
  updaterStatus: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('updater-status') as Promise<Record<string, unknown>>,
  onUpdaterStatus: (callback: (status: Record<string, unknown>) => void): (() => void) => {
    const listener = (_event: unknown, status: Record<string, unknown>): void => callback(status)
    ipcRenderer.on('updater-status', listener)
    return () => ipcRenderer.removeListener('updater-status', listener)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('novelStudio', api)

export type NovelStudioApi = typeof api
