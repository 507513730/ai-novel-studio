import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ListChecks, RotateCcw, XCircle, RefreshCw, Trash2, Inbox } from 'lucide-react'
import { novelApi, automationApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { EmptyState } from '../components/EmptyState'
import { useToast } from '../components/Toast'


// P12 A1：任务中心（jobs 统一状态：queued/running/failed/cancelled + 重试/取消）
// P13 G1：重试支持换模型

const STATUS_META: Record<string, { color: string; label: string }> = {
  queued: { color: 'var(--text-faint)', label: '排队中' },
  running: { color: 'var(--accent)', label: '运行中' },
  failed: { color: 'var(--danger)', label: '失败' },
  cancelled: { color: 'var(--text-faint)', label: '已取消' },
  done: { color: 'var(--ok)', label: '完成' }
}

export function TasksPage(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // P13 G1：重试换模型
  const [retryModel, setRetryModel] = useState<Record<number, string>>({})

  const routes = useQuery({
    queryKey: ['model-routes'],
    queryFn: novelApi.modelRoutes
  })
  const models = [...new Set((routes.data?.routes ?? []).map((r) => r.model))]

  const jobs = useQuery({
    queryKey: ['jobs', 'tasks'],
    queryFn: novelApi.jobs,
    refetchInterval: 4000
  })

  const act = async (id: number, fn: () => Promise<{ ok: boolean }>, doneMsg: string): Promise<void> => {
    if (busy !== null) return
    setBusy(id)
    setError(null)
    try {
      await fn()
      toast('ok', doneMsg)
      void queryClient.invalidateQueries({ queryKey: ['jobs', 'tasks'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    } finally {
      setBusy(null)
    }
  }

  const retryWith = (id: number): void => {
    void act(id, () => novelApi.jobRetry(id, retryModel[id] || undefined), retryModel[id] ? `已用 ${retryModel[id]} 重新排队` : '任务已重新排队')
  }

  // P13 G3：导演任务"从断点继续"（复用 directorResume）
  const resumeDirector = (novelId: number): void => {
    if (busy !== null) return
    setBusy(-novelId)
    setError(null)
    void automationApi
      .directorResume(novelId)
      .then(() => {
        toast('ok', '已从断点继续导演任务')
        void queryClient.invalidateQueries({ queryKey: ['jobs', 'tasks'] })
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        toast('error', msg)
      })
      .finally(() => setBusy(null))
  }

  const list = jobs.data?.jobs ?? []

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="row">
          <ListChecks size={20} />
          <h1 style={{ marginLeft: 8 }}>任务中心</h1>
        </div>
        <button className="sm" onClick={() => void jobs.refetch()}><RefreshCw size={13} style={{ verticalAlign: -1, marginRight: 4 }} />刷新</button>
        <button
          className="sm"
          style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
          disabled={busy !== null}
          onClick={() => {
            const done = (jobs.data?.jobs ?? []).filter((j) => j.status === 'done').length
            if (done === 0) {
              toast('info', '没有已完成的任务')
              return
            }
            if (!window.confirm(`将删除 ${done} 条已完成任务记录（不影响正文/文档）。继续？`)) return
            setBusy(-1)
            void automationApi
              .jobsClearDone()
              .then((r: { deleted: number }) => {
                toast('ok', `已清理 ${r.deleted} 条完成记录`)
                void queryClient.invalidateQueries({ queryKey: ['jobs', 'tasks'] })
              })
              .catch((err: unknown) => {
                toast('error', err instanceof Error ? err.message : String(err))
              })
              .finally(() => setBusy(null))
          }}
        >
          <Trash2 size={13} style={{ verticalAlign: -1, marginRight: 4 }} />清理已完成
        </button>
      </div>
      {error && <ErrorMsg error={error} />}
      {jobs.isLoading && <p className="muted">加载中…</p>}
      {!jobs.isLoading && list.length === 0 && <EmptyState icon={Inbox} title="暂无任务" desc="启动自动导演后，任务会出现在这里。" />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map((j) => {
          const meta = STATUS_META[j.status] ?? { color: 'var(--text-dim)', label: j.status }
          const novelId = Number(j.payload.novelId ?? 0)
          return (
            <div key={j.id} className="panel" style={{ background: 'var(--bg-card)' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div className="row">
                  <span
                    style={{ width: 8, height: 8, borderRadius: 4, background: meta.color, display: 'inline-block' }}
                  />
                  <strong>#{j.id} {j.type === 'director' ? '自动导演' : j.type}</strong>
                  <span className="badge" style={{ background: `${meta.color}22`, color: meta.color }}>
                    {meta.label}
                  </span>
                  {novelId > 0 && (
                    <button className="sm" onClick={() => navigate(`/novels/${novelId}/director`)}>
                      去导演页
                    </button>
                  )}
                </div>
                <span className="muted" style={{ fontSize: 11 }}>{j.createdAt}</span>
              </div>
              {j.status === 'running' && typeof j.progress === 'number' && j.progress > 0 && (
                <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'var(--bg-input)' }}>
                  <div
                    style={{ height: '100%', borderRadius: 2, background: 'var(--accent)', width: `${Math.min(100, j.progress * 100)}%` }}
                  />
                </div>
              )}
              {j.error && (
                <div className="muted" style={{ fontSize: 12, marginTop: 8, color: 'var(--danger)' }}>
                  失败原因：{j.error}
                </div>
              )}
              {(j.status === 'failed' || j.status === 'cancelled') && (
                <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  {j.type === 'director' && novelId > 0 && (
                    <button className="sm primary" disabled={busy !== null} onClick={() => resumeDirector(novelId)}>
                      {busy === -novelId ? '继续中…' : '▶ 从断点继续'}
                    </button>
                  )}
                  <select
                    style={{ width: 180, padding: '4px 8px', fontSize: 12 }}
                    value={retryModel[j.id] ?? ''}
                    onChange={(e) => setRetryModel((m) => ({ ...m, [j.id]: e.target.value }))}
                    title="重试时使用的模型（默认原模型）"
                  >
                    <option value="">（原模型）</option>
                    {models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <button className="sm" disabled={busy !== null} onClick={() => retryWith(j.id)}>
                    <RotateCcw size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                    {busy === j.id ? '处理中…' : '重试'}
                  </button>
                  <button className="sm danger" disabled={busy !== null} onClick={() => void act(j.id, () => novelApi.jobCancel(j.id), '任务已取消')}>
                    <XCircle size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                    取消
                  </button>
                </div>
              )}
              {(j.status === 'queued' || j.status === 'running') && (
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="sm danger" disabled={busy !== null} onClick={() => void act(j.id, () => novelApi.jobCancel(j.id), '任务已取消')}>
                    <XCircle size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                    取消
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
