/// <reference types="vite/client" />

interface NovelStudioApi {
  onServerReady: (callback: (baseUrl: string) => void) => () => void
  getServerUrl: () => Promise<string | null>
  setTheme: (theme: string) => Promise<boolean>
  openDataDir: () => Promise<boolean>
  wipeData: () => Promise<boolean>
  exportBackup: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; copied?: number; error?: string }>
  restoreBackup: () => Promise<{ ok: boolean; canceled?: boolean; restoredFrom?: string; error?: string }>
  // v0.9.2（O4）：每日自动备份信息
  getAutoBackupInfo: () => Promise<{ lastAt: string | null; count: number; keep: number }>
  // v0.16.0：应用更新
  updaterCheck: () => Promise<{ ok: boolean; reason?: string; state?: unknown }>
  updaterDownload: () => Promise<{ ok: boolean; reason?: string }>
  updaterInstall: () => Promise<{ ok: boolean; reason?: string }>
  updaterStatus: () => Promise<Record<string, unknown>>
  onUpdaterStatus: (callback: (status: Record<string, unknown>) => void) => () => void
  platform: string
}

declare global {
  interface Window {
    novelStudio?: NovelStudioApi
  }
  // 版本单一来源：vite define 注入（package.json version）
  const __APP_VERSION__: string
}

export {}
