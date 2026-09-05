import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { WandSparkles, Fingerprint } from 'lucide-react'
import { globalStyleApi, novelApi, assetsApi, styleApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/toastGlobal'
import { AssetCreator } from '../components/AssetCreator'

// v0.14.0（批F/I5）：风格指纹面板——结构统计提取（Stylometry：句长均值/方差/短句占比/段落/标点/对话）
function FingerprintPanel({ novels, onSaved }: { novels: Array<{ id: number; title: string }>; onSaved: () => void }): React.JSX.Element {
  const { toast } = useToast()
  const [targetNovel, setTargetNovel] = useState(0)
  const [fpName, setFpName] = useState('我的风格指纹')
  const [fpText, setFpText] = useState('')
  const [useNovelText, setUseNovelText] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ description: string } | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const r = await styleApi.fingerprint(targetNovel, {
        name: fpName.trim() || '我的风格指纹',
        text: fpText.trim() || undefined,
        useNovel: useNovelText || !fpText.trim()
      })
      setResult({ description: r.description })
      toast('ok', '风格指纹已保存为写法资产')
      onSaved()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel mb-4">
      <h2 className="mb-2 row gap-2"><Fingerprint size={16} />风格指纹（统计提取）</h2>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        从参考文本计算句长/段落/标点/对话分布（文体计量学），无需 AI 调用；保存后与普通写法资产一样可绑定注入。
      </p>
      <div className="row mb-2" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select style={{ fontSize: 13 }} value={targetNovel} onChange={(e) => setTargetNovel(Number(e.target.value))}>
          <option value={0}>全局（所有书可用）</option>
          {novels.map((n) => (
            <option key={n.id} value={n.id}>{n.title}</option>
          ))}
        </select>
        <input style={{ flex: '1 1 180px', fontSize: 13 }} placeholder="资产名" value={fpName} onChange={(e) => setFpName(e.target.value)} />
        <label className="muted t-small row gap-1" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={useNovelText} onChange={(e) => setUseNovelText(e.target.checked)} />
          用该书已写章节
        </label>
        <button className="primary sm" disabled={busy} onClick={() => void run()}>{busy ? '提取中…' : '提取指纹'}</button>
      </div>
      {!useNovelText && (
        <textarea
          style={{ width: '100%', minHeight: 70, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontFamily: 'inherit', fontSize: 13 }}
          placeholder="粘贴 ≥500 字参考文本（模仿它的风格写作）…"
          value={fpText}
          onChange={(e) => setFpText(e.target.value)}
        />
      )}
      {result && (
        <div style={{ marginTop: 8, padding: 8, border: '1px solid var(--accent)', borderRadius: 8, fontSize: 12, background: 'var(--bg-card)' }}>
          <b>生成约束：</b>{result.description}
        </div>
      )}
    </div>
  )
}

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
      <div className="row mb-4">
        <WandSparkles size={20} />
        <h1 className="ml-2">写法引擎</h1>
      </div>
      {/* P23：上传/粘贴/手动 → AI 生成写法资产（含反 AI 词提炼） */}
      <AssetCreator
        type="style"
        typeLabel="写法资产"
        placeholder="粘贴代表性文本（≥200 字，AI 提炼写法特征与反 AI 词）"
        maxLen={10000}
        onSave={async (draft) => {
          await assetsApi.styleAssetCreate({
            name: String(draft.name ?? '我的写法').slice(0, 40),
            features: Array.isArray(draft.features)
              ? (draft.features as Array<{ category?: string; name?: string; description?: string }>).map((f) => ({
                  category: String(f.category ?? 'other'),
                  name: String(f.name ?? '特征'),
                  description: String(f.description ?? '')
                }))
              : [],
            antiAiWords: Array.isArray(draft.antiAiWords) ? (draft.antiAiWords as string[]).map(String) : []
          })
        }}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['style-global'] })}
      />
      {error && <ErrorMsg error={error} />}

      <div className="panel mb-4">
        <h2 className="mb-2">创建全局写法资产</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          用一段有个人风格的示例文本提取特征，成为全局资产，可随时导入任意书。
        </p>
        <textarea
          style={{ width: '100%', minHeight: 90, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontFamily: 'inherit', fontSize: 13 }}
          placeholder="粘贴 200 字以上示例文本…"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
        <div className="row mt-2">
          <input className="flex-1" placeholder="资产名（默认：我的全局写法）" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" disabled={busy} onClick={() => void createGlobal()}>
            {busy ? '提取中…' : '提取并创建'}
          </button>
        </div>
      </div>

      {/* v0.14.0（批F/I5）：风格指纹——结构统计提取（句长/段落/标点/对话，零 LLM 成本） */}
      <FingerprintPanel novels={novels.data?.novels ?? []} onSaved={() => void queryClient.invalidateQueries({ queryKey: ['style-global'] })} />

      <div className="panel">
        <h2 className="mb-3">全部写法资产</h2>        {assets.isLoading && <p className="muted">加载中…</p>}
        <div className="col gap-2">
          {assets.data?.assets.map((a) => (
            <div key={a.id} className="panel" style={{ background: 'var(--bg-card)', padding: 12 }}>
              <div className="row justify-between flex-wrap gap-2">
                <div>
                  <strong>{a.name}</strong>
                  {a.global ? (
                    <span className="badge ml-2">全局</span>
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
                  <span className="muted t-small">{a.features.length} 特征</span>
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
