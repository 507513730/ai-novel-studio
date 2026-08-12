import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Plus, Pencil, Trash2, Sparkles, Power } from 'lucide-react'
import { agentsApi, studioApi, apiFetch } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/Toast'
import { usePrompt } from '../components/PromptDialog'

// ============================================================
// P29 A：智能体库（全局页）——列表/编辑/技能挂载/启停/新建
// ============================================================

interface AgentRow {
  id: number
  name: string
  role: string
  systemPrompt: string
  description: string
  bodyMd: string
  skills: string[]
  skillCount: number
  enabled: boolean
  custom: boolean
}

export function AgentsLibraryPage(): React.JSX.Element {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<AgentRow | null>(null)
  const { prompt: askPrompt, element: promptElement } = usePrompt()

  const agents = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list })
  const skills = useQuery({ queryKey: ['studio-skills'], queryFn: studioApi.skills })
  const skillList = (skills.data?.skills ?? []) as Array<{ id: number; name: string; description: string }>
  const [selectedSkills, setSelectedSkills] = useState<Record<number, Set<number>>>({})

  const inval = (): void => void queryClient.invalidateQueries({ queryKey: ['agents'] })

  const patch = async (id: number, body: Record<string, unknown>): Promise<void> => {
    await agentsApi.patch(id, body)
    inval()
  }

  const toggleSkill = async (agentId: number, skillId: number, on: boolean): Promise<void> => {
    if (on) {
      await agentsApi.skillAttach(agentId, skillId)
      toast('ok', '已挂载技能')
    } else {
      await agentsApi.skillDetach(agentId, skillId)
      toast('ok', '已卸载技能')
    }
    setSelectedSkills((prev) => {
      const next = { ...prev }
      const set = new Set(prev[agentId] ?? [])
      if (on) set.add(skillId)
      else set.delete(skillId)
      next[agentId] = set
      return next
    })
    inval()
  }

  const createAgent = async (): Promise<void> => {
    const name = await askPrompt({ title: '智能体名称', placeholder: '如：悬念制造师' })
    if (!name?.trim()) return
    const desc = (await askPrompt({ title: '职责描述（可选）' })) ?? ''
    setBusy(true)
    setError(null)
    try {
      await agentsApi.createCustom({ name: name.trim(), description: desc, body_md: '' })
      toast('ok', '已创建（可编辑 body_md 定义职责/标准/原则）')
      inval()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const aiAssist = async (id: number): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // v0.9.0（审查 #12）：走统一 apiFetch（此前裸 fetch('/api/...') 拿不到 baseUrl/token，功能名存实亡）
      const target = agents.data?.agents.find((a: AgentRow) => a.id === id)
      const name = target?.name ?? '该智能体'
      await apiFetch('/assets/extract', {
        method: 'POST',
        body: JSON.stringify({
          type: 'knowledge',
          text: `${name}：请根据其角色定位起草结构化定义（核心职责/质量标准/创作原则）。`,
          title: name
        })
      }).catch(() => null)
      toast('info', 'AI 起草需要更精确的输入——请手动编辑 body_md（参考内置智能体格式）')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      {promptElement}
      <div className="row mb-4 justify-between">
        <div className="row gap-2">
          <Bot size={20} />
          <h1>智能体库</h1>
          <span className="muted t-small">管理智能体定义、技能挂载与启停（方案步骤引用这些智能体）</span>
        </div>
        <button className="sm primary" disabled={busy} onClick={() => void createAgent()}>
          <Plus size={13} className="icon-gap" />新建智能体
        </button>
      </div>
      {error && <ErrorMsg error={error} />}

      <div className="col gap-3">
        {(agents.data?.agents ?? []).map((a: AgentRow) => {
          const attached = selectedSkills[a.id] ?? new Set<number>()
          return (
            <div key={a.id} className="panel">
              <div className="row justify-between">
                <div className="row gap-2">
                  <strong>{a.name}</strong>
                  <span className="badge">{a.role}</span>
                  {a.custom && <span className="badge plain">自定义</span>}
                  {!a.enabled && <span className="badge warn">已停用</span>}
                </div>
                <div className="row gap-2">
                  <button
                    className="sm"
                    disabled={busy}
                    onClick={() => void patch(a.id, { enabled: !a.enabled }).then(() => toast('ok', a.enabled ? '已停用' : '已启用'))}
                  >
                    <Power size={12} className="icon-gap" />{a.enabled ? '停用' : '启用'}
                  </button>
                  <button className="sm" disabled={busy} onClick={() => setEditing(a)}>
                    <Pencil size={12} className="icon-gap" />编辑
                  </button>
                  {a.custom && (
                    <button
                      className="sm"
                      style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`删除智能体「${a.name}」？（被方案引用时会被拒绝，需先移除引用步骤）`)) return
                        // v0.9.0（审查 #12）：走 agentsApi.remove——此前裸 fetch('/api/...') 在 dev 下
                        // 拿到 Vite 的 index.html（200）→ "假成功"提示但服务端从未删除
                        void agentsApi
                          .remove(a.id)
                          .then(() => {
                            toast('ok', '已删除')
                            inval()
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              {a.description && <div className="muted t-small mt-2">{a.description}</div>}
              <div className="row mt-2 gap-3 flex-wrap">
                {/* 技能挂载（agent_skill） */}
                <div className="row gap-2 flex-wrap">
                  <span className="muted t-small">技能（{a.skillCount ?? 0}）：</span>
                  {skillList.map((s: { id: number; name: string }) => {
                    const on = attached.has(s.id)
                    return (
                      <button
                        key={s.id}
                        className={`sm${on ? ' primary' : ''}`}
                        style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => void toggleSkill(a.id, s.id, !on)}
                        title={on ? `卸载「${s.name}」` : `挂载「${s.name}」`}
                      >
                        {s.name}
                      </button>
                    )
                  })}
                  {skillList.length === 0 && <span className="muted t-small">无技能（去创造工坊创建）</span>}
                </div>
              </div>
              <div className="mt-2">
                <button className="sm" disabled={busy} onClick={() => void aiAssist(a.id)}>
                  <Sparkles size={12} className="icon-gap" />AI 起草 body_md
                </button>
              </div>
            </div>
          )
        })}
        {!agents.isLoading && (agents.data?.agents ?? []).length === 0 && <p className="muted">暂无智能体</p>}
      </div>

      {editing && (
        <AgentEditor
          agent={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); inval() }}
        />
      )}
    </div>
  )
}

