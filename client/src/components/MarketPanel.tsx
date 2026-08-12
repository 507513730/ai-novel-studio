import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api'
import { useToast } from './Toast'

// v0.11.0（批C）：方案市场——GitHub 仓库 solutions/ 目录即市场（index.json 索引，raw 拉取）
const MARKET_INDEX_URL = 'https://raw.githubusercontent.com/507513730/ai-novel-studio/main/solutions/index.json'

interface MarketEntry {
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  file: string
  updatedAt: string | null
  metrics: { stepCount: number; agentCount: number; wholeBook: boolean } | null
  hasSample: boolean
  hasWholeBook: boolean
}

interface SolutionPack {
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  metrics: { stepCount: number; agentCount: number; wholeBook: boolean }
  sampleBook?: { title: string; worldSummary: string; characterSummary: string; chapters: Array<{ title: string; excerpt: string }> }
}

export function MarketPanel(): React.JSX.Element {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [detail, setDetail] = useState<{ entry: MarketEntry; pack: SolutionPack | null; loading: boolean } | null>(null)
  const [importing, setImporting] = useState(false)

  const market = useQuery<MarketEntry[]>({
    queryKey: ['market'],
    queryFn: async () => {
      const res = await fetch(MARKET_INDEX_URL)
      if (!res.ok) throw new Error(`市场索引不可用（HTTP ${res.status}）`)
      return (await res.json()) as MarketEntry[]
    },
    retry: 1,
    staleTime: 5 * 60 * 1000
  })

  const localSolutions = useQuery<{ solutions: Array<{ name: string }> }>({
    queryKey: ['studio-solutions'],
    queryFn: () => apiFetch('/solutions') as Promise<{ solutions: Array<{ name: string }> }>
  })
  const localNames = new Set((localSolutions.data?.solutions ?? []).map((s) => s.name))

  const openDetail = async (entry: MarketEntry): Promise<void> => {
    setDetail({ entry, pack: null, loading: true })
    try {
      const res = await fetch(`https://raw.githubusercontent.com/507513730/ai-novel-studio/main/solutions/${entry.file}`)
      if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
      setDetail({ entry, pack: (await res.json()) as SolutionPack, loading: false })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
      setDetail(null)
    }
  }

  const importPack = async (): Promise<void> => {
    if (!detail?.pack || importing) return
    setImporting(true)
    try {
      const r = await apiFetch('/solutions/import', {
        method: 'POST',
        body: JSON.stringify({ bundle: JSON.stringify(detail.pack) })
      })
      const res = r as { solutionId: number; name: string; sampleBook?: SolutionPack['sampleBook'] }
      toast('ok', `已导入方案「${res.name}」${res.sampleBook ? '（含样例）' : ''}`)
      void qc.invalidateQueries({ queryKey: ['studio-solutions'] })
      setDetail(null)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  if (market.isError) {
    return (
      <div className="panel" style={{ padding: 16, fontSize: 13 }}>
        ⚠️ 方案市场不可用（{market.error instanceof Error ? market.error.message : '未知错误'}）
        <br />
        <span className="muted t-small">市场数据来自 GitHub 仓库 solutions/ 目录（{MARKET_INDEX_URL}），请检查网络后
          <button className="sm" style={{ marginLeft: 8 }} onClick={() => void market.refetch()}>重试</button>
        </span>
      </div>
    )
  }

  const entries = market.data ?? []

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <strong style={{ fontSize: 14 }}>方案市场</strong>
          <span className="muted t-small" style={{ marginLeft: 8 }}>GitHub 仓库 solutions/ 目录 · 一键导入（{entries.length} 个可用）</span>
        </div>
        <button className="sm" onClick={() => void market.refetch()}>刷新</button>
      </div>
      {market.isLoading && <div className="muted t-small">加载中…</div>}
      {!market.isLoading && entries.length === 0 && (
        <div className="muted t-small">市场暂无方案——仓库 solutions/ 目录为空</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map((e) => (
          <div key={e.id} className="row" style={{ gap: 10, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <strong style={{ fontSize: 13 }}>{e.name}</strong>{' '}
              <span className="muted t-small">v{e.version}</span>
              {localNames.has(e.name) && (
                <span style={{ fontSize: 11, color: 'var(--ok)', marginLeft: 6 }}>✓ 已安装</span>
              )}
              <div className="muted t-small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {e.description}
              </div>
            </div>
            <div className="muted t-small">
              {e.metrics?.stepCount ?? '?'} 步 · {e.metrics?.agentCount ?? '?'} 智能体
              {e.hasWholeBook ? ' · 整本' : ''}
              {e.hasSample ? ' · 含样例' : ''}
            </div>
            {detail?.entry.id === e.id ? (
              <button className="sm primary" disabled={importing} onClick={() => void importPack()}>
                {importing ? '导入中…' : '导入到本地'}
              </button>
            ) : (
              <button className="sm" onClick={() => void openDetail(e)}>{detail?.entry.id === e.id ? '…' : '详情'}</button>
            )}
          </div>
        ))}
      </div>

      {detail && detail.entry && (
        <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--accent)', borderRadius: 10, background: 'var(--bg-card)' }}>
          <strong>{detail.entry.name}</strong> v{detail.entry.version}
          <div className="muted t-small" style={{ marginTop: 4 }}>{detail.pack?.description ?? detail.entry.description}</div>
          {detail.loading ? (
            <div className="muted t-small" style={{ marginTop: 8 }}>下载包…</div>
          ) : (
            detail.pack?.sampleBook && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <div><b>样例书：</b>{detail.pack.sampleBook.title}</div>
                {detail.pack.sampleBook.chapters.map((c, i) => (
                  <div key={i} style={{ marginTop: 6, padding: 6, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <b>{c.title}</b>
                    <div className="muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{c.excerpt}</div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
