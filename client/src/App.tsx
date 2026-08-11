import { useEffect, useState, lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import type { BootstrapInfo } from '@shared/types'
import { SettingsPage } from './pages/SettingsPage'
import { Onboarding } from './pages/Onboarding'
import { NovelListPage } from './pages/NovelListPage'
import { NovelGate } from './components/NovelGate'
import { AppLayout } from './components/AppLayout'
import { getApiBaseUrl, setApiBaseUrl, apiFetch } from './api'

// P20（U4）：路由懒加载（22 页面分包，首屏只载当前页）
const NovelWorkspacePage = lazy(() => import('./pages/NovelWorkspacePage').then((m) => ({ default: m.NovelWorkspacePage })))
const ChapterExecutionPage = lazy(() => import('./pages/ChapterExecutionPage').then((m) => ({ default: m.ChapterExecutionPage })))
const DirectorPage = lazy(() => import('./pages/DirectorPage').then((m) => ({ default: m.DirectorPage })))
const CreativeHubPage = lazy(() => import('./pages/CreativeHubPage').then((m) => ({ default: m.CreativeHubPage })))
const TasksPage = lazy(() => import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })))
const TitlesPage = lazy(() => import('./pages/TitlesPage').then((m) => ({ default: m.TitlesPage })))
const HelpPage = lazy(() => import('./pages/HelpPage').then((m) => ({ default: m.HelpPage })))
const AntiAiPage = lazy(() => import('./pages/AntiAiPage').then((m) => ({ default: m.AntiAiPage })))
const BaseCharactersPage = lazy(() => import('./pages/BaseCharactersPage').then((m) => ({ default: m.BaseCharactersPage })))
const FollowUpsPage = lazy(() => import('./pages/FollowUpsPage').then((m) => ({ default: m.FollowUpsPage })))
const StyleEnginePage = lazy(() => import('./pages/StyleEnginePage').then((m) => ({ default: m.StyleEnginePage })))
const BookAnalysisPage = lazy(() => import('./pages/BookAnalysisPage').then((m) => ({ default: m.BookAnalysisPage })))
const GenresPage = lazy(() => import('./pages/GenresPage').then((m) => ({ default: m.GenresPage })))
const StoryModesPage = lazy(() => import('./pages/StoryModesPage').then((m) => ({ default: m.StoryModesPage })))
const WorldsLibraryPage = lazy(() => import('./pages/WorldsLibraryPage').then((m) => ({ default: m.WorldsLibraryPage })))
const KnowledgePage = lazy(() => import('./pages/KnowledgePage').then((m) => ({ default: m.KnowledgePage })))
const PromptWorkbenchPage = lazy(() => import('./pages/PromptWorkbenchPage').then((m) => ({ default: m.PromptWorkbenchPage })))

function PageFallback(): React.JSX.Element {
  return (
    <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>加载中…</div>
  )
}

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
          <Route path="/novels/:novelId" element={<Suspense fallback={<PageFallback />}><NovelWorkspacePage /></Suspense>} />
          <Route path="/novels/:novelId/chapters" element={<Suspense fallback={<PageFallback />}><ChapterExecutionPage /></Suspense>} />
          <Route path="/novels/:novelId/director" element={<Suspense fallback={<PageFallback />}><DirectorPage /></Suspense>} />
          <Route path="/novels/:novelId/hub" element={<Suspense fallback={<PageFallback />}><CreativeHubPage /></Suspense>} />
          <Route path="/tasks" element={<Suspense fallback={<PageFallback />}><TasksPage /></Suspense>} />
          <Route path="/titles" element={<Suspense fallback={<PageFallback />}><TitlesPage /></Suspense>} />
          <Route path="/help" element={<Suspense fallback={<PageFallback />}><HelpPage /></Suspense>} />
          <Route path="/anti-ai" element={<Suspense fallback={<PageFallback />}><AntiAiPage /></Suspense>} />
          <Route path="/base-characters" element={<Suspense fallback={<PageFallback />}><BaseCharactersPage /></Suspense>} />
          <Route path="/follow-ups" element={<Suspense fallback={<PageFallback />}><FollowUpsPage /></Suspense>} />
          <Route path="/style-engine" element={<Suspense fallback={<PageFallback />}><StyleEnginePage /></Suspense>} />
          <Route path="/book-analysis" element={<Suspense fallback={<PageFallback />}><BookAnalysisPage /></Suspense>} />
          <Route path="/genres" element={<Suspense fallback={<PageFallback />}><GenresPage /></Suspense>} />
          <Route path="/story-modes" element={<Suspense fallback={<PageFallback />}><StoryModesPage /></Suspense>} />
          <Route path="/worlds" element={<Suspense fallback={<PageFallback />}><WorldsLibraryPage /></Suspense>} />
          <Route path="/knowledge" element={<Suspense fallback={<PageFallback />}><KnowledgePage /></Suspense>} />
          <Route path="/prompt-workbench" element={<Suspense fallback={<PageFallback />}><PromptWorkbenchPage /></Suspense>} />
          <Route path="/hub" element={<Suspense fallback={<PageFallback />}><CreativeHubPage /></Suspense>} />
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
