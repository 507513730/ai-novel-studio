import { EmptyState } from '../components/EmptyState'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Workflow , CheckCircle2 } from 'lucide-react'
import { novelApi } from '../api'

// P16 P1：导演跟进（待审核/待处理聚合：failed jobs + pending 待确认 + 导演阻塞）
export function FollowUpsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const jobs = useQuery({
    // v0.23.1（批次 E5）：统一共享 ['jobs'] 缓存（与 AppLayout/列表页/任务中心同源）
    queryKey: ['jobs'],
    queryFn: novelApi.jobs,
    // v0.17.0（审查 C38）：页面不可见时暂停轮询（后台标签不再空转请求）
    refetchInterval: () => (document.visibilityState === 'visible' ? 5000 : false)
  })
  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({ queryKey: ['novels'], queryFn: novelApi.list })

  const failed = (jobs.data?.jobs ?? []).filter((j) => j.status === 'failed')
  const novelIdByFailed = [...new Set(failed.map((j) => Number(j.payload.novelId ?? 0)).filter(Boolean))]

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <div className="row mb-4">
        <Workflow size={20} />
        <h1 className="ml-2">导演跟进</h1>
      </div>

      <div className="panel" style={{ marginBottom: 16, background: 'var(--bg-card)' }}>
        <h2 className="mb-2">失败任务（需处理）</h2>
        {failed.length === 0 && <EmptyState icon={CheckCircle2} title="暂无失败任务" desc="自动导演的阻塞/失败会出现在这里。" />}
        <div className="col gap-2">
          {failed.map((j) => {
            const nid = Number(j.payload.novelId ?? 0)
            const title = novels.data?.novels.find((n) => n.id === nid)?.title ?? `#${nid}`
            return (
              <div key={j.id} className="panel" style={{ background: 'var(--bg-input)', padding: 12 }}>
                <div className="row justify-between flex-wrap gap-2">
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
        <h2 className="mb-2">待确认事项</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          章节状态回灌的待确认区、半自动模式的阶段确认都在对应小说的工作台中。
        </p>
        {novelIdByFailed.length === 0 && failed.length === 0 && (
          <p className="muted t3">当前没有需要处理的事项。</p>
        )}
        {novels.data?.novels.map((n) => (
          <div key={n.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <span className="t3">{n.title || '未命名'}</span>
            <button className="sm" onClick={() => navigate(`/novels/${n.id}/director`)}>导演页</button>
          </div>
        ))}
      </div>
    </div>
  )
}
