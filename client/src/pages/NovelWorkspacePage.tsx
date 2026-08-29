import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { novelApi, automationApi } from '../api'
import { ArrowRight } from 'lucide-react'
import { useConfirm } from '../components/ConfirmDialog'
import { ErrorMsg } from '../components/ErrorMsg'
import { SetupPanel } from '../workspace/SetupPanel'
import { ConstraintPanel } from '../workspace/ConstraintPanel'
import { WorldPanel } from '../workspace/WorldPanel'
import { CharacterPanel } from '../workspace/CharacterPanel'
import { VolumePanel } from '../workspace/VolumePanel'
import { AnalysisPanel } from '../workspace/AnalysisPanel'
import { StylePanel } from '../workspace/StylePanel'
import { AgentPanel } from '../workspace/AgentPanel'
import { FileText, ShieldCheck, Globe, Users, BookMarked, Search, Feather, Bot, Clapperboard, Brain, BookOpenText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AiStatusBar } from '../components/AiStatusBar'

type Tab = 'setup' | 'constraints' | 'world' | 'characters' | 'volumes' | 'analysis' | 'style' | 'agents'

// P10：步骤导航（参考项目：7 步流程显性化 + 状态徽章）；P11-4：图标化
interface StepDef {
  key: Tab
  label: string
  desc: string
  icon: LucideIcon
}

const STEPS: StepDef[] = [
  { key: 'setup', label: '项目设定', desc: '书名 / 流派 / 书级 framing', icon: FileText },
  // v0.15.0：创作约束——用户强调的事项（主角名/红线）全链强制
  { key: 'constraints', label: '创作约束', desc: '硬性要求 / 偏好（全链注入+校验）', icon: ShieldCheck },
  { key: 'world', label: '世界观', desc: '世界手册 / 势力 / 地图', icon: Globe },
  { key: 'characters', label: '角色', desc: '名册 / 待确认 / 资源账本', icon: Users },
  { key: 'volumes', label: '卷 / 章节规划', desc: '卷战略 / 节奏板 / 章节清单', icon: BookMarked },
  { key: 'analysis', label: '拆书', desc: '题材定位 / 剧情结构 / 人物系统', icon: Search },
  { key: 'style', label: '写法引擎', desc: '特征提取 / 风格注入 / 反 AI', icon: Feather },
  { key: 'agents', label: 'AI 团队', desc: '部门智能体 / 对话即创作', icon: Bot }
]

type StepStatus = 'done' | 'current' | 'todo'

// v0.22.2：书级"下一步"引导卡——从 /status 取 nextSteps（服务端规则引擎），
// 解决"点进书本不知道该干什么"（书 25 命中：正文未写完 → 继续生产）
function NextStepCard({ novelId }: { novelId: number }): React.JSX.Element | null {
  const navigate = useNavigate()
  const status = useQuery({
    queryKey: ['novel-status', novelId],
    queryFn: () => automationApi.novelStatus(novelId),
    refetchInterval: 15000
  })
  const next = (status.data?.nextSteps as
    | { title: string; description: string; action?: { label: string; to: string } }
    | undefined)
  if (!next) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        marginBottom: 16,
        borderRadius: 'var(--radius-m)',
        border: '1px solid var(--accent)',
        background: 'var(--accent-soft)'
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 13 }}>{next.title}</strong>
        <span className="muted t-small" style={{ display: 'block', marginTop: 2 }}>
          {next.description}
        </span>
      </div>
      {next.action && (
        <button className="primary sm" onClick={() => navigate(next.action!.to)}>
          {next.action.label} <ArrowRight size={12} />
        </button>
      )}
    </div>
  )
}

