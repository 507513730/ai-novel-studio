import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Workflow, Plus, Trash2 } from 'lucide-react'
import { resourcesApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/Toast'

// P17-2：推进模式库（升级流/日常流等节奏模板管理）
export function StoryModesPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  const modes = useQuery({ queryKey: ['story-modes'], queryFn: resourcesApi.storyModes })

  const create = async (): Promise<void> => {
    if (!name.trim()) return
    setError(null)
    try {
      await resourcesApi.storyModeCreate(name.trim(), desc.trim(), {
        cadence: '建议节奏描述（可选）',
        density: '爽点密度提示（可选）'
      })
      setName('')
      setDesc('')
      toast('ok', '推进模式已创建')
      void queryClient.invalidateQueries({ queryKey: ['story-modes'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    }
  }

  const remove = async (id: number, nm: string): Promise<void> => {
    if (!window.confirm(`删除推进模式「${nm}」？`)) return
    try {
      await resourcesApi.storyModeDelete(id)
      toast('ok', '已删除')
      void queryClient.invalidateQueries({ queryKey: ['story-modes'] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <Workflow size={20} />
        <h1 style={{ marginLeft: 8 }}>推进模式库</h1>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        推进节奏模板（升级流 / 日常流 / 群像流…），供章节生成时参考节奏与爽点密度。
      </p>
      {error && <ErrorMsg error={error} />}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="row">
          <input style={{ flex: 2 }} placeholder="模式名（如：无限升级流）" value={name} onChange={(e) => setName(e.target.value)} />
          <input style={{ flex: 3 }} placeholder="描述（可选）" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button className="primary" disabled={!name.trim()} onClick={() => void create()}>
            <Plus size={14} style={{ verticalAlign: -1, marginRight: 4 }} />创建
          </button>
        </div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        {modes.data?.modes.map((m) => (
          <div key={m.id} className="panel" style={{ background: 'var(--bg-card)', padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{m.name}</strong>
                {m.description && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{m.description}</div>}
              </div>
              <button className="sm danger" onClick={() => void remove(m.id, m.name)}>
                <Trash2 size={12} style={{ verticalAlign: -1, marginRight: 4 }} />删除
              </button>
            </div>
          </div>
        ))}
        {!modes.isLoading && modes.data?.modes.length === 0 && <p className="muted">暂无推进模式。</p>}
      </div>
    </div>
  )
}
