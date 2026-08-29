import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ListChecks, RotateCcw, XCircle, RefreshCw, Trash2, Inbox, History } from 'lucide-react'
import { novelApi, automationApi } from '../api'
import { useActionRun } from '../hooks/useActionRun'
import { ErrorMsg } from '../components/ErrorMsg'
import { EmptyState } from '../components/EmptyState'
import { Loading } from '../components/Loading'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

// v0.20.0（NovelClaw 学习组）：运行轨迹——job.result_json.trace 时间线（生产/修复任务的阶段轨迹）
interface JobTraceEntry {
  at: string
  chapter: string
  action: string
  done: number
  total: number
}

function JobTrace({ result }: { result: unknown }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const r = (result ?? {}) as { trace?: JobTraceEntry[]; current?: string; action?: string; done?: number; total?: number; failed?: number }
  const trace = r.trace ?? []
  if (trace.length === 0 && !r.current) return null
  return (
    <div style={{ marginTop: 8 }}>
      <button className="sm" onClick={() => setOpen((v) => !v)}>
        <History size={12} className="icon-gap" />
        {open ? '收起轨迹' : `运行轨迹（${trace.length} 步）`}
        {r.current ? ` · 当前：${r.current}${r.action ? ` — ${r.action}` : ''}` : ''}
      </button>
      {open && (
        <div
          style={{
            marginTop: 8,
            maxHeight: 220,
            overflow: 'auto',
            fontSize: 12,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-m)',
            background: 'var(--bg-input)',
            padding: '8px 10px'
          }}
        >
          <div className="muted" style={{ marginBottom: 6 }}>
            完成 {r.done ?? 0}/{r.total ?? 0}
            {typeof r.failed === 'number' && r.failed > 0 ? ` · 失败 ${r.failed}` : ''}
          </div>
          {/* v0.21.0（审查 P3 LOW）：trace 渲染切片前 100 条——防超长轨迹（整本生产可达数百步）堆出百行 DOM */}
          {trace.slice(0, 100).map((t, i) => (
            <div key={i} className="row" style={{ gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
              <span className="muted" style={{ minWidth: 52, fontVariantNumeric: 'tabular-nums' }}>{t.at}</span>
              <span className="muted" style={{ minWidth: 40 }}>{t.done}/{t.total}</span>
              <span style={{ color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {t.chapter || '—'}
              </span>
              <span className="muted" style={{ flexShrink: 0 }}>{t.action}</span>
            </div>
          ))}
          {trace.length > 100 && (
            <div className="muted" style={{ marginTop: 4 }}>…仅显示前 100 条（共 {trace.length} 条）</div>
          )}
          {trace.length === 0 && <span className="muted">任务已结束（无阶段轨迹）</span>}
        </div>
      )}
    </div>
  )
}


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
  const [error, setError] = useState<string | null>(null)
  // P13 G1：重试换模型
  const [retryModel, setRetryModel] = useState<Record<number, string>>({})
  // v0.22.0（审查 ALOW）：themed confirm 统一
  const [confirmFn, confirmDialog] = useConfirm()

  const routes = useQuery({
    queryKey: ['model-routes'],
    queryFn: novelApi.modelRoutes
  })
  const models = [...new Set((routes.data?.routes ?? []).map((r) => r.model))]

  const jobs = useQuery({
    // v0.23.1（批次 E5）：统一共享 ['jobs'] 缓存（与 AppLayout/列表页/跟随页同源）
    queryKey: ['jobs'],
    queryFn: novelApi.jobs,
    // v0.17.0（审查 C38）：页面不可见时暂停轮询——后台标签不再每 4s 空转拉取
    refetchInterval: () => (document.visibilityState === 'visible' ? 4000 : false)
  })

  // v0.23.1（批次 E3）：共享 useActionRun（ref 守卫防同帧双击；busy 键由 number 改 string）
  const { busy, run } = useActionRun({
    onStart: () => setError(null),
    onError: (msg) => {
      setError(msg)
      toast('error', msg)
    },
    onDone: () => queryClient.invalidateQueries({ queryKey: ['jobs'] })
  })

  const act = (id: number, fn: () => Promise<{ ok: boolean }>, doneMsg: string): Promise<void> =>
    run(String(id), async () => {
      await fn()
      toast('ok', doneMsg)
    })

  const retryWith = (id: number): void => {
    void act(id, () => novelApi.jobRetry(id, retryModel[id] || undefined), retryModel[id] ? `已用 ${retryModel[id]} 重新排队` : '任务已重新排队')
  }

  // P13 G3：导演任务"从断点继续"（复用 directorResume）
  const resumeDirector = (novelId: number): void => {
    void run(String(-novelId), async () => {
      await automationApi.directorResume(novelId)
      toast('ok', '已从断点继续导演任务')
    })
  }

  const list = jobs.data?.jobs ?? []

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="row">
          <ListChecks size={20} />
          <h1 className="ml-2">任务中心</h1>
        </div>
        <button className="sm" onClick={() => void jobs.refetch()}><RefreshCw size={13} className="icon-gap" />刷新</button>
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
            confirmFn({ title: '清理已完成', message: `将删除 ${done} 条已完成任务记录（不影响正文/文档）。继续？`, confirmText: '清理', danger: true, action: () => {
              void run('-1', async () => {
                const r = await automationApi.jobsClearDone()
                toast('ok', `已清理 ${r.deleted} 条完成记录`)
              })
            } })
          }}
        >
          <Trash2 size={13} className="icon-gap" />清理已完成
        </button>
      </div>
      {error && <ErrorMsg error={error} />}
      {jobs.isLoading && <Loading lines={4} />}
      {!jobs.isLoading && list.length === 0 && <EmptyState icon={Inbox} title="暂无任务" desc="启动自动导演后，任务会出现在这里。" />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map((j) => {
          const meta = STATUS_META[j.status] ?? { color: 'var(--text-dim)', label: j.status }
          const novelId = Number(j.payload.novelId ?? 0)
          return (
            <div key={j.id} className="panel" style={{ background: 'var(--bg-card)' }}>
              <div className="row justify-between flex-wrap gap-2">
                <div className="row">
                  <span
                    style={{ width: 8, height: 8, borderRadius: 4, background: meta.color, display: 'inline-block' }}
                  />
                  <strong>
                    #{j.id}{' '}
                    {
                      // v0.23.1（批次 D）：新 job 类型中文名（此前非 director 类型直显英文标识）
                      ({ director: '自动导演', production: '整本生产', 'debt-fix': '质量债修复', 'refine-range': '批量细化', 'solution-chapter': '方案生产' } as Record<string, string>)[j.type] ?? j.type
                    }
                  </strong>
                  <span className="badge" style={{ background: `${meta.color}22`, color: meta.color }}>
                    {meta.label}
                  </span>
                  {novelId > 0 && (
                    <button className="sm" onClick={() => navigate(`/novels/${novelId}/director`)}>
                      去导演页
                    </button>
                  )}
                </div>
                <span className="muted t-small">{j.createdAt}</span>
              </div>
              {j.status === 'running' && typeof j.progress === 'number' && j.progress > 0 && (
                <div className="progress" style={{ marginTop: 8 }}>
                  <div style={{ width: `${Math.min(100, j.progress * 100)}%` }} />
                </div>
              )}
              {j.error && (
                // v0.26.0（审查 P1-4）：长错误文案单行截断 + 悬浮看全文（此前 safeStorage 等长报错裸奔撑爆行）
                <div className="muted ellipsis" title={j.error} style={{ fontSize: 12, marginTop: 8, color: 'var(--danger)' }}>
                  失败原因：{j.error}
                </div>
              )}
              {(j.status === 'failed' || j.status === 'cancelled') && (
                <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  {j.type === 'director' && novelId > 0 && (
                    <button className="sm primary" disabled={busy !== null} onClick={() => resumeDirector(novelId)}>
                      {busy === String(-novelId) ? '继续中…' : '▶ 从断点继续'}
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
                    <RotateCcw size={12} className="icon-gap" />
                    {busy === String(j.id) ? '处理中…' : '重试'}
                  </button>
                  <button className="sm danger" disabled={busy !== null} onClick={() => void act(j.id, () => novelApi.jobCancel(j.id), '任务已取消')}>
                    <XCircle size={12} className="icon-gap" />
                    取消
                  </button>
                </div>
              )}
              {(j.status === 'queued' || j.status === 'running') && (
                <div className="row mt-2">
                  <button className="sm danger" disabled={busy !== null} onClick={() => void act(j.id, () => novelApi.jobCancel(j.id), '任务已取消')}>
                    <XCircle size={12} className="icon-gap" />
                    取消
                  </button>
                </div>
              )}
              {/* v0.20.0：运行轨迹时间线（生产/修复任务的阶段轨迹） */}
              <JobTrace result={j.result} />
            </div>
          )
        })}
      </div>
      {confirmDialog}
    </div>
  )
}
