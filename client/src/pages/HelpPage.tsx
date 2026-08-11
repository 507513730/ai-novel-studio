import { useNavigate } from 'react-router-dom'
import { CircleHelp, BookOpenText, Clapperboard, ListChecks, Settings } from 'lucide-react'

// P16 P1：创作向导（新手三步引导）
export function HelpPage(): React.JSX.Element {
  const navigate = useNavigate()
  const steps = [
    { icon: BookOpenText, title: '1. 创建小说', desc: '在小说列表输入一句灵感，AI 自动导演会完成方向、设定与第一卷规划。', to: '/' },
    { icon: Clapperboard, title: '2. 生成与推进', desc: '用自动导演批量推进整本，或在章节执行页逐章生成、审核、修复、回灌。', to: '/novels' },
    { icon: ListChecks, title: '3. 跟踪与恢复', desc: '任务中心看进度与失败原因；失败可换模型重试或从断点继续。', to: '/tasks' }
  ]
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 20 }}>
        <CircleHelp size={22} />
        <h1 className="ml-2">创作向导</h1>
      </div>
      <div className="panel" style={{ marginBottom: 16, background: 'var(--bg-card)' }}>
        <h2 style={{ marginBottom: 6 }}>三步完成一本小说</h2>
        <p className="muted t3">
          AI 小说创作工作台是一个「导演式」写作系统：AI 负责规划、生成、审核与修复，你负责定方向、把关与确认。
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {steps.map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.title}
              className="panel"
              style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--bg-card)' }}
              onClick={() => navigate(s.to)}
            >
              <Icon size={20} style={{ color: 'var(--accent-bright)' }} />
              <div style={{ fontSize: 15, fontWeight: 600, marginTop: 8 }}>{s.title}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>{s.desc}</div>
            </button>
          )
        })}
      </div>
      <div className="panel" style={{ marginTop: 16, background: 'var(--bg-card)' }}>
        <h2 className="mb-2">关键概念</h2>
        <div className="col" style={{ gap: 8, fontSize: 13 }}>
          <div><strong>自动导演</strong>：从灵感一路推进到可写章节（11 阶段），可全自动或半自动确认。</div>
          <div><strong>章节执行链</strong>：生成 → AI 审核 → 修复 → 状态回灌，保持全书连续性。</div>
          <div><strong>资产库</strong>：写法引擎、拆书、流派、标题工坊——把一次创作沉淀为可复用资产。</div>
          <div><strong>任务中心</strong>：所有后台任务的状态、失败原因与恢复入口。</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button onClick={() => navigate('/')}>去创建小说</button>
        <button onClick={() => navigate('/settings')}><Settings size={14} className="icon-gap" />配置模型</button>
      </div>
    </div>
  )
}
