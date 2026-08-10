/// <reference types="vite/client" />

interface NovelStudioApi {
  onServerReady: (callback: (baseUrl: string) => void) => () => void
  getServerUrl: () => Promise<string | null>
  setTheme: (theme: string) => Promise<boolean>
  openDataDir: () => Promise<boolean>
  wipeData: () => Promise<boolean>
  exportBackup: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; copied?: number; error?: string }>
  restoreBackup: () => Promise<{ ok: boolean; canceled?: boolean; restoredFrom?: string; error?: string }>
  platform: string
}

declare global {
  interface Window {
    novelStudio?: NovelStudioApi
  }
}

export {}
