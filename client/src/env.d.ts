/// <reference types="vite/client" />

interface NovelStudioApi {
  onServerReady: (callback: (baseUrl: string) => void) => () => void
  getServerUrl: () => Promise<string | null>
  setTheme: (theme: string) => Promise<boolean>
  openDataDir: () => Promise<boolean>
  wipeData: () => Promise<boolean>
  platform: string
}

declare global {
  interface Window {
    novelStudio?: NovelStudioApi
  }
}

export {}
