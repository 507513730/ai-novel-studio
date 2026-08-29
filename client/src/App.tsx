import { useEffect, useState, lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import type { BootstrapInfo } from '@shared/types'
import { SettingsPage } from './pages/SettingsPage'
import { Onboarding } from './pages/Onboarding'
import { NovelListPage } from './pages/NovelListPage'
import { NovelGate } from './components/NovelGate'
import { AppLayout } from './components/AppLayout'
import { getApiBaseUrl, setApiBaseUrl, apiFetch } from './api'
import { initShortcuts } from './utils/shortcuts'
import { setCnyRate } from './utils/costEstimate'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'

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
const StudioPage = lazy(() => import('./pages/StudioPage').then((m) => ({ default: m.StudioPage })))
const AgentsLibraryPage = lazy(() => import('./pages/AgentsLibraryPage').then((m) => ({ default: m.AgentsLibraryPage })))
const StatsPage = lazy(() => import('./pages/StatsPage').then((m) => ({ default: m.StatsPage })))
const ForgePage = lazy(() => import('./pages/ForgePage').then((m) => ({ default: m.ForgePage })))

// P22-C2：骨架屏（路由懒加载 fallback）——v0.26.0 收敛到全局 .skeleton（index.css）
function PageFallback(): React.JSX.Element {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="skeleton skeleton-title" />
      <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="skeleton skeleton-text" style={{ width: '70%' }} />
        <div className="skeleton skeleton-text" style={{ width: '55%' }} />
        <div className="skeleton skeleton-text" style={{ width: '85%' }} />
        <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      </div>
      <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="skeleton skeleton-text" style={{ width: '45%' }} />
        <div className="skeleton skeleton-text" style={{ width: '75%' }} />
        <div className="skeleton skeleton-text" style={{ width: '50%' }} />
      </div>
    </div>
  )
}

