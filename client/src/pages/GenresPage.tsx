import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Tags, Plus } from 'lucide-react'
import { novelApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/Toast'

// P17-1：流派管理全局页（全局预设 + 各书自定义）
export function GenresPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newGenre, setNewGenre] = useState('')

  const genres = useQuery({ queryKey: ['genres', 0], queryFn: () => novelApi.genres(0) })
  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({ queryKey: ['novels'], queryFn: novelApi.list })

  const createGlobal = async (): Promise<void> => {
    const name = newGenre.trim()
    if (!name || busy) return
    setBusy(true)
    setError(null)
    try {
      await novelApi.genreCreate(name, undefined)
      setNewGenre('')
      toast('ok', `全局流派「${name}」已创建`)
      void queryClient.invalidateQueries({ queryKey: ['genres'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  const globalGenres = (genres.data?.genres ?? []).filter((g) => !g.custom)
  const customGenres = (genres.data?.genres ?? []).filter((g) => g.custom)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <Tags size={20} />
        <h1 style={{ marginLeft: 8 }}>流派管理</h1>
      </div>
      {error && <ErrorMsg error={error} />}

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 8 }}>创建全局流派</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          全局流派可在任意书的项目设定中选择；书中绑定后注入爽点/节奏模板。
        </p>
        <div className="row">
          <input style={{ flex: 1 }} placeholder="流派名（如：克苏鲁、无限流）" value={newGenre} onChange={(e) => setNewGenre(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createGlobal() }} />
          <button className="primary" disabled={busy || !newGenre.trim()} onClick={() => void createGlobal()}>
            <Plus size={14} style={{ verticalAlign: -1, marginRight: 4 }} />创建
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 10 }}>全局预设（{globalGenres.length}）</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {globalGenres.map((g) => <span key={g.id} className="chip">{g.name}</span>)}
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginBottom: 10 }}>书内自定义流派</h2>
        {customGenres.length === 0 && <p className="muted" style={{ fontSize: 13 }}>暂无书内自定义流派。</p>}
        <div className="col" style={{ gap: 6 }}>
          {novels.data?.novels.map((n) => {
            const cg = customGenres.filter((g) => g.novelId === n.id)
            return cg.length > 0 ? (
              <div key={n.id} className="row" style={{ padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{n.title || `#${n.id}`}</strong>
                {cg.map((g) => <span key={g.id} className="chip">{g.name}</span>)}
              </div>
            ) : null
          })}
        </div>
      </div>
    </div>
  )
}
