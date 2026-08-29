import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Braces, Save, Play, RotateCcw } from 'lucide-react'
import { apiFetch } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/Toast'
import { usePrompt } from '../components/PromptDialog'
import { useNavigate } from 'react-router-dom'

// P17-5A：提示词工作台（14 系统提示词 + 反 AI 词库；编辑/预览/试跑）
interface PromptAsset {
  id: number
  name: string
  taskType: string
  template: string
  slots: Record<string, unknown>
  notes: string
}

export function PromptWorkbenchPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | boolean>(false)
  const [selected, setSelected] = useState<PromptAsset | null>(null)
  const [draft, setDraft] = useState('')
  const [vars, setVars] = useState<Record<string, string>>({})
  const [testOut, setTestOut] = useState<string | null>(null)
  const { prompt: askName, element: promptElement } = usePrompt()

  const prompts = useQuery<{ prompts: PromptAsset[] }>({
    queryKey: ['prompts'],
    queryFn: async () => (await apiFetch('/prompts')) as { prompts: PromptAsset[] }
  })

  const open = (p: PromptAsset): void => {
    setSelected(p)
    setDraft(p.template)
    setTestOut(null)
    setVars({})
  }

  const save = async (): Promise<void> => {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/prompts/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ template: draft }) })
      toast('ok', '提示词已更新（立即生效，无需重启）')
      void queryClient.invalidateQueries({ queryKey: ['prompts'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  const testRun = async (): Promise<void> => {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    setTestOut(null)
    try {
      const r = (await apiFetch('/prompts/test', {
        method: 'POST',
        body: JSON.stringify({ template: draft, vars })
      })) as { content: string; model: string }
      setTestOut(`[${r.model}]\n${r.content.slice(0, 400)}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  const placeholders = draft.match(/\$\{(\w+)\}/g) ?? []

  return (
    <>
      {promptElement}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div className="row mb-4">
        <Braces size={20} />
        <h1 className="ml-2">提示词工作台</h1>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        运行时编辑系统提示词（立即生效，无需改代码重启）。未编辑时使用内置模板。
      </p>
      {error && <ErrorMsg error={error} />}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* 左：列表 */}
        <div style={{ width: 260, flexShrink: 0 }}>
          <div className="panel" style={{ padding: 10 }}>
            {prompts.data?.prompts.map((p) => (
              <button
                key={p.id}
                onClick={() => open(p)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 10px',
                  borderRadius: 8,
                  marginBottom: 2,
                  border: selected?.id === p.id ? '1px solid var(--accent)' : '1px solid transparent',
                  background: selected?.id === p.id ? 'var(--accent-soft)' : 'transparent',
                  fontSize: 13
                }}
              >
                {p.name}
                <span className="muted" style={{ fontSize: 'var(--fs-11)', marginLeft: 6 }}>{p.taskType}</span>
              </button>
            ))}
            <button className="sm" style={{ width: '100%', marginTop: 6 }} onClick={() => navigate('/anti-ai')}>
              反 AI 词库 →
            </button>
          </div>
        </div>
        {/* 右：编辑器 */}
        <div className="flex-1">
          {selected ? (
            <div className="panel">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>{selected.name}</strong>
                <div className="row">
                  <button className="sm" disabled={busy !== false} onClick={() => void testRun()}>
                    <Play size={12} className="icon-gap" />试跑
                  </button>
                  <button className="sm primary" disabled={busy !== false} onClick={() => void save()}>
                    <Save size={12} className="icon-gap" />保存
                  </button>
                  {/* P23（N8）：还原出厂模板（内置提示词；自定义提示词提示不可还原） */}
                  <button
                    className="sm"
                    disabled={busy !== false}
                    onClick={() => {
                      setBusy('restore')
                      void apiFetch(`/prompts/${selected.id}/restore`, { method: 'POST' })
                        .then(async () => {
                          // v0.17.0（审查 A19）：还原后失效 prompts 缓存——此前缓存里仍是旧模板，列表/其他面板显示过期内容
                          void queryClient.invalidateQueries({ queryKey: ['prompts'] })
                          const all = (await apiFetch('/prompts')) as { prompts: Array<{ id: number; template: string }> }
                          const target = all.prompts.find((x) => x.id === selected.id)
                          if (target) setDraft(target.template)
                          setTestOut(null)
                          toast('ok', '已还原出厂模板')
                        })
                        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                        .finally(() => setBusy(false))
                    }}
                    title="还原为出厂模板（自定义提示词不可还原）"
                  >
                    <RotateCcw size={12} className="icon-gap" />还原出厂
                  </button>
                  {/* P23（N8）+ P27 0b：新建提示词（应用内对话框，Electron 兼容） */}
                  <button
                    className="sm"
                    disabled={busy !== false}
                    onClick={() => {
                      void askName({ title: '新提示词名称', placeholder: '输入名称后确定' }).then(async (name) => {
                        if (!name?.trim()) return
                        setBusy('create')
                        try {
                          await apiFetch('/prompts', {
                            method: 'POST',
                            body: JSON.stringify({ name: name.trim(), template: '（在此编写提示词模板，支持 ${变量} 插值）', notes: '自定义' })
                          })
                          toast('ok', '已创建')
                          await queryClient.invalidateQueries({ queryKey: ['prompts'] })
                          const all = (await apiFetch('/prompts')) as { prompts: PromptAsset[] }
                          const created = all.prompts.find((x) => x.name === name.trim())
                          if (created) open(created)
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err))
                        } finally {
                          setBusy(false)
                        }
                      })
                    }}
                  >
                    + 新建
                  </button>
                </div>
              </div>
              <textarea
                style={{ width: '100%', minHeight: 240, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.6 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              {placeholders.length > 0 && (
                <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
                  <span className="muted t-small">变量：</span>
                  {[...new Set(placeholders)].map((ph) => {
                    const name = ph.slice(2, -1)
                    return (
                      <div key={name} className="row" style={{ gap: 4 }}>
                        <span className="chip">{name}</span>
                        <input
                          style={{ width: 140, padding: '3px 8px', fontSize: 12 }}
                          placeholder="示例值"
                          value={vars[name] ?? ''}
                          onChange={(e) => setVars((v) => ({ ...v, [name]: e.target.value }))}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
              {testOut && (
                <div className="panel" style={{ marginTop: 10, background: 'var(--bg-input)', whiteSpace: 'pre-wrap', fontSize: 12 }}>
                  {testOut}
                </div>
              )}
            </div>
          ) : (
            <div className="panel" style={{ textAlign: 'center', padding: 40 }}>
              <div className="muted">从左侧选择一条提示词进行编辑。</div>
            </div>
          )}
        </div>
      </div>
      </div>
    </>
  )
}
