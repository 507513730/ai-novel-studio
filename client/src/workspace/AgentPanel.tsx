import { useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useQuery } from '@tanstack/react-query'
import { agentsApi, novelApi } from '../api'
import type { ChapterSummary } from '../types'

export function AgentPanel({ novelId }: { novelId: number }): React.JSX.Element {
  const [name, setName] = useState('')
  const [role, setRole] = useState('custom')
  const [prompt, setPrompt] = useState('')
  // P14 B2：提示词展开状态
  const [expandedPrompt, setExpandedPrompt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [chapterId, setChapterId] = useState('')
  const chapters = useQuery({ queryKey: ['chapters', novelId], queryFn: () => novelApi.chapters(novelId) })
  const [teamResult, setTeamResult] = useState<Record<string, unknown> | null>(null)

  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: agentsApi.list
  })

  const err = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  const createAgent = async (): Promise<void> => {
    if (name.trim().length < 1 || prompt.trim().length < 10) {
      setError('Agent 名称必填，提示词至少 10 字')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await agentsApi.create({ name: name.trim(), role, systemPrompt: prompt.trim() })
      setMsg('Agent 已创建')
      setName('')
      setPrompt('')
      await agents.refetch()
    } catch (e) {
      setError(err(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleAgent = async (id: number, enabled: boolean): Promise<void> => {
    try {
      await agentsApi.patch(id, { enabled: !enabled })
      await agents.refetch()
    } catch (e) {
      setError(err(e))
    }
  }

  const runTeamReview = async (): Promise<void> => {
    const cid = Number(chapterId)
    if (!Number.isInteger(cid) || cid <= 0) {
      setError('请输入有效章节 ID')
      return
    }
    setBusy(true)
    setError(null)
    setTeamResult(null)
    try {
      const r = await agentsApi.teamReview(novelId, cid)
      setTeamResult(r.review)
      setMsg('团队审校完成')
    } catch (e) {
      setError(err(e))
    } finally {
      setBusy(false)
    }
  }

  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const issues = Array.isArray(teamResult?.issues) ? (teamResult.issues as Array<Record<string, unknown>>) : []
  const ooc = Array.isArray(teamResult?.oocIssues) ? (teamResult.oocIssues as Array<Record<string, unknown>>) : []
  const dims = Array.isArray(teamResult?.dimensions) ? (teamResult.dimensions as Array<Record<string, unknown>>) : []
  const antiAi = Array.isArray(teamResult?.antiAiHits) ? (teamResult.antiAiHits as Array<{ word: string; count: number }>) : []

  return (
    <div className="col">
      {error && <ErrorMsg error={error} />}
      {msg && <div style={{ color: 'var(--ok)' }}>{msg}</div>}

      <div className="panel">
        <h2>团队审校（主编 + 审校三岗 + 角色顾问）</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          主编给出本章约束 → 审校按剧情/逻辑/文风三岗并行审核（问题合并去重）→ 角色顾问查 OOC → 反 AI 词检测。
        </p>
        <div className="row">
          {/* P23（N9）：章节下拉（替代手输 ID） */}
          <select
            style={{ width: 220, padding: '6px 10px', fontSize: 13 }}
            value={chapterId}
            onChange={(e) => setChapterId(e.target.value)}
          >
            <option value="">选择章节…（或手输 ID）</option>
            {chapters.data?.chapters.map((ch: ChapterSummary) => (
              <option key={ch.id} value={String(ch.id)}>
                #{ch.id} {ch.title || `第 ${ch.id} 章`}（{ch.status}）
              </option>
            ))}
          </select>
          <input
            style={{ width: 90 }}
            placeholder="或手输 ID"
            value={chapterId}
            onChange={(e) => setChapterId(e.target.value.replace(/\D/g, ''))}
          />
          <button className="primary" disabled={busy} onClick={() => void runTeamReview()}>
            {busy ? '审校中…' : '开始团队审校'}
          </button>
        </div>
        {teamResult && (
          <div className="panel" style={{ background: 'var(--bg-card)', marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>综合评分：{str(teamResult.score)}</strong>
              {Number(teamResult.highCount) > 0 && (
                <span className="badge" style={{ color: 'var(--danger)', background: 'rgba(255,107,107,0.12)' }}>
                  {String(teamResult.highCount)} 个高严重度问题
                </span>
              )}
            </div>
            {Boolean(teamResult.editorConstraint) && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                <strong>主编约束：</strong>
                <span className="muted">{str(teamResult.editorConstraint)}</span>
              </div>
            )}
            {dims.length > 0 && (
              <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                {dims.map((d) => (
                  <span key={str(d.focus)} className="badge">
                    {str(d.focus)}：{String(d.score)} 分
                  </span>
                ))}
              </div>
            )}
            {issues.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <strong>问题清单（去重后 {issues.length} 项）：</strong>
                {issues.map((i, idx) => (
                  <div key={idx} style={{ marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                    <span className="badge" style={i.severity === 'high' ? { color: 'var(--danger)', background: 'rgba(255,107,107,0.12)' } : {}}>
                      [{str(i.focus)}] {str(i.severity)}
                    </span>
                    <div>{str(i.problem)}</div>
                    <div className="muted" style={{ fontSize: 11 }}>建议：{str(i.suggestion)}</div>
                  </div>
                ))}
              </div>
            )}
            {ooc.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <strong>OOC 问题（{ooc.length}）：</strong>
                {ooc.map((i, idx) => (
                  <div key={idx} style={{ marginTop: 4 }}>
                    <span className="badge" style={{ color: 'var(--danger)', background: 'rgba(255,107,107,0.12)' }}>{str(i.severity)}</span>
                    {' '}{str(i.problem)}
                  </div>
                ))}
              </div>
            )}
            {antiAi.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <strong>反 AI 词命中：</strong>
                {antiAi.map((h) => `「${h.word}」×${h.count}`).join('、')}
              </div>
            )}
            {issues.length === 0 && ooc.length === 0 && antiAi.length === 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>无问题，本章质量良好 ✓</p>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>AI 团队（五内置 + 自定义）</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          内置主编/审校/角色顾问/世界观顾问/文风顾问；可编辑提示词或新建。
        </p>
        {agents.data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {agents.data.agents.map((a) => (
              <div key={a.id} className="panel" style={{ background: 'var(--bg-card)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{a.name}</strong>
                  <span className="badge" style={a.enabled ? {} : { color: 'var(--text-dim)' }}>
                    {a.enabled ? '启用' : '停用'}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>role: {a.role}</div>
                {/* P14 B2：长提示词展开/收起 */}
                <p style={{ fontSize: 12, marginTop: 6, maxHeight: expandedPrompt === a.id ? 400 : 80, overflow: 'hidden', transition: 'max-height 200ms' }}>
                  {a.systemPrompt}
                </p>
                <div className="row" style={{ marginTop: 6 }}>
                  <button className='sm' onClick={() => void toggleAgent(a.id, a.enabled)}>
                    {a.enabled ? '停用' : '启用'}
                  </button>
                  <button className='sm' onClick={() => setExpandedPrompt(expandedPrompt === a.id ? null : a.id)}>
                    {expandedPrompt === a.id ? '收起' : '展开提示词'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>创建自定义 Agent</h2>
        <div className="row" style={{ marginBottom: 8 }}>
          <input style={{ width: 160 }} placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="custom">自定义</option>
            <option value="editor">主编</option>
            <option value="reviewer">审校</option>
            <option value="character_advisor">角色顾问</option>
            <option value="world_advisor">世界观顾问</option>
            <option value="style_advisor">文风顾问</option>
          </select>
          <button className="primary" disabled={busy} onClick={() => void createAgent()}>创建</button>
        </div>
        <textarea
          style={{ width: '100%', minHeight: 80, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontFamily: 'inherit', fontSize: 13 }}
          placeholder="Agent 系统提示词…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
    </div>
  )
}