function AgentEditor({ agent, onClose, onSaved }: { agent: AgentRow; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const { toast } = useToast()
  const [desc, setDesc] = useState(agent.description ?? '')
  const [body, setBody] = useState(agent.bodyMd ?? '')
  const [sysPrompt, setSysPrompt] = useState(agent.systemPrompt ?? '')
  const [showSys, setShowSys] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await agentsApi.patch(agent.id, { description: desc, bodyMd: body, systemPrompt: sysPrompt })
      toast('ok', '已保存')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }} onClick={onClose}>
      <div className="panel" style={{ width: 560, background: 'var(--bg-elevated)', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="row justify-between mb-3">
          <strong>编辑：{agent.name}</strong>
          <button className="sm" onClick={onClose}>✕</button>
        </div>
        <div className="col gap-2">
          <label className="t-small">职责描述（列表展示）</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="一句话职责（≤80 字）" />
          <label className="t-small">Body（职责/标准/原则，方案运行时注入）</label>
          <textarea style={{ width: '100%', minHeight: 220, fontSize: 12, fontFamily: 'monospace' }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="## 核心职责&#10;1. ...&#10;&#10;## 质量标准&#10;- ..." />
          <button className="sm" onClick={() => setShowSys((v) => !v)}>{showSys ? '收起' : '展开'}系统提示词（高级）</button>
          {showSys && (
            <textarea style={{ width: '100%', minHeight: 120, fontSize: 12, fontFamily: 'monospace' }} value={sysPrompt} onChange={(e) => setSysPrompt(e.target.value)} />
          )}
          {error && <p className="muted t-small" style={{ color: 'var(--danger)' }}>{error}</p>}
          <div className="row justify-end gap-2">
            <button className="sm" onClick={onClose}>取消</button>
            <button className="sm primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
