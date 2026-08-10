import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import type { BootstrapInfo } from '@shared/types'
import { SettingsPage } from './pages/SettingsPage'
import { Onboarding } from './pages/Onboarding'
import { NovelListPage } from './pages/NovelListPage'
import { NovelWorkspacePage } from './pages/NovelWorkspacePage'
import { ChapterExecutionPage } from './pages/ChapterExecutionPage'
import { DirectorPage } from './pages/DirectorPage'
import { CreativeHubPage } from './pages/CreativeHubPage'
import { TasksPage } from './pages/TasksPage'
import { TitlesPage } from './pages/TitlesPage'
import { HelpPage } from './pages/HelpPage'
import { AntiAiPage } from './pages/AntiAiPage'
import { BaseCharactersPage } from './pages/BaseCharactersPage'
import { FollowUpsPage } from './pages/FollowUpsPage'
import { StyleEnginePage } from './pages/StyleEnginePage'
import { BookAnalysisPage } from './pages/BookAnalysisPage'
import { GenresPage } from './pages/GenresPage'
import { StoryModesPage } from './pages/StoryModesPage'
import { WorldsLibraryPage } from './pages/WorldsLibraryPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { PromptWorkbenchPage } from './pages/PromptWorkbenchPage'
import { NovelGate } from './components/NovelGate'
import { AppLayout } from './components/AppLayout'
import { getApiBaseUrl, setApiBaseUrl, apiFetch } from './api'

export function App(): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState<string | null>(null)

  useEffect(() => {
    if (window.novelStudio) {
      const unsubscribe = window.novelStudio.onServerReady((url) => {
        setApiBaseUrl(url)
        setBaseUrl(url)
      })
      // P11-1.2：主动拉取缓存的 server URL（防 server-ready 消息早于监听丢失）
      void window.novelStudio
        .getServerUrl()
        .then((url) => {
          if (url) {
            setApiBaseUrl(url)
            setBaseUrl(url)
          }
        })
        .catch(() => undefined)
      return unsubscribe
    }
    setBaseUrl(getApiBaseUrl())
    return undefined
  }, [])

  // P11-1.2：兜底——Electron 下仍无 URL 时轮询健康检查探测 server
  useEffect(() => {
    if (baseUrl || !window.novelStudio) return
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      if (attempts > 30) {
        clearInterval(timer)
        return
      }
      void fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(2000) })
        .then((r) => {
          if (r.ok) {
            setApiBaseUrl('http://127.0.0.1:3000/api')
            setBaseUrl('http://127.0.0.1:3000/api')
            clearInterval(timer)
          }
        })
        .catch(() => undefined)
    }, 2000)
    return () => clearInterval(timer)
  }, [baseUrl])

  const bootstrap = useQuery<BootstrapInfo>({
    queryKey: ['bootstrap'],
    queryFn: async () => (await apiFetch('/settings/bootstrap')) as BootstrapInfo,
    enabled: baseUrl !== null,
    retry: 3,
    retryDelay: 1000
  })

  if (!baseUrl) return <div style={{ padding: 40 }}>正在启动本地服务…</div>
  if (bootstrap.isLoading) return <div style={{ padding: 40 }}>正在连接本地服务…</div>
  if (bootstrap.isError) {
    return (
      <div style={{ padding: 40 }} className="panel">
        <h2>无法连接本地服务</h2>
        <p className="muted">{String(bootstrap.error)}</p>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => void bootstrap.refetch()}>重试</button>
        </div>
      </div>
    )
  }

  const info = bootstrap.data
  if (info?.firstRun || !info?.hasApiKey) {
    return <Onboarding onDone={() => void bootstrap.refetch()} />
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<NovelListPage />} />
          <Route path="/novels/:novelId" element={<NovelWorkspacePage />} />
          <Route path="/novels/:novelId/chapters" element={<ChapterExecutionPage />} />
          <Route path="/novels/:novelId/director" element={<DirectorPage />} />
          <Route path="/novels/:novelId/hub" element={<CreativeHubPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/titles" element={<TitlesPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/anti-ai" element={<AntiAiPage />} />
          <Route path="/base-characters" element={<BaseCharactersPage />} />
          <Route path="/follow-ups" element={<FollowUpsPage />} />
          <Route path="/style-engine" element={<StyleEnginePage />} />
          <Route path="/book-analysis" element={<BookAnalysisPage />} />
          <Route path="/genres" element={<GenresPage />} />
          <Route path="/story-modes" element={<StoryModesPage />} />
          <Route path="/worlds" element={<WorldsLibraryPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/prompt-workbench" element={<PromptWorkbenchPage />} />
          <Route path="/hub" element={<CreativeHubPage />} />
          <Route path="/director" element={<NovelGate title="自动导演" desc="从灵感推进到可写章节（11 阶段）。选择一本书进入。请先创建或选择小说。" target={(n) => `/novels/${n}/director`} />} />
          <Route path="/chapters" element={<NovelGate title="章节执行" desc="逐章生成、审核、修复、回灌。选择一本书进入。请先创建或选择小说。" target={(n) => `/novels/${n}/chapters`} />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/routes" element={<SettingsPage initialTab="routes" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
