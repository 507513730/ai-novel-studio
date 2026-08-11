import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Workflow } from 'lucide-react'
import { novelApi } from '../api'

// P16 P1：导演跟进（待审核/待处理聚合：failed jobs + pending 待确认 + 导演阻塞）
export function FollowUpsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const jobs = useQuery({ queryKey: ['jobs', 'followups'], queryFn: novelApi.jobs, refetchInterval: 5000 })
  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({ queryKey: ['novels'], queryFn: novelApi.list })

  const failed = (jobs.data?.jobs ?? []).filter((j) => j.status === 'failed')
  const novelIdByFailed = [...new Set(failed.map((j) => Number(j.payload.novelId ?? 0)).filter(Boolean))]

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <Workflow size={20} />
        <h1 style={{ marginLeft: 8 }}>导演跟进</h1>
      </div>

      <div className="panel" style={{ marginBottom: 16, background: 'var(--bg-card)' }}>
        <h2 style={{ marginBottom: 8 }}>失败任务（需处理）</h2>
        {failed.length === 0 && <p className="muted" style={{ fontSize: 13 }}>暂无失败任务。自动导演的阻塞/失败会出现在这里。</p>}
        <div className="col" style={{ gap: 8 }}>
          {failed.map((j) => {
            const nid = Number(j.payload.novelId ?? 0)
            const title = novels.data?.novels.find((n) => n.id === nid)?.title ?? `#${nid}`
            return (
              <div key={j.id} className="panel" style={{ background: 'var(--bg-input)', padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong>#{j.id} 自动导演 · {title}</strong>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{j.error ?? ''}</div>
                  </div>
                  <div className="row">
                    {nid > 0 && (
                      <button className="sm primary" onClick={() => navigate(`/novels/${nid}/director`)}>去导演页恢复</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="panel" style={{ background: 'var(--bg-card)' }}>
        <h2 style={{ marginBottom: 8 }}>待确认事项</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          章节状态回灌的待确认区、半自动模式的阶段确认都在对应小说的工作台中。
        </p>
        {novelIdByFailed.length === 0 && failed.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>当前没有需要处理的事项。</p>
        )}
        {novels.data?.novels.map((n) => (
          <div key={n.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13 }}>{n.title || '未命名'}</span>
            <button className="sm" onClick={() => navigate(`/novels/${n.id}/director`)}>导演页</button>
          </div>
        ))}
      </div>
    </div>
  )
}