// P19 ⑦：卡片化创作向导（横排卡片；全部完成后自动折叠，可手动展开）
function GuideStrip({
  steps,
  statusOf,
  onPick
}: {
  steps: StepDef[]
  statusOf: (key: Tab) => StepStatus
  onPick: (key: Tab) => void
}): React.JSX.Element {
  const allDone = steps.every((s) => statusOf(s.key) === 'done')
  const [collapsed, setCollapsed] = useState<boolean>(allDone)
  if (collapsed) {
    const doneCount = steps.filter((s) => statusOf(s.key) === 'done').length
    return (
      <button
        className="sm"
        style={{ marginBottom: 16, color: 'var(--ok)', borderColor: 'var(--ok)' }}
        onClick={() => setCollapsed(false)}
        title="点击展开流程卡片"
      >
        ✓ 本书创作流程已完成 {doneCount}/{steps.length} 步 · 点击展开
      </button>
    )
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(120px, 1fr))`,
        gap: 8,
        marginBottom: 16
      }}
    >
      {steps.map((s, i) => {
        const st = statusOf(s.key)
        const Icon = s.icon
        return (
          <button
            key={s.key}
            onClick={() => onPick(s.key)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              padding: '10px 12px',
              borderRadius: 'var(--radius-m)',
              background: 'var(--bg-card)',
              border: `1px solid ${st === 'current' ? 'var(--accent)' : st === 'done' ? 'color-mix(in srgb, var(--ok) 35%, transparent)' : 'var(--border)'}`,
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <div className="row" style={{ gap: 6, width: '100%', justifyContent: 'space-between' }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  flexShrink: 0,
                  background: st === 'done' ? 'color-mix(in srgb, var(--ok) 15%, transparent)' : st === 'current' ? 'var(--accent-soft)' : 'var(--bg-card)',
                  border: `1px solid ${st === 'done' ? 'var(--ok)' : st === 'current' ? 'var(--accent)' : 'var(--border)'}`
                }}
              >
                {st === 'done' ? '✓' : <Icon size={11} />}
              </span>
              <span className="muted" style={{ fontSize: 'var(--fs-11)' }}>{i + 1}/{steps.length}</span>
            </div>
            <strong style={{ fontSize: 12, color: st === 'done' ? 'var(--ok)' : 'var(--text)' }}>{s.label}</strong>
            <span className="muted t-small">{s.desc}</span>
          </button>
        )
      })}
    </div>
  )
}

export function NovelWorkspacePage(): React.JSX.Element {
  const { novelId } = useParams()
  const navigate = useNavigate()
  const id = Number(novelId)
  const [tab, setTab] = useState<Tab>('setup')
  // v0.22.0（审查 ALOW）：themed confirm 统一
  const [confirmFn, confirmDialog] = useConfirm()

  const detail = useQuery({
    queryKey: ['novel', id],
    queryFn: () => novelApi.detail(id)
  })

  // P12 B4：tab 脏检查（未保存输入切换确认）
  const [dirty, setDirty] = useState(false)
  const switchTab = (next: Tab): void => {
    if (dirty && next !== tab) {
      confirmFn({ title: '切换面板', message: '当前面板有未保存的输入，切换将丢弃。继续？', confirmText: '切换', danger: true, action: () => { setDirty(false); setTab(next) } })
      return
    }
    setTab(next)
  }

  const n = detail.data?.novel

  // 步骤状态推断（done: 已有产物；current: 当前 tab；todo: 未就绪）
  const statusOf = (key: Tab): StepStatus => {
    if (key === tab) return 'current'
    if (!n) return 'todo'
    switch (key) {
      case 'setup':
        return Object.keys(n.framing ?? {}).length > 0 ? 'done' : 'todo'
      case 'constraints':
        return (n.constraints ?? []).some((c) => c.level === 'must') ? 'done' : 'todo'
      case 'world':
        return n.worldDone ? 'done' : 'todo'
      case 'characters':
        return (n.charactersCount ?? 0) > 0 ? 'done' : 'todo'
      case 'volumes':
        return (n.volumesCount ?? 0) > 0 ? 'done' : 'todo'
      case 'analysis':
        return (n.analysesCount ?? 0) > 0 ? 'done' : 'todo'
      case 'style':
        return (n.stylesCount ?? 0) > 0 ? 'done' : 'todo'
      case 'agents':
        return (n.agentsCount ?? 0) > 0 ? 'done' : 'todo'
    }
  }

  const metaOf = (key: Tab): string => {
    if (!n) return ''
    switch (key) {
      case 'characters':
        return n.charactersCount ? `${n.charactersCount} 名` : ''
      case 'volumes':
        return n.volumesCount ? `${n.volumesCount} 卷 · ${n.chaptersCount ?? 0} 章` : ''
      case 'analysis':
        return n.analysesCount ? `${n.analysesCount} 次` : ''
      case 'style':
        return n.stylesCount ? `${n.stylesCount} 个` : ''
      case 'agents':
        return n.agentsCount ? `${n.agentsCount} 个` : ''
      default:
        return ''
    }
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: 24, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* 左：步骤导航 */}
      <aside style={{ width: 210, flexShrink: 0, position: 'sticky', top: 24 }}>
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', padding: '4px 8px 10px' }}>
            本书创作流程
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {STEPS.map((s) => {
              const st = statusOf(s.key)
              const Icon = s.icon
              return (
                <button
                  key={s.key}
                  onClick={() => switchTab(s.key)}
                  title={s.desc}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid transparent',
                    background: st === 'current' ? 'var(--accent-soft)' : st === 'done' ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent',
                    color: st === 'done' ? 'var(--ok)' : st === 'current' ? 'var(--text)' : 'var(--text-dim)',
                    fontSize: 13,
                    textAlign: 'left',
                    width: '100%'
                  }}
                >
                  {/* P16 P2：当前流程中（未选中）左侧竖条 */}
                  {st === 'current' && (
                    <span style={{ position: 'absolute', left: -8, top: 6, bottom: 6, width: 3, borderRadius: 2, background: 'var(--accent)' }} />
                  )}
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      flexShrink: 0,
                      background: st === 'done' ? 'color-mix(in srgb, var(--ok) 15%, transparent)' : st === 'current' ? 'var(--accent-soft)' : 'var(--bg-card)',
                      border: `1px solid ${st === 'done' ? 'var(--ok)' : st === 'current' ? 'var(--accent)' : 'var(--border)'}`
                    }}
                  >
                    {st === 'done' ? '✓' : <Icon size={12} />}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                  {/* P16 P2：状态标签文案（参考项目：当前步骤/流程中/查看中/已完成/待推进） */}
                  <span style={{ fontSize: 'var(--fs-11)', color: st === 'done' ? 'var(--ok)' : st === 'current' ? 'var(--accent-bright)' : 'var(--text-faint)' }}>
                    {st === 'done' ? '已完成' : st === 'current' ? '当前步骤' : '待推进'}
                    {metaOf(s.key) ? ` · ${metaOf(s.key)}` : ''}
                  </span>
                </button>
              )
            })}
          </div>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="sm" onClick={() => navigate(`/novels/${id}/chapters`)}><BookOpenText size={13} /> 章节执行</button>
            <button className="sm" onClick={() => navigate(`/novels/${id}/director`)}><Clapperboard size={13} /> 自动导演</button>
            <button className="sm" onClick={() => navigate(`/novels/${id}/hub`)}><Brain size={13} /> 创作中枢</button>
          </div>
        </div>
      </aside>

      {/* 右：主工作区 */}
      <div className="flex-1">
        <AiStatusBar novelId={id} />
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            {detail.isLoading && <h1 className="muted">加载中…</h1>}
            {detail.isError && (
              <ErrorMsg error={`加载失败：${String(detail.error)}`} onRetry={() => void detail.refetch()} />
            )}
            {n && <h1>{n.title || '未命名小说'}</h1>}
            {n && (
              <span className="muted t-small">
                状态：{n.status ?? '...'}
                {n.genre ? ` · 流派：${n.genre}` : ''}
              </span>
            )}
          </div>
        </div>

        {/* P19 ⑦：卡片化创作向导（横排 7 步；全部完成后自动折叠为进度条） */}
        {n && (
          <GuideStrip
            steps={STEPS}
            statusOf={statusOf}
            onPick={switchTab}
          />
        )}

        {/* v0.22.2：书级"下一步"引导卡（用户进书不知道该干什么——指向当前最该做的动作） */}
        {n && <NextStepCard novelId={id} />}

        {tab === 'setup' && <SetupPanel novelId={id} onDirtyChange={setDirty} />}
        {tab === 'constraints' && <ConstraintPanel novelId={id} />}
        {tab === 'world' && <WorldPanel novelId={id} onDirtyChange={setDirty} />}
        {tab === 'characters' && <CharacterPanel novelId={id} />}
        {tab === 'volumes' && <VolumePanel novelId={id} />}
        {tab === 'analysis' && <AnalysisPanel novelId={id} />}
        {tab === 'style' && <StylePanel novelId={id} />}
        {tab === 'agents' && <AgentPanel novelId={id} />}
      </div>
      {confirmDialog}
    </div>
  )
}
