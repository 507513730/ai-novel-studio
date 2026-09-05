import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  House,
  BookOpenText,
  Brain,
  Clapperboard,
  Feather,
  Tags,
  Search,
  Settings,
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  ListChecks,
  Type,
  CircleHelp,
  Workflow,
  ShieldCheck,
  UsersRound,
  Gauge,
  Globe2,
  Database,
  Braces,
  WandSparkles,
  Bot,
  BarChart3,
  Hammer
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { novelApi } from '../api'
import { useToast } from './toastGlobal'

// P11-2：全局侧栏（学习参考项目 Sidebar：数据驱动 navGroups + 激活指示条 + 折叠持久化）

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  requiresNovel?: boolean
  disabled?: boolean
  badge?: string
  /** 仅精确匹配该路径时高亮（工作台用：/novels/:id 的子路由由各自条目高亮） */
  exact?: boolean
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const SIDEBAR_KEY = 'ai-novel.sidebar.collapsed'

function bookPath(novelId: number | null, path: string): string {
  return novelId ? `/novels/${novelId}${path}` : path
}

export function AppLayout(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1'
    } catch {
      return false
    }
  })

  // 从 URL 解析当前书 id（书级导航用）
  const novelMatch = location.pathname.match(/\/novels\/(\d+)/)
  const novelId = novelMatch ? Number(novelMatch[1]) : null

  // P12 A1：失败任务徽章（延迟 500ms 启用防首屏闪烁）；P16 P1：条件轮询（仅活动任务时）
  // v0.23.1（批次 E5）：收编 react-query——单一 ['jobs'] 缓存与 NovelListPage/TasksPage 共享
  // （此前手写 setInterval + 本地 state，三处轮询三份缓存）
  const [badgeReady, setBadgeReady] = useState(false)
  const [jobsOpen, setJobsOpen] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setBadgeReady(true), 500)
    return () => clearTimeout(timer)
  }, [])
  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: novelApi.jobs,
    enabled: badgeReady,
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs
      const active = jobs?.some((j) => j.status === 'running' || j.status === 'queued') ?? true
      return active ? 4000 : 15000
    }
  })
  const allJobs = jobsQuery.data?.jobs ?? []
  const failedCount = allJobs.filter((j) => j.status === 'failed').length
  // P13 G8：全局运行任务（悬浮状态）+ P27 1-5：可展开进度浮层
  const runningJobs = allJobs
    .filter((j) => j.status === 'running' || j.status === 'queued')
    .map((j) => ({ id: Number(j.id), type: String(j.type), progress: Number(j.progress ?? 0) }))

  // v0.26.0（审查 P0-3）：书级条目带书时直连书内路由（此前章节执行/自动导演/创作中枢恒走选书落地页）；
  // 「工作台」无书时不再退化为 '/' 与「小说列表」撞车（双高亮根因），点击按 requiresNovel 引导选书。
  const navGroups: NavGroup[] = [
    {
      title: '创作',
      items: [
        { to: '/', label: '小说列表', icon: House },
        { to: '/help', label: '创作向导', icon: CircleHelp },
        { to: '/studio', label: '创造工坊', icon: WandSparkles },
        { to: '/tasks', label: '任务中心', icon: ListChecks, badge: failedCount > 0 ? `F${failedCount}` : undefined },
        { to: '/follow-ups', label: '导演跟进', icon: Workflow },
        { to: bookPath(novelId, '/stats'), label: '写作统计', icon: BarChart3, requiresNovel: true },
        { to: bookPath(novelId, '/hub'), label: '创作中枢', icon: Brain },
        { to: bookPath(novelId, '/director'), label: '自动导演', icon: Clapperboard },
        { to: bookPath(novelId, '/chapters'), label: '章节执行', icon: BookOpenText }
      ]
    },
    {
      title: '资产',
      items: [
        { to: '/style-engine', label: '写法引擎', icon: Feather },
        { to: '/story-modes', label: '推进模式库', icon: Gauge },
        { to: '/worlds', label: '世界样本库', icon: Globe2 },
        { to: '/knowledge', label: '知识库', icon: Database },
        { to: '/prompt-workbench', label: '提示词工作台', icon: Braces },
        { to: '/book-analysis', label: '拆书', icon: Search },
        { to: '/genres', label: '流派管理', icon: Tags },
        { to: '/forge', label: '要素工坊', icon: Hammer },
        { to: novelId ? `/novels/${novelId}` : '/', label: '工作台（设定/世界/角色）', icon: PanelLeft, requiresNovel: true, exact: true },
        { to: '/anti-ai', label: '反 AI 规则', icon: ShieldCheck },
        { to: '/base-characters', label: '基础角色库', icon: UsersRound },
        { to: '/agents-library', label: '智能体库', icon: Bot },
        { to: '/titles', label: '标题工坊', icon: Type }
      ]
    },
    {
      title: '系统',
      items: [
        // P27 0e：模型路由并入设置页 tab（移除重复入口）
        { to: '/settings', label: '设置', icon: Settings }
      ]
    }
  ]

  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const width = collapsed ? 72 : 224

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* P12 B3：自定义标题栏（拖拽区 + 原生窗口按钮由 titleBarOverlay 保留） */}
      <div className="titlebar">
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' }}>
          AI 小说创作工作台
        </span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 10 }}>
          v{__APP_VERSION__}
        </span>
        {/* P13 G8 + P27 1-5：全局运行任务悬浮状态（可展开浮层） */}
        {runningJobs.length > 0 && (
          <div style={{ marginLeft: 'auto', marginRight: 12, position: 'relative' }}>
            <button
              className="sm"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent-bright)', borderColor: 'var(--accent)' }}
              onClick={() => setJobsOpen((v) => !v)}
              title="查看运行中任务"
            >
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', marginRight: 6, animation: 'pulse 1.2s infinite' }} />
              AI 运行中{runningJobs.length > 1 ? `（${runningJobs.length}）` : ''} · {runningJobs[0].type === 'director' ? '自动导演' : runningJobs[0].type}
            </button>
            {jobsOpen && (
              <div className="panel" style={{ position: 'absolute', right: 0, top: 34, width: 260, zIndex: 'var(--z-dropdown)', background: 'var(--bg-elevated)', padding: 12 }}>
                <div className="row justify-between mb-2">
                  <strong className="t-small">运行中任务</strong>
                  <button className="sm" onClick={() => navigate('/tasks')}>任务中心 →</button>
                </div>
                {runningJobs.map((j) => (
                  <div key={j.id} className="mb-2">
                    <div className="row justify-between t-small">
                      <span>{j.type === 'director' ? '自动导演' : j.type} #{j.id}</span>
                      <span className="muted">{Math.round((j.progress ?? 0) * 100)}%</span>
                    </div>
                    <div className="progress" style={{ marginTop: 4 }}>
                      <div style={{ width: `${Math.min(100, (j.progress ?? 0) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* 侧栏 */}
      <aside
        style={{
          width,
          flexShrink: 0,
          background: 'var(--bg-panel)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 150ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        {/* 品牌：应用名与版本由 titlebar 承载（v0.26.0 审查 P1-7 去三重重复），此行仅保留折叠开关 */}
        <div
          className="row"
          style={{
            padding: '8px 8px',
            borderBottom: '1px solid var(--border)',
            justifyContent: collapsed ? 'center' : 'flex-end'
          }}
        >
          {collapsed && <PanelLeft size={18} style={{ margin: '0 auto' }} />}
          <button
            className="sm"
            onClick={toggleCollapsed}
            style={{ background: 'transparent', border: 'none', padding: 2 }}
            title={collapsed ? '展开侧栏' : '折叠侧栏'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* 导航分组 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
          {navGroups.map((g) => (
            <div key={g.title} className="mb-2">
              {!collapsed && (
                <div style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)', padding: '6px 10px 4px', letterSpacing: 0.5 }}>
                  {g.title}
                </div>
              )}
              {collapsed && <div style={{ height: 1, background: 'var(--border)', margin: '4px 12px' }} />}
              {g.items.map((item) => {
                // v0.26.0（审查 P0-3）：active 判定重写——「小说列表」仅在根路径高亮；
                // 工作台仅精确匹配书根；其余条目精确或子路径命中。移除 isPrimary 常亮强调（此前与 active 无法区分）。
                const active =
                  item.to === '/'
                    ? location.pathname === '/'
                    : item.exact
                      ? location.pathname === item.to
                      : location.pathname === item.to || location.pathname.startsWith(item.to + '/')
                const needsNovel = item.requiresNovel && !novelId
                const Icon = item.icon
                return (
                  <button
                    key={item.label}
                    onClick={() => {
                      if (needsNovel) {
                        toast('info', '请先创建或选择一本小说')
                        navigate('/')
                        return
                      }
                      navigate(item.to)
                    }}
                    title={collapsed ? item.label : undefined}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: collapsed ? '10px 0' : '8px 10px',
                      borderRadius: 8,
                      border: '1px solid transparent',
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--text-dim)',
                      fontSize: 13,
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      marginBottom: 2
                    }}
                  >
                    {active && (
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          height: 18,
                          width: 3,
                          borderRadius: 2,
                          background: 'var(--accent)'
                        }}
                      />
                    )}
                    <Icon size={16} style={{ flexShrink: 0 }} />
                    {!collapsed && (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                        {item.label}
                      </span>
                    )}
                    {item.badge && (
                      <span
                        style={{
                          marginLeft: collapsed ? 0 : 'auto',
                          fontSize: 'var(--fs-11)',
                          padding: '1px 6px',
                          borderRadius: 10,
                          background: 'var(--danger-soft)',
                          color: 'var(--danger)',
                          position: collapsed ? 'absolute' : 'static',
                          right: 4,
                          top: 4
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {!collapsed && novelId && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-faint)' }}>
            当前书 #{novelId}
          </div>
        )}
      </aside>

      {/* 主区 */}
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <Outlet />
      </main>
      </div>
    </div>
  )
}
