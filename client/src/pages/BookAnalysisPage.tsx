import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ScanSearch } from 'lucide-react'
import { novelApi, analysisApi } from '../api'

// P17-1：拆书全局页（所有书拆书记录 + 发布物总览）
export function BookAnalysisPage(): React.JSX.Element {
  const navigate = useNavigate()
  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({ queryKey: ['novels'], queryFn: novelApi.list })

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <ScanSearch size={20} />
        <h1 style={{ marginLeft: 8 }}>拆书</h1>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        各书的拆书分析与发布物总览。进入书内可执行新拆书、角色档案与形象演变。
      </p>
      <div className="col" style={{ gap: 12 }}>
        {novels.data?.novels.map((n) => (
          <NovelAnalyses key={n.id} novelId={n.id} title={n.title} onOpen={() => navigate(`/novels/${n.id}/?tab=analysis`)} />
        ))}
        {novels.data?.novels.length === 0 && <p className="muted">还没有小说。</p>}
      </div>
    </div>
  )
}

function NovelAnalyses({ novelId, title, onOpen }: { novelId: number; title: string; onOpen: () => void }): React.JSX.Element {
  const q = useQuery({
    queryKey: ['analysis', novelId],
    queryFn: () => analysisApi.list(novelId)
  })
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{title} <span className="muted" style={{ fontSize: 12 }}>#{novelId}</span></strong>
        <button className="sm" onClick={onOpen}>进入拆书工作台</button>
      </div>
      {q.data?.analyses.length === 0 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>暂无拆书记录。</p>}
      <div className="col" style={{ gap: 6, marginTop: 8 }}>
        {q.data?.analyses.map((a) => (
          <div key={a.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6, fontSize: 13 }}>
            <span><span className="badge">{a.depth}</span> <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{String((a.result as Record<string, unknown>)?.genre ?? '')} · {a.createdAt}</span></span>
            <span className="muted" style={{ fontSize: 11 }}>id {a.id}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
