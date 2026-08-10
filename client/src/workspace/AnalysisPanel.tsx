import { useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { analysisApi, novelApi } from '../api'

interface AnalysisResult {
  genre?: string
  structure?: string
  characters?: string
  world?: string
  style?: string
  strengths?: string[]
  weaknesses?: string[]
}

export function AnalysisPanel({ novelId }: { novelId: number }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [depth, setDepth] = useState<'quick' | 'standard' | 'full'>('standard')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<AnalysisResult | null>(null)
  const [charName, setCharName] = useState('')
  const [charDepth, setCharDepth] = useState<'brief' | 'standard' | 'deep' | 'full'>('standard')
  const [charProfile, setCharProfile] = useState<Record<string, unknown> | null>(null)
  const [evolution, setEvolution] = useState<Array<Record<string, unknown>> | null>(null)
  const [coverage, setCoverage] = useState('100')
  const [msg, setMsg] = useState<string | null>(null)

  const history = useQuery({
    queryKey: ['analysis', novelId],
    queryFn: () => analysisApi.list(novelId)
  })

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await analysisApi.run(novelId, depth)
      setReport(r.report as AnalysisResult)
      setMsg(`拆书完成（${depth} 档）`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const analyzeChar = async (): Promise<void> => {
    if (!charName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await analysisApi.character(novelId, charName.trim(), charDepth)
      setCharProfile(r.profile)
      setMsg(`角色档案完成（${charName.trim()}）`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runEvolution = async (): Promise<void> => {
    if (!charName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await analysisApi.evolution(novelId, charName.trim(), coverage)
      setEvolution(r.evolution)
      setMsg(`形象演变扫描完成（${coverage}% 覆盖率）`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // P14 B1：融合入档（外貌/状态锚点合并到角色档案，留图像空间）
  const mergeEvolution = async (): Promise<void> => {
    if (!charName.trim() || !evolution || evolution.length === 0) return
    setMergeBusy(true)
    setError(null)
    try {
      const chars = (await novelApi.characters(novelId)).characters
      const target = chars.find((c) => c.name === charName.trim())
      if (!target) throw new Error(`角色「${charName.trim()}」不在名册中`)
      const anchors = evolution
        .map((e) => `${str(e.stage)}：${str(e.appearance)}（${str(e.state)}）`)
        .join('；')
      const merged = { ...target.profile, appearanceEvolution: anchors }
      await novelApi.characterPatch(novelId, target.id, { profile: merged })
      setMsg(`已融合形象演变到「${target.name}」档案`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const [publishBusy, setPublishBusy] = useState<string | null>(null)
  const [mergeBusy, setMergeBusy] = useState(false)

  const publish = async (analysisId: number, target: 'kb' | 'style'): Promise<void> => {
    if (publishBusy) return
    setPublishBusy(`${analysisId}-${target}`)
    try {
      if (target === 'kb') {
        await analysisApi.publishKb(novelId, analysisId)
        setMsg('已发布到知识库')
      } else {
        await analysisApi.toStyle(novelId, analysisId)
        setMsg('已转为写法资产')
      }
      void queryClient.invalidateQueries({ queryKey: ['analysis', novelId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPublishBusy(null)
    }
  }

  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

  return (
    <div className="col">
      {error && <ErrorMsg error={error} />}
      {msg && <div style={{ color: 'var(--ok)' }}>{msg}</div>}

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>拆书分析</h2>
          <div className="row">
            <select value={depth} onChange={(e) => setDepth(e.target.value as 'quick' | 'standard' | 'full')}>
              <option value="quick">快速</option>
              <option value="standard">标准</option>
              <option value="full">完整</option>
            </select>
            <button className="primary" disabled={busy} onClick={() => void run()}>
              {busy ? '分析中…' : '开始拆书'}
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          拆书产出五维报告，可发布到知识库或转为写法资产（P4 消费）。
        </p>
        {report && (
          <div className="panel" style={{ background: 'var(--bg-card)', marginTop: 10 }}>
            <div><strong>题材定位：</strong>{str(report.genre)}</div>
            <div style={{ marginTop: 6 }}><strong>剧情结构：</strong>{str(report.structure)}</div>
            <div style={{ marginTop: 6 }}><strong>人物系统：</strong>{str(report.characters)}</div>
            <div style={{ marginTop: 6 }}><strong>世界设定：</strong>{str(report.world)}</div>
            <div style={{ marginTop: 6 }}><strong>写法技法：</strong>{str(report.style)}</div>
            {arr(report.strengths).length > 0 && (
              <div style={{ marginTop: 6 }}><strong>优点：</strong>{arr(report.strengths).join('；')}</div>
            )}
            {arr(report.weaknesses).length > 0 && (
              <div style={{ marginTop: 6 }}><strong>缺点：</strong>{arr(report.weaknesses).join('；')}</div>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>角色档案与形象演变</h2>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            style={{ width: 160 }}
            placeholder="角色名"
            value={charName}
            onChange={(e) => setCharName(e.target.value)}
          />
          <select value={charDepth} onChange={(e) => setCharDepth(e.target.value as 'brief' | 'standard' | 'deep' | 'full')}>
            <option value="brief">简要</option>
            <option value="standard">标准</option>
            <option value="deep">深入</option>
            <option value="full">完整</option>
          </select>
          <button disabled={busy} onClick={() => void analyzeChar()}>生成角色档案</button>
          <select value={coverage} onChange={(e) => setCoverage(e.target.value)}>
            <option value="25">25%</option>
            <option value="50">50%</option>
            <option value="75">75%</option>
            <option value="100">100%</option>
          </select>
          <button disabled={busy} onClick={() => void runEvolution()}>形象演变扫描</button>
        </div>
        {charProfile && (
          <div className="panel" style={{ background: 'var(--bg-card)', marginTop: 10 }}>
            {Object.entries(charProfile).map(([k, v]) => (
              <div key={k} style={{ marginTop: 4 }}>
                <strong>{k}：</strong>
                <span className="muted">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
              </div>
            ))}
          </div>
        )}
        {evolution && evolution.length > 0 && (
          <div className="col" style={{ marginTop: 10, gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 13 }}>形象演变（{coverage}% 覆盖率）</strong>
              {/* P14 B1：融合入档（合并外貌/状态锚点到角色档案） */}
              <button
                className="sm primary"
                disabled={mergeBusy || !charName.trim()}
                onClick={() => void mergeEvolution()}
              >
                {mergeBusy ? '融合中…' : '融合入档案'}
              </button>
            </div>
            {evolution.map((e, i) => (
              <div key={i} style={{ fontSize: 12, padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6 }}>
                <strong>{str(e.stage)}</strong>
                <div className="muted">外貌：{str(e.appearance)}</div>
                <div className="muted">情绪：{str(e.emotion)} | 状态：{str(e.state)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {history.data && history.data.analyses.length > 0 && (
        <div className="panel">
          <h2>拆书历史</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.data.analyses.map((a) => (
              <div key={a.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6 }}>
                <div>
                  <span className="badge">{a.depth}</span>
                  <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                    {str(a.result.genre)} · {a.createdAt}
                  </span>
                </div>
                <div className="row">
                  <button className='sm' disabled={publishBusy !== null} onClick={() => void publish(a.id, 'kb')}>{publishBusy === `${a.id}-kb` ? '发布中…' : '发布知识库'}</button>
                  <button className='sm' disabled={publishBusy !== null} onClick={() => void publish(a.id, 'style')}>{publishBusy === `${a.id}-style` ? '转换中…' : '转写法资产'}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
