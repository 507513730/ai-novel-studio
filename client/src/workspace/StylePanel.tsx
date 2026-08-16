import { useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { styleApi } from '../api'

interface Feature {
  id: string
  name: string
  description: string
  enabled: boolean
  category: string
}

export function StylePanel({ novelId }: { novelId: number }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [sample, setSample] = useState('')
  const [assetName, setAssetName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [trialTask, setTrialTask] = useState('')
  const [trialOutput, setTrialOutput] = useState('')
  const [trialRules, setTrialRules] = useState<string[]>([])
  const [checkText, setCheckText] = useState('')
  const [checkResult, setCheckResult] = useState<{ hits: Array<{ word: string; count: number }>; total: number } | null>(null)
  const [extTitle, setExtTitle] = useState('')
  const [extContent, setExtContent] = useState('')

  const assets = useQuery<{ assets: Array<{ id: number; name: string; features: Feature[]; antiAiWords: string[]; createdAt: string }> }>({
    queryKey: ['style', novelId],
    // v0.17.0（审查 A32）：查询泛型给 Feature[]，并在边界做字段归一（消除双转型 + 形状校验）
    queryFn: async () => {
      const r = await styleApi.list(novelId)
      return {
        assets: r.assets.map((a) => ({
          id: a.id,
          name: a.name,
          antiAiWords: a.antiAiWords,
          createdAt: a.createdAt,
          features: (a.features ?? []).map((f) => ({
            id: String(f.id),
            name: String(f.name),
            description: String(f.description ?? ''),
            enabled: Boolean(f.enabled),
            category: String(f.category ?? '')
          }))
        }))
      }
    }
  })

  // v0.17.0（审查 A12）：检测/注入各自 busy 门控（参考 extract/trial 模式）
  const [checkBusy, setCheckBusy] = useState(false)
  const [extBusy, setExtBusy] = useState(false)

  const err = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  const extract = async (): Promise<void> => {
    if (sample.trim().length < 200) {
      setError('示例文本至少 200 字')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await styleApi.extract(novelId, sample, assetName.trim() || '我的写法')
      setMsg('特征提取完成，已创建写法资产')
      setSample('')
      setAssetName('')
      await assets.refetch()
    } catch (e) {
      setError(err(e))
    } finally {
      setBusy(false)
    }
  }

  const [featureBusy, setFeatureBusy] = useState(false)

  const toggleFeature = async (assetId: number, features: Feature[], featureId: string): Promise<void> => {
    if (featureBusy) return
    setFeatureBusy(true)
    // P9 D7：乐观更新（本地先行切换，失败回滚）
    const original = features
    const next = features.map((f) => (f.id === featureId ? { ...f, enabled: !f.enabled } : f))
    queryClient.setQueryData(['style', novelId], (old: unknown) => {
      const o = old as { assets: Array<{ id: number; features: Feature[] }> } | undefined
      if (!o) return old
      return {
        ...o,
        assets: o.assets.map((a) => (a.id === assetId ? { ...a, features: next } : a))
      }
    })
    try {
      await styleApi.updateFeatures(novelId, assetId, next as unknown as Array<Record<string, unknown>>)
      await assets.refetch()
    } catch (e) {
      queryClient.setQueryData(['style', novelId], (old: unknown) => {
        const o = old as { assets: Array<{ id: number; features: Feature[] }> } | undefined
        if (!o) return old
        return {
          ...o,
          assets: o.assets.map((a) => (a.id === assetId ? { ...a, features: original } : a))
        }
      })
      setError(err(e))
    } finally {
      setFeatureBusy(false)
    }
  }

  const trial = async (): Promise<void> => {
    if (trialTask.trim().length < 10) {
      setError('试写任务至少 10 字')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await styleApi.trial(novelId, trialTask)
      setTrialOutput(r.output)
      setTrialRules(r.usedRules)
    } catch (e) {
      setError(err(e))
    } finally {
      setBusy(false)
    }
  }

  const check = async (): Promise<void> => {
    if (!checkText.trim() || checkBusy) return
    setCheckBusy(true)
    setError(null)
    try {
      const r = await styleApi.antiAiCheck(novelId, checkText)
      setCheckResult(r)
    } catch (e) {
      setError(err(e))
    } finally {
      setCheckBusy(false)
    }
  }

  const addExternal = async (): Promise<void> => {
    if (extTitle.trim().length < 1 || extContent.trim().length < 50) {
      setError('外部资料标题必填，内容至少 50 字')
      return
    }
    if (extBusy) return
    setExtBusy(true)
    setError(null)
    try {
      const r = await styleApi.external(novelId, extTitle.trim(), extContent.trim())
      setMsg(`外部资料已注入（kbDocId=${r.kbDocId}），下次生成正文时直塞生效`)
      setExtTitle('')
      setExtContent('')
    } catch (e) {
      setError(err(e))
    } finally {
      setExtBusy(false)
    }
  }

  return (
    <div className="col">
      {error && <ErrorMsg error={error} />}
      {msg && <div style={{ color: 'var(--ok)' }}>{msg}</div>}

      <div className="panel">
        <h2>写法特征提取</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          粘贴一段你喜欢的文风示例（≥200 字），AI 提取 8-15 个写法特征 → 创建可启停的写法资产。
        </p>
        <div className="row mb-2">
          <input
            style={{ width: 200 }}
            placeholder="资产名（如：我的悬疑文风）"
            value={assetName}
            onChange={(e) => setAssetName(e.target.value)}
          />
          <button className="primary" disabled={busy} onClick={() => void extract()}>
            {busy ? '提取中…' : '提取特征'}
          </button>
        </div>
        <textarea
          style={{ width: '100%', minHeight: 120, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontFamily: 'inherit', fontSize: 13 }}
          placeholder="粘贴示例文本…"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
      </div>

      {assets.data && assets.data.assets.length > 0 && (
        <div className="panel">
          <h2>写法资产（绑定生效）</h2>
          {assets.data.assets.map((a) => (
            <div key={a.id} style={{ marginBottom: 12, padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
              <div className="row justify-between">
                <strong>{a.name}</strong>
                <span className="muted t-small">{a.createdAt}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {/* v0.17.0（审查 A32）：查询泛型直接给 Feature[]——消除双重转型 */}
                {a.features.map((f) => (
                  <button
                    key={f.id}
                    title={f.description}
                    style={{
                      fontSize: 12,
                      padding: '3px 10px',
                      background: f.enabled ? 'var(--accent-soft)' : 'var(--bg-panel)',
                      borderColor: f.enabled ? 'var(--accent)' : 'var(--border)',
                      color: f.enabled ? 'var(--accent)' : 'var(--text-dim)'
                    }}
                    onClick={() => void toggleFeature(a.id, a.features, f.id)}
                  >
                    {f.enabled ? '✓ ' : ''}{f.name}
                  </button>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                反 AI 词库：{a.antiAiWords.length} 词（全局词库自动并入）· 启用特征在生成正文时注入
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <h2>试写对比</h2>
        <div className="row mb-2">
          <input
            className="flex-1"
            placeholder="试写任务（如：写一段主角深夜调查古董店的情节）"
            value={trialTask}
            onChange={(e) => setTrialTask(e.target.value)}
          />
          <button disabled={busy} onClick={() => void trial()}>试写</button>
        </div>
        {trialOutput && (
          <div className="panel" style={{ background: 'var(--bg-card)' }}>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>{trialOutput}</div>
            {trialRules.length > 0 && (
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                使用的写法规则：{trialRules.length} 条
              </div>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>反 AI 检测</h2>
        <div className="row mb-2">
          <input
            className="flex-1"
            placeholder="粘贴正文检测反 AI 词"
            value={checkText}
            onChange={(e) => setCheckText(e.target.value)}
          />
          <button disabled={checkBusy} onClick={() => void check()}>{checkBusy ? '检测中…' : '检测'}</button>
        </div>
        {checkResult && (
          <div className="t-small">
            <span className="badge" style={checkResult.total > 0 ? { color: 'var(--danger)', background: 'var(--danger-soft)' } : {}}>
              {checkResult.total > 0 ? `命中 ${checkResult.total} 处` : '无命中 ✓'}
            </span>
            {checkResult.hits.map((h) => (
              <div key={h.word} className="muted" style={{ marginTop: 4 }}>「{h.word}」× {h.count}</div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>外部资料直塞注入（替代 RAG）</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          参考资料/设定文档将直接注入生成上下文前缀（复用缓存机制），总量 &gt;100 万字时才需真 RAG。
        </p>
        <div className="row mb-2">
          <input
            style={{ width: 200 }}
            placeholder="资料标题"
            value={extTitle}
            onChange={(e) => setExtTitle(e.target.value)}
          />
          <button className="primary" disabled={extBusy} onClick={() => void addExternal()}>{extBusy ? '注入中…' : '注入资料'}</button>
        </div>
        <textarea
          style={{ width: '100%', minHeight: 80, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontFamily: 'inherit', fontSize: 13 }}
          placeholder="资料内容（设定文档/史料/参考书摘录）…"
          value={extContent}
          onChange={(e) => setExtContent(e.target.value)}
        />
      </div>
    </div>
  )
}
