import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { WandSparkles } from 'lucide-react'
import { globalStyleApi, novelApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/Toast'

// P17-1：写法引擎全局页（跨书资产总览 + 全局写法创建 + 导入到书）
export function StyleEnginePage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sample, setSample] = useState('')
  const [name, setName] = useState('')

  const assets = useQuery({ queryKey: ['style-global'], queryFn: globalStyleApi.list })
  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({ queryKey: ['novels'], queryFn: novelApi.list })

  const createGlobal = async (): Promise<void> => {
    if (busy || sample.trim().length < 200) {
      if (sample.trim().length < 200) setError('示例文本至少 200 字')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await globalStyleApi.create(sample, name.trim() || '我的全局写法')
      setSample('')
      setName('')
      toast('ok', '全局写法资产已创建')
      void queryClient.invalidateQueries({ queryKey: ['style-global'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  const importTo = async (assetId: number, novelId: number): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await globalStyleApi.importToNovel(novelId, assetId)
      toast('ok', '已导入该书')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <WandSparkles size={20} />
        <h1 style={{ marginLeft: 8 }}>写法引擎</h1>
      </div>
      {error && <ErrorMsg error={error} />}

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 8 }}>创建全局写法资产</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          用一段有个人风格的示例文本提取特征，成为全局资产，可随时导入任意书。
        </p>
        <textarea
          style={{ width: '100%', minHeight: 90, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontFamily: 'inherit', fontSize: 13 }}
          placeholder="粘贴 200 字以上示例文本…"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <input style={{ flex: 1 }} placeholder="资产名（默认：我的全局写法）" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" disabled={busy} onClick={() => void createGlobal()}>
            {busy ? '提取中…' : '提取并创建'}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginBottom: 10 }}>全部写法资产</h2>
        {assets.isLoading && <p className="muted">加载中…</p>}
        <div className="col" style={{ gap: 8 }}>
          {assets.data?.assets.map((a) => (
            <div key={a.id} className="panel" style={{ background: 'var(--bg-card)', padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{a.name}</strong>
                  {a.global ? (
                    <span className="badge" style={{ marginLeft: 8 }}>全局</span>
                  ) : (
                    <button
                      className="badge"
                      style={{ marginLeft: 8, cursor: 'pointer', background: 'var(--accent-soft)', color: 'var(--accent-bright)' }}
                      onClick={() => navigate(`/novels/${a.novelId}/?tab=style`)}
                    >
                      {a.novelTitle || `#${a.novelId}`} 书内
                    </button>
                  )}
                </div>
                <div className="row">
                  <span className="muted" style={{ fontSize: 11 }}>{a.features.length} 特征</span>
                  {a.global && (
                    <select
                      style={{ width: 150, padding: '4px 8px', fontSize: 12 }}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) void importTo(a.id, Number(e.target.value))
                        e.target.value = ''
                      }}
                    >
                      <option value="" disabled>导入到…</option>
                      {novels.data?.novels.map((n) => (
                        <option key={n.id} value={n.id}>{n.title || `#${n.id}`}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!assets.isLoading && assets.data?.assets.length === 0 && <p className="muted">还没有写法资产。</p>}
        </div>
      </div>
    </div>
  )
}