// v0.25.0（审查 L2）：页面级错误边界 + 懒加载兜底。
// 此前全应用只有 root 一层 ErrorBoundary——任一页面抛错即整应用白屏、只能刷新，
// 未保存的章节正文随之丢失。现每页独立包裹，路由切换（resetKey=pathname）自动复位，
// 单页崩溃后仍可经左侧导航切换到其他页面。
function Page({ name, children }: { name: string; children: React.ReactNode }): React.JSX.Element {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary name={name} resetKey={pathname}>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

export function App(): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  // v0.17.0（审查 C25）：命令面板状态提升到组件顶层——此前在 useEffect 源序之后声明（先使用后声明）
  const [commandOpen, setCommandOpen] = useState(false)
  // v0.23.1（批次 A2）：server 异常退出标记（M16 补全——此前 renderer 无法感知，静默指向死服务）
  const [serverLost, setServerLost] = useState<string | null>(null)

  useEffect(() => {
    if (window.novelStudio) {
      const unsubReady = window.novelStudio.onServerReady((url) => {
        setApiBaseUrl(url)
        setBaseUrl(url)
      })
      const unsubLost = window.novelStudio.onServerLost((code) => {
        setServerLost(code)
        setBaseUrl(null)
      })
      // P11-1.2：主动拉取缓存的 server URL（防 server-ready 消息早于监听丢失）
      void window.novelStudio
        .getServerUrl()
        .then((url) => {
          if (url) {
            setApiBaseUrl(url)
            setBaseUrl(url)
          }        })
        .catch(() => undefined)
      return () => {
        unsubReady()
        unsubLost()
      }
    }
    setBaseUrl(getApiBaseUrl())
    return undefined
  }, [])

  // P11-1.2：兜底——Electron 下仍无 URL 时轮询探测 server（server-ready 消息丢失的兜底）
  // v0.9.0（审查 C）：改走 preload 的 getServerUrl（不猜端口——生产端口随机，硬编码 3000 无意义）
  useEffect(() => {
    if (baseUrl || !window.novelStudio) return
    const api = window.novelStudio
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      if (attempts > 30) {
        clearInterval(timer)
        return
      }
      void api
        .getServerUrl()
        .then((url) => {
          if (url) {
            setApiBaseUrl(url)
            setBaseUrl(url)
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

  // P27 1-9：全局快捷键注册（命令面板直接处理，其余走事件桥由页面监听）
  useEffect(() => {
    return initShortcuts({
      'command-palette': () => setCommandOpen((v) => !v)
    })
  }, [])

  // v0.16.0：启动拉取汇率 → fmtCost 人民币显示（服务端已换算/回传汇率）
  // v0.17.0（审查 H8）：改 apiFetch——此前手动 fetch 拼出双 /api 且无 token/超时 → 恒兜底 7.2
  useEffect(() => {
    if (!baseUrl) return
    void apiFetch('/settings/app')
      .then((d) => {
        const r = d as { cnyUsdRate?: number } | null
        if (r?.cnyUsdRate) setCnyRate(r.cnyUsdRate)
      })
      .catch(() => undefined)
  }, [baseUrl])

  // P27 2-7：命令面板（搜小说 + 跳页面）
  // v0.23.1（批次 A2）：server 异常退出——明确告知并引导重启（不再静默指向死服务）
  if (serverLost) {
    return (
      <div style={{ padding: 40 }} className="panel">
        <h2>本地服务已异常退出</h2>
        <p className="muted">
          服务进程退出（代码 {serverLost}），生成/保存等操作已不可用。请重启应用；若反复出现，请从设置页打开数据目录查看日志并反馈。
        </p>
      </div>
    )
  }
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
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Page name="小说列表"><NovelListPage /></Page>} />
          <Route path="/novels/:novelId" element={<Page name="工作台"><NovelWorkspacePage /></Page>} />
          <Route path="/novels/:novelId/chapters" element={<Page name="章节执行"><ChapterExecutionPage /></Page>} />
          <Route path="/novels/:novelId/director" element={<Page name="自动导演"><DirectorPage /></Page>} />
          <Route path="/novels/:novelId/hub" element={<Page name="创作工坊"><CreativeHubPage /></Page>} />
          <Route path="/tasks" element={<Page name="任务中心"><TasksPage /></Page>} />
          <Route path="/titles" element={<Page name="标题工坊"><TitlesPage /></Page>} />
          <Route path="/help" element={<Page name="帮助"><HelpPage /></Page>} />
          <Route path="/anti-ai" element={<Page name="反 AI 规则"><AntiAiPage /></Page>} />
          <Route path="/base-characters" element={<Page name="基础角色库"><BaseCharactersPage /></Page>} />
          <Route path="/follow-ups" element={<Page name="待办跟进"><FollowUpsPage /></Page>} />
          <Route path="/novels/:novelId/stats" element={<Page name="写作统计"><StatsPage /></Page>} />
          <Route path="/forge" element={<Page name="网文要素工坊"><ForgePage /></Page>} />
          <Route path="/style-engine" element={<Page name="写法引擎"><StyleEnginePage /></Page>} />
          <Route path="/book-analysis" element={<Page name="拆书分析"><BookAnalysisPage /></Page>} />
          <Route path="/genres" element={<Page name="流派管理"><GenresPage /></Page>} />
          <Route path="/story-modes" element={<Page name="推进模式库"><StoryModesPage /></Page>} />
          <Route path="/worlds" element={<Page name="世界样本库"><WorldsLibraryPage /></Page>} />
          <Route path="/knowledge" element={<Page name="知识库"><KnowledgePage /></Page>} />
          <Route path="/prompt-workbench" element={<Page name="提示词工作台"><PromptWorkbenchPage /></Page>} />
          <Route path="/studio" element={<Page name="智能体工坊"><StudioPage /></Page>} />
          <Route path="/agents-library" element={<Page name="智能体库"><AgentsLibraryPage /></Page>} />
          <Route path="/hub" element={<Page name="创作工坊"><CreativeHubPage /></Page>} />
          <Route path="/director" element={<NovelGate title="自动导演" desc="从灵感推进到可写章节（11 阶段）。选择一本书进入。请先创建或选择小说。" target={(n) => `/novels/${n}/director`} />} />
          <Route path="/chapters" element={<NovelGate title="章节执行" desc="逐章生成、审核、修复、回灌。选择一本书进入。请先创建或选择小说。" target={(n) => `/novels/${n}/chapters`} />} />
          <Route path="/settings" element={<Page name="设置"><SettingsPage /></Page>} />
          <Route path="/settings/routes" element={<Page name="设置"><SettingsPage initialTab="routes" /></Page>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
