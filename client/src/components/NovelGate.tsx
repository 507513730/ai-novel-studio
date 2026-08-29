import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpenText } from 'lucide-react'
import { novelApi } from '../api'
import { EmptyState } from './EmptyState'
import { Loading } from './Loading'

// P17-1：书级功能落地页（无书时选书进入；有书时跳转对应功能）
export function NovelGate({ title, desc, target }: { title: string; desc: string; target: (novelId: number) => string }): React.JSX.Element {
  const navigate = useNavigate()
  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({ queryKey: ['novels'], queryFn: novelApi.list })

  return (
    <div className="page-narrow" style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <div className="row mb-4">
        <BookOpenText size={20} />
        <h1 className="ml-2">{title}</h1>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>{desc}</p>
      {novels.isLoading && <Loading lines={3} />}
      {novels.isError && (
        // v0.17.0（审查 C36）：补错误态——此前加载失败时页面空白，无任何提示
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted" style={{ color: 'var(--danger)', margin: 0 }}>
            小说列表加载失败：{novels.error instanceof Error ? novels.error.message : String(novels.error)}
          </p>
          <button className="sm mt-2" onClick={() => void novels.refetch()}>重试</button>
        </div>
      )}
      {novels.data?.novels.length === 0 && (
        <EmptyState
          icon={BookOpenText}
          title="还没有小说"
          desc={`先创建一本小说，再进入${title}。`}
          action={<button className="primary" onClick={() => navigate('/')}>去创建小说</button>}
        />
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
