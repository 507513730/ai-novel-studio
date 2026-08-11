import { EmptyState } from '../components/EmptyState'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Tags, Plus } from 'lucide-react'
import { novelApi, assetsApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/Toast'
import { AssetCreator } from '../components/AssetCreator'

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
      <div className="row mb-4">
        <Tags size={20} />
        <h1 className="ml-2">流派管理</h1>
      </div>
      {error && <ErrorMsg error={error} />}

      {/* P23：上传/粘贴/手动 → AI 生成流派模板（推进/兑现/冲突/节拍） */}
      <AssetCreator
        type="genre"
        typeLabel="流派模板"
        placeholder="粘贴该流派的代表段落、套路描述或题材分析…（AI 提炼推进/兑现/冲突/黄金三章）"
        maxLen={10000}
        onSave={async (draft) => {
          const name = String(draft.name ?? '未命名流派').slice(0, 30)
          const r = await novelApi.genreCreate(name, undefined)
          await assetsApi.genrePatch(r.id, {
            genreType: String(draft.genreType ?? name).slice(0, 30),
            propulsion: Array.isArray(draft.propulsion) ? (draft.propulsion as string[]) : [],
            payoff: Array.isArray(draft.payoff) ? (draft.payoff as string[]) : [],
            conflict: Array.isArray(draft.conflict) ? (draft.conflict as string[]) : [],
            beats: Array.isArray(draft.beats) ? (draft.beats as string[]) : []
          })
        }}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['genres'] })}
      />

      <div className="panel mb-4">
        <h2 className="mb-2">创建全局流派</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          全局流派可在任意书的项目设定中选择；书中绑定后注入爽点/节奏模板。
        </p>
        <div className="row">
          <input className="flex-1" placeholder="流派名（如：克苏鲁、无限流）" value={newGenre} onChange={(e) => setNewGenre(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createGlobal() }} />
          <button className="primary" disabled={busy || !newGenre.trim()} onClick={() => void createGlobal()}>
            <Plus size={14} className="icon-gap" />创建
          </button>
        </div>
      </div>

      <div className="panel mb-4">
        <h2 className="mb-3">全局预设（{globalGenres.length}）</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {globalGenres.map((g) => <span key={g.id} className="chip">{g.name}</span>)}
        </div>
      </div>

      <div className="panel">
        <h2 className="mb-3">书内自定义流派</h2>
        {customGenres.length === 0 && <EmptyState icon={Tags} title="?????????" desc="??????????????????" />}
        <div className="col gap-2">
          {novels.data?.novels.map((n) => {
            const cg = customGenres.filter((g) => g.novelId === n.id)
            return cg.length > 0 ? (
              <div key={n.id} className="row" style={{ padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6, flexWrap: 'wrap' }}>
                <strong className="t3">{n.title || `#${n.id}`}</strong>
                {cg.map((g) => <span key={g.id} className="chip">{g.name}</span>)}
              </div>
            ) : null
          })}
        </div>
      </div>
    </div>
  )
}
