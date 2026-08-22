import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { novelApi } from '../../api'
import type { SearchResults } from '../../types'

// v0.24.2（F2）：书内全文检索面板——左侧资源树搜索框 + 分组结果（300ms 防抖 + seq 丢弃过期响应）
interface BookSearchPanelProps {
  novelId: number
  onSelectChapter: (id: number) => void
}

export function BookSearchPanel({ novelId, onSelectChapter }: BookSearchPanelProps): React.JSX.Element {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    const query = q.trim()
    if (!query) {
      setResults(null)
      setError(null)
      return
    }
    const seq = ++seqRef.current
    const timer = window.setTimeout(() => {
      setBusy(true)
      setError(null)
      void novelApi
        .search(novelId, query)
        .then((r) => {
          if (seq === seqRef.current) setResults(r)
        })
        .catch((err) => {
          if (seq === seqRef.current) setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (seq === seqRef.current) setBusy(false)
        })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [q, novelId])

  const total =
    (results?.chapters.length ?? 0) +
    (results?.characters.length ?? 0) +
    (results?.world.length ?? 0) +
    (results?.foreshadows.length ?? 0) +
    (results?.facts.length ?? 0) +
    (results?.kb.length ?? 0)

  return (
    <div style={{ marginBottom: 8 }}>
      <div className="row" style={{ gap: 4 }}>
        <Search size={13} className="muted" />
        <input
          style={{ flex: 1, minWidth: 0 }}
          placeholder="全书检索（正文/角色/设定/伏笔）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button className="sm" title="清空" onClick={() => setQ('')}>
            <X size={12} />
          </button>
        )}
      </div>
      {q.trim() && (
        <div style={{ marginTop: 6, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {busy && <p className="muted t-small">搜索中…</p>}
          {error && <p className="muted t-small" style={{ color: 'var(--danger)' }}>{error}</p>}
          {!busy && !error && results && total === 0 && (
            <p className="muted t-small">无匹配结果</p>
          )}
          {results?.chapters.map((c) => (
            <button
              key={`c${c.id}`}
              className="sm"
              style={{ textAlign: 'left', alignItems: 'flex-start' }}
              title="打开此章节"
              onClick={() => onSelectChapter(c.id)}
            >
              <strong className="t-small">📖 {c.title || `#${c.id}`}</strong>
              <div className="muted t-small" style={{ fontWeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {c.snippet}
              </div>
            </button>
          ))}
          {results?.characters.map((c) => (
            <div key={`ch${c.id}`} className="panel" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--bg-panel)' }}>
              <strong>👤 {c.name}</strong>
              <div className="muted" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{c.snippet}</div>
            </div>
          ))}
          {results?.world.map((w, i) => (
            <div key={`w${i}`} className="panel" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--bg-panel)' }}>
              <strong>🌍 世界观</strong>
              <div className="muted" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{w.snippet}</div>
            </div>
          ))}
          {results?.foreshadows.map((f) => (
            <div key={`f${f.id}`} className="panel" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--bg-panel)' }}>
              <strong>🧩 伏笔（{f.status === 'paid' ? '已回收' : f.status === 'laid' ? '待回收' : f.status}）</strong>
              <div className="muted" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{f.content}</div>
            </div>
          ))}
          {results?.facts.map((f) => (
            <div key={`fa${f.id}`} className="panel" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--bg-panel)' }}>
              <strong>✅ 事实</strong>
              <div className="muted" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{f.content}</div>
            </div>
          ))}
          {results?.kb.map((d) => (
            <div key={`kb${d.id}`} className="panel" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--bg-panel)' }}>
              <strong>📚 {d.title}</strong>
              <div className="muted" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{d.snippet}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
