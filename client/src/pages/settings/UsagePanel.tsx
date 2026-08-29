// v0.23.1（批次 E2）：自 SettingsPage.tsx 机械拆分（同 tab 互引组件同文件）
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UsageGroup, UsageTotal } from '@shared/types'
import { taskTypeLabels } from '@shared/types'
import { apiFetch } from '../../api'
import { useToast } from '../../components/Toast'

export function UsagePanel(): React.JSX.Element {
  const { toast } = useToast()
  const usage = useQuery<{ total: UsageTotal; groups: UsageGroup[] }>({
    queryKey: ['usage'],
    queryFn: async () => (await apiFetch('/settings/usage/stats')) as { total: UsageTotal; groups: UsageGroup[] }
  })
  // v0.10.0（批B/O5）：月度预算预警；v0.16.0：汇率（自动/手动）
  const app = useQuery<{
    costMonthlyBudget: number
    autoFixDebts: boolean
    monthlyCost: number
    cnyUsdRate: number
    cnyUsdRateSource: 'auto' | 'manual'
    cnyUsdRateAt: string
  }>({
    queryKey: ['app-settings'],
    queryFn: async () =>
      (await apiFetch('/settings/app')) as {
        costMonthlyBudget: number
        autoFixDebts: boolean
        monthlyCost: number
        cnyUsdRate: number
        cnyUsdRateSource: 'auto' | 'manual'
        cnyUsdRateAt: string
      }
  })
  const [budgetInput, setBudgetInput] = useState('')
  // v0.17.0（审查 A7）：busy 门控 + try/catch——此前失败直接 unhandledrejection，且可连点
  const [busy, setBusy] = useState<string | null>(null)
  const saveBudget = async (): Promise<void> => {
    if (busy) return
    const v = Number(budgetInput)
    if (Number.isNaN(v) || v < 0) {
      toast('error', '请输入合法的预算金额（元）')
      return
    }
    setBusy('budget')
    try {
      await apiFetch('/settings/app', { method: 'PATCH', body: JSON.stringify({ costMonthlyBudget: v }) })
      toast('ok', v > 0 ? `月度预算已设为 ¥${v}` : '月度预算预警已关闭')
      void app.refetch()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }
  const toggleAutoFix = async (on: boolean): Promise<void> => {
    if (busy) return
    setBusy('autofix')
    try {
      await apiFetch('/settings/app', { method: 'PATCH', body: JSON.stringify({ autoFixDebts: on }) })
      toast('ok', on ? '质量债自动修复已开启' : '质量债自动修复已关闭')
      void app.refetch()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const total = usage.data?.total
  const hitRate = total && total.inputTokens > 0 ? ((total.cacheHits / total.inputTokens) * 100).toFixed(1) : '—'

  // P12 D2：近 7 日缓存命中率
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const weekUsage = useQuery<{ total: UsageTotal }>({
    queryKey: ['usage-week'],
    queryFn: async () =>
      (await apiFetch(`/settings/usage/stats?from=${encodeURIComponent(weekAgo)}`)) as { total: UsageTotal }
  })
  const weekTotal = weekUsage.data?.total
  const weekHitRate = weekTotal && weekTotal.inputTokens > 0 ? ((weekTotal.cacheHits / weekTotal.inputTokens) * 100).toFixed(1) : '—'
  const budget = app.data?.costMonthlyBudget ?? 0
  const monthlyCost = app.data?.monthlyCost ?? 0
  const overBudget = budget > 0 && monthlyCost > budget
  // v0.16.0：汇率（自动获取/手动覆盖）
  const [rateInput, setRateInput] = useState('')
  const saveRate = async (): Promise<void> => {
    if (busy) return
    const v = Number(rateInput)
    if (Number.isNaN(v) || v <= 0) {
      toast('error', '请输入合法的汇率（USD→CNY，如 7.2）')
      return
    }
    setBusy('rate')
    try {
      await apiFetch('/settings/app', { method: 'PATCH', body: JSON.stringify({ cnyUsdRate: v }) })
      toast('ok', `汇率已手动设为 ${v}（后续自动获取不再覆盖）`)
      void app.refetch()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }
  const resetRate = async (): Promise<void> => {
    if (busy) return
    setBusy('rate')
    try {
      await apiFetch('/settings/app', { method: 'PATCH', body: JSON.stringify({ cnyUsdRateReset: true }) })
      toast('ok', '已恢复自动获取汇率')
      void app.refetch()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel col">
      <h2>成本仪表盘</h2>
      <div className="row flex-wrap">
        <div className="panel" style={{ background: 'var(--bg-card)', minWidth: 150 }}>
          <div className="muted">预估成本 (CNY)</div>
          <strong style={{ fontSize: 20 }}>{total ? total.cost.toFixed(4) : '—'}</strong>
        </div>
        <div className="panel" style={{ background: 'var(--bg-card)', minWidth: 150 }}>
          <div className="muted">调用次数</div>
          <strong style={{ fontSize: 20 }}>{total?.calls ?? '—'}</strong>
        </div>
        <div className="panel" style={{ background: 'var(--bg-card)', minWidth: 150 }}>
          <div className="muted">缓存命中率</div>
          <strong style={{ fontSize: 20 }}>{hitRate}%</strong>
        </div>
        <div className="panel" style={{ background: 'var(--bg-card)', minWidth: 150 }}>
          <div className="muted">近 7 日命中率</div>
          <strong style={{ fontSize: 20 }}>{weekHitRate}%</strong>
        </div>
      </div>

      {/* v0.10.0（批B/O5）：月度预算预警 */}
      <div className="row flex-wrap" style={{ marginTop: 12, gap: 12, alignItems: 'center' }}>
        <span className="muted t-small">月度预算（元）：</span>
        <input
          type="number"
          min={0}
          style={{ width: 110, fontSize: 13, padding: '4px 8px' }}
          placeholder={String(budget || '0（关闭）')}
          value={budgetInput}
          onChange={(e) => setBudgetInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveBudget()
          }}
        />
        <button className="sm" disabled={busy !== null} onClick={() => void saveBudget()}>{busy === 'budget' ? '保存中…' : '保存预算'}</button>
        {budget > 0 ? (
          <span className="t-small" style={{ color: overBudget ? 'var(--danger)' : 'var(--ok)' }}>
            本月已用 ¥{monthlyCost.toFixed(2)} / ¥{budget}
            {overBudget ? ' · 已超预算' : ''}
          </span>
        ) : (
          <span className="muted t-small">本月已用 ¥{monthlyCost.toFixed(2)}（未设预算）</span>
        )}
      </div>

      {/* v0.16.0：汇率（自动获取/手动覆盖）——成本显示人民币的基础 */}
      <div className="row flex-wrap" style={{ marginTop: 10, gap: 12, alignItems: 'center' }}>
        <span className="muted t-small">汇率 USD→CNY：</span>
        <strong style={{ fontSize: 14 }}>{app.data?.cnyUsdRate?.toFixed(4) ?? '—'}</strong>
        <span className="muted t-small">
          {app.data?.cnyUsdRateSource === 'manual'
            ? '手动设置（自动获取已暂停）'
            : `自动获取${app.data?.cnyUsdRateAt ? `（${new Date(app.data.cnyUsdRateAt).toLocaleString('zh-CN')}）` : '中…'}`}
        </span>
        <input
          type="number"
          min={0.5}
          max={50}
          step={0.01}
          style={{ width: 90, fontSize: 13, padding: '4px 8px' }}
          placeholder="手动汇率"
          value={rateInput}
          onChange={(e) => setRateInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveRate()
          }}
        />
        <button className="sm" disabled={busy !== null} onClick={() => void saveRate()}>{busy === 'rate' ? '保存中…' : '手动设置'}</button>
        {app.data?.cnyUsdRateSource === 'manual' && (
          <button className="sm" disabled={busy !== null} onClick={() => void resetRate()}>{busy === 'rate' ? '恢复中…' : '恢复自动'}</button>
        )}
        <span className="muted t-small" style={{ maxWidth: 360 }}>
          成本内部按美元计价，此处汇率仅用于人民币显示；启动时自动联网获取实时汇率，手动设置后不再被覆盖。
        </span>
      </div>

      {/* v0.10.0（批B/I2）：质量债自动修复开关（默认开启——低分章节将自动排队修复） */}
      <div className="row flex-wrap" style={{ marginTop: 10, gap: 12, alignItems: 'center' }}>
        <span className="muted t-small">质量债自动修复：</span>
        <button
          className="sm"
          disabled={busy !== null}
          onClick={() => void toggleAutoFix(!(app.data?.autoFixDebts ?? true))}
        >
          {busy === 'autofix' ? '切换中…' : app.data?.autoFixDebts === false ? '开启' : '关闭'}
        </button>
        <span className="muted t-small" style={{ maxWidth: 420 }}>
          整本生产后，评分低于 75 的章节将自动排队修复（每章最多 2 轮 + 同问题防重复）。可随时关闭；任务中心可查看/取消修复进度。
        </span>
      </div>
      {usage.data && usage.data.groups.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 6 }}>任务</th>
              <th style={{ textAlign: 'left', padding: 6 }}>模型</th>
              <th style={{ textAlign: 'right', padding: 6 }}>调用</th>
              <th style={{ textAlign: 'right', padding: 6 }}>输入</th>
              <th style={{ textAlign: 'right', padding: 6 }}>输出</th>
              <th style={{ textAlign: 'right', padding: 6 }}>成本</th>
              <th style={{ textAlign: 'right', padding: 6 }}>降级</th>
            </tr>
          </thead>
          <tbody>
            {usage.data.groups.map((g, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: 6 }}>{taskTypeLabels[g.taskType as keyof typeof taskTypeLabels] ?? g.taskType}</td>
                <td style={{ padding: 6 }} className="muted">
                  {g.provider}/{g.model}
                </td>
                <td style={{ padding: 6, textAlign: 'right' }}>{g.calls}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{g.inputTokens}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{g.outputTokens}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{g.cost.toFixed(4)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{g.degraded > 0 ? g.degraded : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* P20（C7/T3）：质量债 + 历史清理 */}
      <QualityDebtPanel />
    </div>
  )
}

function QualityDebtPanel(): React.JSX.Element {
  const { toast } = useToast()
  const debts = useQuery<{ debts: Array<{ novelId: number; title: string; highCount: number; mediumCount: number; resolvedCount: number }> }>({
    queryKey: ['quality-debts'],
    queryFn: async () => (await apiFetch('/settings/quality-debts')) as { debts: Array<{ novelId: number; title: string; highCount: number; mediumCount: number; resolvedCount: number }> }
  })
  const [cleanBusy, setCleanBusy] = useState(false)
  const runCleanup = async (): Promise<void> => {
    setCleanBusy(true)
    try {
      const r = (await apiFetch('/settings/cleanup', { method: 'POST' })) as { usageDeleted: number; jobsDeleted: number }
      toast('ok', `已清理：成本记录 ${r.usageDeleted} 条（>90 天）、失败任务 ${r.jobsDeleted} 条（>30 天）`)
      void debts.refetch()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setCleanBusy(false)
    }
  }
  return (
    <div style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 14 }}>质量债（未解决的审核问题）</h3>
        <button className="sm" disabled={cleanBusy} onClick={() => void runCleanup()}>
          {cleanBusy ? '清理中…' : '清理历史数据（>90 天成本 / >30 天失败任务）'}
        </button>
      </div>
      {debts.data && debts.data.debts.length === 0 && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>暂无质量债。审核发现 high/medium 问题时会自动登记，修复达标后自动销账。</p>}
      {debts.data && debts.data.debts.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 6 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 6 }}>小说</th>
              <th style={{ textAlign: 'right', padding: 6 }}>high</th>
              <th style={{ textAlign: 'right', padding: 6 }}>medium</th>
              <th style={{ textAlign: 'right', padding: 6 }}>已解决</th>
            </tr>
          </thead>
          <tbody>
            {debts.data.debts.map((d) => (
              <tr key={d.novelId} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: 6 }}>{d.title || `#${d.novelId}`}</td>
                <td style={{ padding: 6, textAlign: 'right', color: 'var(--danger)' }}>{d.highCount}</td>
                <td style={{ padding: 6, textAlign: 'right', color: 'var(--text-dim)' }}>{d.mediumCount}</td>
                <td style={{ padding: 6, textAlign: 'right', color: 'var(--ok)' }}>{d.resolvedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
