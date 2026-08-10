import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { WandSparkles } from 'lucide-react'
import { novelApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/Toast'
import type { NovelSummary } from '../types'

// P12 A5：标题工坊（跨书管理书名：查看/批量生成/编辑/选用）

export function TitlesPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const novels = useQuery<{ novels: NovelSummary[] }>({
    queryKey: ['novels'],
    queryFn: novelApi.list
  })

  const [groups, setGroups] = useState<Record<number, string[]>>({})

  const genTitles = async (novelId: number): Promise<void> => {
    if (busyId !== null) return
    setBusyId(novelId)
    setError(null)
    try {
      const d = await novelApi.detail(novelId)
      const dir = d.novel.direction?.[0]?.scheme
      if (!dir) {
        toast('info', '该书还没有方向方案，请先在工作台生成')
        return
      }
      const r = await novelApi.titles(novelId, dir)
      setGroups((g) => ({ ...g, [novelId]: r.titles }))
      toast('ok', `已生成 ${r.titles.length} 个候选书名`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    } finally {
      setBusyId(null)
    }
  }

  const applyTitle = async (novelId: number, title: string): Promise<void> => {
    try {
      await novelApi.patch(novelId, { title })
      toast('ok', `已选用「${title}」`)
      void novels.refetch()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <WandSparkles size={20} />
        <h1 style={{ marginLeft: 8 }}>标题工坊</h1>
      </div>
      {error && <ErrorMsg error={error} />}
      {novels.isLoading && <p className="muted">加载中…</p>}
      {novels.data?.novels.length === 0 && <p className="muted">还没有小说，先去创建一本吧。</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {novels.data?.novels.map((n) => (
          <div key={n.id} className="panel">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>{n.title || '未命名小说'}</strong>
                <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>#{n.id}</span>
              </div>
              <div className="row">
                <button className="primary sm" disabled={busyId !== null} onClick={() => void genTitles(n.id)}>
                  {busyId === n.id ? '生成中…' : 'AI 生成书名组'}
                </button>
                <button className="sm" onClick={() => navigate(`/novels/${n.id}`)}>去工作台</button>
              </div>
            </div>
            {(groups[n.id]?.length ?? 0) > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
                {groups[n.id].map((t) => (
                  <button
                    key={t}
                    className="sm"
                    style={t === n.title ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
                    onClick={() => void applyTitle(n.id, t)}
                    title={t === n.title ? '当前书名' : '点击选用'}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
