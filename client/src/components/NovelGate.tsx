import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpenText } from 'lucide-react'
import { novelApi } from '../api'

// P17-1：书级功能落地页（无书时选书进入；有书时跳转对应功能）
export function NovelGate({ title, desc, target }: { title: string; desc: string; target: (novelId: number) => string }): React.JSX.Element {
  const navigate = useNavigate()
  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({ queryKey: ['novels'], queryFn: novelApi.list })

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <div className="row mb-4">
        <BookOpenText size={20} />
        <h1 className="ml-2">{title}</h1>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>{desc}</p>
      {novels.isLoading && <p className="muted">加载中…</p>}
      {novels.data?.novels.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 16px' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>📚</div>
          <div style={{ fontSize: 15, marginBottom: 6 }}>还没有小说</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            先创建一本小说，再进入{title}。
          </div>
          <button className="primary" onClick={() => navigate('/')}>去创建小说</button>
        </div>
      )}
      <div className="col gap-2">
        {novels.data?.novels.map((n) => (
          <button
            key={n.id}
            className="panel"
            style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--bg-card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            onClick={() => navigate(target(n.id))}
          >
            <span style={{ fontSize: 14 }}>{n.title || '未命名小说'}</span>
            <span className="muted t-small">进入 {title} →</span>
          </button>
        ))}
      </div>
    </div>
  )
}
