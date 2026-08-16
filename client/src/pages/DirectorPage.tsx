import { useEffect, useRef, useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useConfirm } from '../components/ConfirmDialog'
import { useNavigate, useParams } from 'react-router-dom'
import { automationApi } from '../api'
import type { DirectorStatus } from '../../../shared/src/types'

// v0.9.0（审查 M4）：DirectorStatus 移到 shared/types（本页扩展字段）
interface DirectorStatusEx extends DirectorStatus {
  mode?: string
  replanCount?: number
}

export function DirectorPage(): React.JSX.Element {
  const { novelId } = useParams()
  const navigate = useNavigate()
  const id = Number(novelId)
  const [status, setStatus] = useState<DirectorStatus | null>(null)
  const [chaptersPerVolume, setChaptersPerVolume] = useState(20)
  const [mode, setMode] = useState<'auto' | 'supervised'>('auto')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [production, setProduction] = useState<Record<string, unknown> | null>(null)
  // P14 B4：生产范围
  const [prodFrom, setProdFrom] = useState(0)
  const [prodTo, setProdTo] = useState(0)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusRef = useRef<string>('')
  const pollFailRef = useRef(0)
  // v0.9.0（审查 M3）：in-flight 保护——请求耗时 >3s 时跳过重叠 tick（此前无进行中标记会堆积并发请求）
  const pollInFlightRef = useRef(false)
  const [pollFailed, setPollFailed] = useState(false)

  const poll = (): void => {
    if (pollInFlightRef.current) return
    pollInFlightRef.current = true
    void automationApi.directorStatus(id).then((s) => {
      pollFailRef.current = 0
      setPollFailed(false)
      const st = s as unknown as DirectorStatusEx
      setStatus(st)
      // checkpoint 通知（浏览器 Notification）
      if (st.status && ['done', 'failed', 'cancelled', 'paused'].includes(st.status)) {
        const prev = statusRef.current
        if (prev !== st.displayStatus) {
          try {
            if (window.Notification && window.Notification.permission === 'granted') {
              new window.Notification('自动导演', { body: st.displayStatus ?? st.status })
            }
          } catch {
            /* ignore */
          }
        }
      }
      statusRef.current = st.displayStatus ?? st.status
    }).catch(() => {
      // P9 C8：连续失败 → 显示连接断开并暂停轮询
      pollFailRef.current += 1
      if (pollFailRef.current >= 3) {
        setPollFailed(true)
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      }
    }).finally(() => {
      pollInFlightRef.current = false
    })
    void automationApi.novelStatus(id).then((s) => setProduction(s as Record<string, unknown>)).catch(() => undefined)
  }

  useEffect(() => {
    // 请求通知权限
    try {
      if (window.Notification && window.Notification.permission === 'default') {
        void window.Notification.requestPermission()
      }
    } catch {
      /* ignore */
    }
    poll()
    pollingRef.current = setInterval(poll, 3000)
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await automationApi.directorRun(id, mode, Math.min(40, Math.max(5, Number(chaptersPerVolume) || 20)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const resume = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await automationApi.directorResume(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    // v0.17.0（审查 A15）：确认已由 themed ConfirmDialog（cancelWithConfirm）承担，删掉这里的内层原生 confirm
    setBusy(true)
    try {
      await automationApi.directorCancel(id)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // P13 F1：主题化确认（替代 window.confirm）
  const [confirmCancel, cancelDialog] = useConfirm()
  const cancelWithConfirm = (): void => {
    confirmCancel({
      title: '取消导演任务',
      message: '确定取消当前导演任务？已生成的章节会保留。',
      confirmText: '取消任务',
      danger: true,
      action: () => void cancel()
    })
  }

  const produce = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const from = prodFrom > 0 ? prodFrom : undefined
      const to = prodTo > 0 ? prodTo : undefined
      const r = await automationApi.produce(id, { from, to })
      if (r.pending === 0) setMsg('所选范围内没有待生成的章节')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const stages = ['inspiration', 'directions', 'framing', 'macro', 'world', 'characters', 'volumes', 'beats', 'chapters', 'refine', 'ready']
  const stageLabels: Record<string, string> = {
    inspiration: '灵感理解',
    directions: '方向生成',
    framing: '项目设定',
    macro: '宏观规划',
    world: '世界观',
    characters: '角色',
    volumes: '卷战略',
    beats: '节奏板',
    chapters: '章节清单',
    refine: '章节细化',
    ready: '可开写'
  }
  const progress = (status?.progress ?? {}) as Record<string, boolean>
  const activeStage = status?.stage ?? 'inspiration'

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1>自动导演</h1>
        <button className="sm" onClick={() => navigate(`/novels/${id}`)}>← 工作台</button>
      </div>

      <div className="panel mb-4">
        <h2 className="mb-3">启动自动导演</h2>
        <div className="row mb-3">
          <label>模式</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'auto' | 'supervised')}>
            <option value="auto">全自动（无人值守）</option>
            <option value="supervised">半自动（每阶段确认）</option>
          </select>
          <label>每卷章数</label>
          <input
            type="number"
            min={5}
            max={40}
            style={{ width: 80 }}
            value={chaptersPerVolume}
            onChange={(e) => setChaptersPerVolume(e.target.value === '' ? 0 : Number(e.target.value))}
          />
          {/* P27 1-1：启动前预览（预计调用/耗时/可中断） */}
          <div className="panel" style={{ marginTop: 8, padding: 10, fontSize: 12 }}>
            <div className="muted">
              启动前须知：导演将按 11 阶段依次调用模型（预计{' '}
              <strong style={{ color: 'var(--text)' }}>10-20 次调用</strong>，视书复杂度约{' '}
              <strong style={{ color: 'var(--text)' }}>5-20 分钟</strong>）
              · 可随时点「取消」停止（当前阶段完成后生效）· 全部过程可断点恢复
            </div>
          </div>
          <button className="primary" disabled={busy} onClick={() => void run()}>
            启动导演
          </button>
          <button disabled={busy} onClick={() => void resume()} title="从检查点继续">
            恢复/继续
          </button>
          <button className="danger" onClick={() => cancelWithConfirm()}>
            取消
          </button>
        </div>
        {msg && <div style={{ color: 'var(--ok)', fontSize: 13 }}>{msg}</div>}
        {error && <ErrorMsg error={error} />}
        {pollFailed && (
          <div className="row mb-2">
            <span className="muted" style={{ fontSize: 12, color: 'var(--warn)' }}>连接已断开，轮询已暂停</span>
            <button className="sm" onClick={() => { setPollFailed(false); pollFailRef.current = 0; pollingRef.current = setInterval(poll, 3000); poll() }}>
              恢复连接
            </button>
          </div>
        )}
      </div>

      {status && status.status !== 'not_started' && (
        <div className="panel mb-4">
          <div className="row justify-between">
            <h2>导演进度</h2>
            <span className="badge">{status.status}</span>
          </div>
          <div style={{ margin: '8px 0' }} className={status.status === 'failed' ? '' : ''}>
            <strong>{status.displayStatus}</strong>
          </div>
          {status.blockingReason && (
            <div style={{ color: 'var(--danger)', marginBottom: 8 }}>阻塞：{status.blockingReason}</div>
          )}
          {status.resumeAction && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>建议：{status.resumeAction}</div>}
          {['failed', 'blocked', 'waiting_recovery'].includes(status.status) && (
            <button className="primary" disabled={busy} onClick={() => void resume()}>
              {busy ? '恢复中…' : '▶ 从断点继续'}
            </button>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {stages.map((s) => (
              <div
                key={s}
                style={{
                  padding: '4px 12px',
                  borderRadius: 20,
                  fontSize: 12,
                  background: progress[s]
                    ? 'color-mix(in srgb, var(--ok) 15%, transparent)'
                    : s === activeStage
                      ? 'var(--accent-soft)'
                      : 'var(--bg-card)',
                  color: progress[s] ? 'var(--ok)' : s === activeStage ? 'var(--accent)' : 'var(--text-dim)',
                  border: `1px solid ${progress[s] ? 'var(--ok)' : s === activeStage ? 'var(--accent)' : 'var(--border)'}`
                }}
              >
                {progress[s] ? '✓ ' : ''}{stageLabels[s]}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="row justify-between flex-wrap gap-2">
          <h2>整本生产</h2>
          <div className="row flex-wrap">
            {/* P14 B4：范围授权（留空 = 全部待生成章节） */}
            <input
              type="number"
              min={1}
              style={{ width: 64 }}
              placeholder="起"
              value={prodFrom > 0 ? prodFrom : ''}
              onChange={(e) => setProdFrom(e.target.value === '' ? 0 : Number(e.target.value))}
            />
            <span className="muted">—</span>
            <input
              type="number"
              min={1}
              style={{ width: 64 }}
              placeholder="止"
              value={prodTo > 0 ? prodTo : ''}
              onChange={(e) => setProdTo(e.target.value === '' ? 0 : Number(e.target.value))}
            />
            <button className="primary" disabled={busy} onClick={() => void produce()}>
              批量生成（范围内）
            </button>
          </div>
        </div>
        {production && (
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <span className="badge">章节 {String(production.chapters)}</span>
            <span className="badge" style={{ color: 'var(--ok)', background: 'var(--ok-soft)' }}>
              已写 {String(production.written)}
            </span>
            {Number(production.failed) > 0 && (
              <span className="badge" style={{ color: 'var(--danger)', background: 'var(--danger-soft)' }}>
                失败 {String(production.failed)}
              </span>
            )}
            {Boolean(production.activeJob) && (
              <span className="badge">
                生产中：{String((production.activeJob as Record<string, unknown>).type)} {String((production.activeJob as Record<string, unknown>).progress)}%
              </span>
            )}
          </div>
        )}
        {(() => {
          const aj = production?.activeJob as Record<string, unknown> | undefined
          const detail = aj?.detail as Record<string, unknown> | undefined
          return aj && detail ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {String(detail.current ?? '')} - {String(detail.action ?? '')}
            </div>
          ) : null
        })()}
      </div>
      {cancelDialog}
    </div>
  )
}
