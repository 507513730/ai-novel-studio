import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Hammer, Sparkles, Database } from 'lucide-react'
import { apiFetch } from '../api'
import { useToast } from '../components/toastGlobal'

// v0.24.4（B4）：网文要素生成器——人名/地名/门派/功法/宝物/金手指/桥段 批量生成（extraction 单次调用）
const CATEGORIES = ['人名', '地名', '门派', '功法', '宝物', '金手指', '桥段'] as const

interface ForgeItem {
  category: string
  list: Array<{ name: string; desc: string }>
}

export function ForgePage(): React.JSX.Element {
  const { toast } = useToast()
  const [genre, setGenre] = useState('')
  const [cats, setCats] = useState<string[]>(['人名', '地名'])
  const [count, setCount] = useState(8)
  const [style, setStyle] = useState('')
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<ForgeItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const genres = useQuery({ queryKey: ['genres-0'], queryFn: () => apiFetch('/genres?novelId=0') as Promise<{ genres: Array<{ id: number; name: string }> }> })

  const generate = async (): Promise<void> => {
    if (!genre.trim() || cats.length === 0) {
      setError('请选择题材与要素类别')
      return
    }
    setBusy(true)
    setError(null)
    setItems(null)
    try {
      const r = (await apiFetch('/forge/generate', {
        method: 'POST',
        body: JSON.stringify({ genre: genre.trim(), categories: cats, count, style: style.trim() })
      })) as { items: ForgeItem[] }
      setItems(r.items)
      toast('ok', `已生成 ${r.items.reduce((a, i) => a + i.list.length, 0)} 个要素`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const importToKb = async (category: string, name: string, desc: string): Promise<void> => {
    try {
      await apiFetch('/knowledge', {
        method: 'POST',
        body: JSON.stringify({ title: `${category}-${name}`, content: desc, novelId: 0 })
      })
      toast('ok', `已存入知识库：${name}`)
    } catch (e) {
      toast('error', `存入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1080, margin: '0 auto' }}>
      <h2 className="mb-2 row gap-2"><Hammer size={18} />网文要素工坊</h2>
      <p className="muted t-small mb-2">六类要素批量生成（设定种子）；生成结果可一键存入知识库（全局资产，书级可用）。</p>

      <div className="panel col" style={{ padding: 14, gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select style={{ minWidth: 140 }} value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="">选择题材…</option>
            {(genres.data?.genres ?? []).filter((g) => g.name !== '自定义').map((g) => (
              <option key={g.id} value={g.name}>{g.name}</option>
            ))}
            {genre && <option value={genre}>{genre}（自定义）</option>}
          </select>
          <input style={{ flex: '1 1 200px' }} placeholder="或直接输入题材（如：都市异能）" value={genre} onChange={(e) => setGenre(e.target.value)} />
          <input style={{ width: 70 }} type="number" min={3} max={15} value={count} onChange={(e) => setCount(Number(e.target.value))} title="每类数量（3-15）" />
          <button className="sm primary" disabled={busy} onClick={() => void generate()}>
            <Sparkles size={12} className="icon-gap" />{busy ? '生成中…' : '生成'}
          </button>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => (
            <label key={c} className="row" style={{ fontSize: 12, gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={cats.includes(c)}
                onChange={() => setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
              />
              {c}
            </label>
          ))}
        </div>
        <input placeholder="风格要求（可选，如：古风含蓄 / 科技感 / 传统仙侠）" value={style} onChange={(e) => setStyle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void generate() }} />
      </div>

      {error && <p className="muted" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</p>}

      {items && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10, marginTop: 12 }}>
          {items.map((cat) => (
            <div key={cat.category} className="panel" style={{ padding: 12 }}>
              <strong className="t3" style={{ display: 'block', marginBottom: 8 }}>{cat.category}（{cat.list.length}）</strong>
              <div className="col" style={{ gap: 6 }}>
                {cat.list.map((it) => (
                  <div key={it.name} className="row" style={{ gap: 8, fontSize: 12, alignItems: 'flex-start' }}>
                    <div className="col" style={{ flex: 1, gap: 2 }}>
                      <strong>{it.name}</strong>
                      <span className="muted" style={{ fontSize: 11 }}>{it.desc}</span>
                    </div>
                    <button className="sm" title="存入知识库（全局资产）" onClick={() => void importToKb(cat.category, it.name, it.desc)}>
                      <Database size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
