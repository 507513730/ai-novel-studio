import { useState, useEffect } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ModelRoute, Provider, UsageGroup, UsageTotal } from '@shared/types'
import { taskTypeLabels, taskTypes } from '@shared/types'
import { apiFetch } from '../api'
import { useToast } from '../components/Toast'
import { THEMES, applyTheme, getStoredTheme, type ThemeKey } from '../utils/theme'
import { SERIF_FONTS, UI_FONTS, applyFonts, getStoredFonts, DEFAULTS, type FontSettings } from '../utils/fonts'
import {
  SHORTCUT_ACTIONS,
  getStoredShortcuts,
  saveShortcut,
  resetShortcuts,
  eventToCombo,
  formatCombo,
  type ShortcutAction,
  type ShortcutBinding
} from '../utils/shortcuts'

function ProvidersPanel(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const providers = useQuery<{ providers: Provider[] }>({
    queryKey: ['providers'],
    queryFn: async () => (await apiFetch('/settings/providers')) as { providers: Provider[] }
  })

  const importOpencode = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/settings/import-opencode', {
        method: 'POST',
        body: JSON.stringify({ provider: 'opencode-go' })
      })
      toast('ok', 'OpenCode Go 网关已导入')
      await queryClient.invalidateQueries({ queryKey: ['providers'] })
      await queryClient.invalidateQueries({ queryKey: ['model-routes'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', `导入失败：${msg}`)
    } finally {
      setBusy(false)
    }
  }

  const saveProvider = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (name.trim() === '') throw new Error('供应商名称不能为空')
      await apiFetch('/settings/providers', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey })
      })
      setName('')
      setApiKey('')
      toast('ok', '供应商已保存')
      await queryClient.invalidateQueries({ queryKey: ['providers'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const updateKey = async (id: number, key: string): Promise<void> => {
    if (!key) return
    await apiFetch(`/settings/providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ apiKey: key })
    })
    toast('ok', 'API Key 已更新')
    await queryClient.invalidateQueries({ queryKey: ['providers'] })
  }

  return (
    <div className="panel col">
      <div className="row justify-between">
        <h2>供应商</h2>
        <button onClick={() => void importOpencode()} disabled={busy} title="从本机 ~/.local/share/opencode/auth.json 导入 OpenCode Go 网关 key（聚合 DeepSeek/GLM/GPT/Grok/Kimi）">
          导入 OpenCode Go 网关
        </button>
      </div>
      {providers.data?.providers.map((p) => (
        <div key={p.id} className="row justify-between">
          <div>
            <strong>{p.name}</strong>
            <div className="muted t-small">
              {p.baseUrl || '(使用 SDK 默认地址)'}
              {p.hasKey ? <span style={{ color: 'var(--ok)' }}> · 已配置 Key</span> : ' · 未配置 Key'}
            </div>
          </div>
          <div className="row">
            <input
              type="password"
              placeholder="新 Key（留空不改）"
              style={{ width: 200 }}
              onBlur={(e) =>
                void updateKey(p.id, e.target.value).catch((err) => {
                  const msg = err instanceof Error ? err.message : String(err)
                  setError(msg)
                  toast('error', `Key 保存失败：${msg}`)
                })
              }
            />
            <button
              className="primary"
              onClick={() =>
                void (async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    await apiFetch('/settings/test-connection', {
                      method: 'POST',
                      body: JSON.stringify({ providerId: p.id, taskType: 'prose' })
                    })
                    toast('ok', `${p.name} 连接成功`)
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err)
                    setError(msg)
                    toast('error', `${p.name} 连接失败：${msg}`)
                  } finally {
                    setBusy(false)
                  }
                })()
              }
              disabled={busy || !p.hasKey}
            >
              {busy ? '测试中…' : '测试连接'}
            </button>
          </div>
        </div>
      ))}

      <div className="panel" style={{ background: 'var(--bg-card)', borderStyle: 'dashed' }}>
        <div className="col">
          <div>
            <label>新增供应商</label>
            <div className="row">
              <input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
              <input
                placeholder="base URL（OpenAI 兼容）"
                className="flex-1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label>API Key</label>
            <input
              type="password"
              style={{ width: '100%' }}
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          {error && <ErrorMsg error={error} />}
          <button className="primary" disabled={busy} onClick={() => void saveProvider()}>
            保存供应商
          </button>
        </div>
      </div>
    </div>
  )
}

function ModelRoutesPanel(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const routes = useQuery<{ routes: ModelRoute[] }>({
    queryKey: ['model-routes'],
    queryFn: async () => (await apiFetch('/settings/model-routes')) as { routes: ModelRoute[] }
  })
  const providers = useQuery<{ providers: Provider[] }>({
    queryKey: ['providers'],
    queryFn: async () => (await apiFetch('/settings/providers')) as { providers: Provider[] }
  })

  const saveRoute = useMutation({
    mutationFn: async (route: ModelRoute) =>
      apiFetch(`/settings/model-routes/${route.taskType}`, {
        method: 'PUT',
        body: JSON.stringify({
          providerId: route.providerId,
          model: route.model,
          thinkingEnabled: route.thinkingEnabled,
          reasoningEffort: route.reasoningEffort,
          temperature: route.temperature,
          maxTokens: route.maxTokens,
          fallback: route.fallback
        })
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['model-routes'] }),
    onError: (err) => setError(err instanceof Error ? err.message : String(err))
  })

  const setDeepSeekPreset = (): void => {
    const providerId = providers.data?.providers.find((p) => p.name === 'DeepSeek')?.id
    if (!providerId) return
    const presets: Array<{
      task: (typeof taskTypes)[number]
      thinking: boolean
      effort: 'low' | 'high' | 'max'
      temp: number | null
    }> = [
      { task: 'prose', thinking: false, effort: 'high', temp: 1.0 },
      { task: 'planning', thinking: true, effort: 'high', temp: null },
      { task: 'review', thinking: true, effort: 'max', temp: null },
      { task: 'analysis', thinking: true, effort: 'max', temp: null },
      { task: 'summary', thinking: false, effort: 'high', temp: 0.3 },
      { task: 'extraction', thinking: false, effort: 'high', temp: 0.2 },
      { task: 'director', thinking: true, effort: 'high', temp: null },
      { task: 'chat', thinking: false, effort: 'high', temp: 0.7 },
      { task: 'embedding', thinking: false, effort: 'high', temp: null }
    ]
    for (const p of presets) {
      void saveRoute.mutateAsync({
        id: 0,
        taskType: p.task,
        providerId,
        providerName: 'DeepSeek',
        model: 'deepseek-v4-flash',
        thinkingEnabled: p.thinking,
        reasoningEffort: p.effort,
        temperature: p.temp,
        maxTokens: 8192,
        fallback: [
          { providerId, model: 'deepseek-v4-flash' },
          { providerId, model: 'deepseek-v4-pro' }
        ]
      })
    }
  }

  return (
    <div className="panel col">
      <div className="row justify-between">
        <h2>模型路由（任务级）</h2>
        <button onClick={setDeepSeekPreset} disabled={!providers.data?.providers.some((p) => p.name === 'DeepSeek')}>
          一键应用 DeepSeek 预设
        </button>
      </div>
      {error && <ErrorMsg error={error} />}
      {routes.data?.routes.map((r) => (
        <div key={r.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 160 }}>
            <strong>{taskTypeLabels[r.taskType]}</strong>
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              {r.taskType}
            </span>
          </div>
          <div className="row">
            <select
              value={r.providerId}
              onChange={(e) =>
                saveRoute.mutate({
                  ...r,
                  providerId: Number(e.target.value),
                  providerName:
                    providers.data?.providers.find((p) => p.id === Number(e.target.value))?.name ?? ''
                })
              }
            >
      {providers.isLoading && <p className="muted t-small">加载中…</p>}
      {providers.isError && (
        <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
          加载失败：{String(providers.error)}
          <button className="sm ml-2" onClick={() => void providers.refetch()}>重试</button>
        </div>
      )}
      {providers.data?.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              style={{ width: 180 }}
              value={drafts[`${r.taskType}:model`] ?? r.model}
              onChange={(e) => setDrafts((d) => ({ ...d, [`${r.taskType}:model`]: e.target.value }))}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== r.model) saveRoute.mutate({ ...r, model: v })
              }}
              title="模型名（失焦保存）"
            />
            <select
              value={r.thinkingEnabled ? r.reasoningEffort : 'off'}
              onChange={(e) => {
                const v = e.target.value
                saveRoute.mutate({
                  ...r,
                  thinkingEnabled: v !== 'off',
                  reasoningEffort: v === 'off' ? r.reasoningEffort : (v as 'low' | 'high' | 'max')
                })
              }}
            >
              <option value="off">thinking 关</option>
              <option value="low">thinking · low</option>
              <option value="high">thinking · high</option>
              <option value="max">thinking · max</option>
            </select>
            <input
              type="number"
              style={{ width: 72 }}
              value={drafts[`${r.taskType}:temp`] ?? (r.temperature ?? '')}
              placeholder="温度"
              onChange={(e) => setDrafts((d) => ({ ...d, [`${r.taskType}:temp`]: e.target.value }))}
              onBlur={(e) => {
                const raw = e.target.value
                const num = Number(raw)
                // P9 C1：NaN/越界拒绝并回滚草稿
                if (raw !== '' && (!Number.isFinite(num) || num < 0 || num > 2)) {
                  toast('error', '温度须为 0-2 之间的数字')
                  setDrafts((d) => {
                    const n = { ...d }
                    delete n[`${r.taskType}:temp`]
                    return n
                  })
                  return
                }
                const v = raw === '' ? null : num
                if (v !== r.temperature) saveRoute.mutate({ ...r, temperature: v })
              }}
              title="温度（失焦保存，0-2）"
            />
            <input
              type="number"
              style={{ width: 80 }}
              value={drafts[`${r.taskType}:max`] ?? r.maxTokens}
              onChange={(e) => setDrafts((d) => ({ ...d, [`${r.taskType}:max`]: e.target.value }))}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (v > 0 && v !== r.maxTokens) saveRoute.mutate({ ...r, maxTokens: v })
              }}
              title="max_tokens（失焦保存）"
            />
          </div>
        </div>
      ))}
      <p className="muted t-small">
        说明：thinking 开启时温度/penalty 无效（DeepSeek 官方约束）；fallback 链自动降级，降级调用会在成本仪表盘中标记。
      </p>
    </div>
  )
}

function UsagePanel(): React.JSX.Element {
  const usage = useQuery<{ total: UsageTotal; groups: UsageGroup[] }>({
    queryKey: ['usage'],
    queryFn: async () => (await apiFetch('/settings/usage/stats')) as { total: UsageTotal; groups: UsageGroup[] }
  })

  const total = usage.data?.total
  const hitRate = total && total.input_tokens > 0 ? ((total.cache_hit / total.input_tokens) * 100).toFixed(1) : '—'

  // P12 D2：近 7 日缓存命中率
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const weekUsage = useQuery<{ total: UsageTotal }>({
    queryKey: ['usage-week'],
    queryFn: async () =>
      (await apiFetch(`/settings/usage/stats?from=${encodeURIComponent(weekAgo)}`)) as { total: UsageTotal }
  })
  const weekTotal = weekUsage.data?.total
  const weekHitRate = weekTotal && weekTotal.input_tokens > 0 ? ((weekTotal.cache_hit / weekTotal.input_tokens) * 100).toFixed(1) : '—'

  return (
    <div className="panel col">
      <h2>成本仪表盘</h2>
      <div className="row flex-wrap">
        <div className="panel" style={{ background: 'var(--bg-card)', minWidth: 150 }}>
          <div className="muted">预估成本 (USD)</div>
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
                <td style={{ padding: 6 }}>{taskTypeLabels[g.task_type as keyof typeof taskTypeLabels] ?? g.task_type}</td>
                <td style={{ padding: 6 }} className="muted">
                  {g.provider}/{g.model}
                </td>
                <td style={{ padding: 6, textAlign: 'right' }}>{g.calls}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{g.input_tokens}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{g.output_tokens}</td>
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
  const debts = useQuery<{ debts: Array<{ novel_id: number; title: string; high_count: number; medium_count: number; resolved_count: number }> }>({
    queryKey: ['quality-debts'],
    queryFn: async () => (await apiFetch('/settings/quality-debts')) as { debts: Array<{ novel_id: number; title: string; high_count: number; medium_count: number; resolved_count: number }> }
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
              <tr key={d.novel_id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: 6 }}>{d.title || `#${d.novel_id}`}</td>
                <td style={{ padding: 6, textAlign: 'right', color: 'var(--danger)' }}>{d.high_count}</td>
                <td style={{ padding: 6, textAlign: 'right', color: 'var(--text-dim)' }}>{d.medium_count}</td>
                <td style={{ padding: 6, textAlign: 'right', color: 'var(--ok)' }}>{d.resolved_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function SettingsPage({ initialTab = 'providers' }: { initialTab?: 'providers' | 'routes' | 'usage' | 'appearance' | 'writing' }): React.JSX.Element {
  const [tab, setTab] = useState<'providers' | 'routes' | 'usage' | 'appearance' | 'writing'>(initialTab)
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row justify-between">
        <h1>设置</h1>
        <div className="pill-tabs">
          <button className={tab === 'providers' ? 'active' : ''} onClick={() => setTab('providers')}>
            供应商
          </button>
          <button className={tab === 'routes' ? 'active' : ''} onClick={() => setTab('routes')}>
            模型路由
          </button>
          <button className={tab === 'usage' ? 'active' : ''} onClick={() => setTab('usage')}>
            成本
          </button>
          <button className={tab === 'writing' ? 'active' : ''} onClick={() => setTab('writing')}>
            写作
          </button>
          <button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}>
            外观
          </button>
        </div>
      </div>
      {tab === 'providers' && <ProvidersPanel />}
      {tab === 'routes' && <ModelRoutesPanel />}
      {tab === 'usage' && <UsagePanel />}
      {tab === 'writing' && <WritingPanel />}
      {tab === 'appearance' && <AppearancePanel />}
    </div>
  )
}

// P19 ②⑤：写作偏好（语言 / 格式 / 写作模式）+ P22-B 正文排版
function WritingPanel(): React.JSX.Element {
  const { toast } = useToast()
  const [settings, setSettings] = useState<{ lang: string; format: string; writingMode: string } | null>(null)
  // P22-B：排版状态（同步 fonts 工具，即时生效）
  const [typeIndent, setTypeIndent] = useState(getStoredFonts().indent)
  const [typeLineHeight, setTypeLineHeight] = useState(getStoredFonts().lineHeight)
  const [typeFontSize, setTypeFontSize] = useState(getStoredFonts().fontSize)
  const [typeMaxWidth, setTypeMaxWidth] = useState(getStoredFonts().maxWidth)
  const patchType = (patch: Partial<FontSettings>): void => {
    applyFonts({ ...getStoredFonts(), ...patch })
  }
  useEffect(() => {
    let alive = true
    void fetch('/api/settings/writing')
      .then((r) => r.json())
      .then((d) => {
        if (alive) setSettings(d)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  const patch = async (patch: Record<string, string>): Promise<void> => {
    try {
      await fetch('/api/settings/writing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
      toast('ok', '已保存，将影响后续生成')
    } catch {
      toast('error', '保存失败')
    }
  }
  const Option = ({ label, desc, current, onPick }: { label: string; desc: string; current: boolean; onPick: () => void }): React.JSX.Element => (
    <button
      onClick={onPick}
      style={{
        padding: '10px 14px',
        borderRadius: 'var(--radius-m)',
        background: 'var(--bg-card)',
        border: `1px solid ${current ? 'var(--accent)' : 'var(--border)'}`,
        cursor: 'pointer',
        textAlign: 'left'
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--text)' }}>{label} {current ? '✓' : ''}</div>
      <div className="muted t-small">{desc}</div>
    </button>
  )
  if (!settings) return <div className="panel">加载中…</div>
  return (
    <div className="panel col">
      <h2>写作偏好</h2>
      <p className="muted t-small">
        这些规则会注入每次生成的写作要求（改设置后生成缓存自动失效）。仅在不等于默认值时注入，不浪费 token。
      </p>
      <h3 style={{ fontSize: 13, margin: '8px 0 4px' }}>语言</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        <Option label="简体中文" desc="默认" current={settings.lang === 'simplified'} onPick={() => void patch({ lang: 'simplified' })} />
        <Option label="繁体中文" desc="全文统一繁体" current={settings.lang === 'traditional'} onPick={() => void patch({ lang: 'traditional' })} />
      </div>
      <h3 style={{ fontSize: 13, margin: '8px 0 4px' }}>格式</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        <Option label="自然分段" desc="默认，一段一意" current={settings.format === 'paragraph'} onPick={() => void patch({ format: 'paragraph' })} />
        <Option label="长句连续" desc="复合句为主，段落连续" current={settings.format === 'longSentence'} onPick={() => void patch({ format: 'longSentence' })} />
      </div>
      <h3 style={{ fontSize: 13, margin: '8px 0 4px' }}>写作模式</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        <Option label="聚焦" desc="严格围绕章节目标，不展开支线" current={settings.writingMode === 'focused'} onPick={() => void patch({ writingMode: 'focused' })} />
        <Option label="标准" desc="默认，适度铺陈" current={settings.writingMode === 'standard'} onPick={() => void patch({ writingMode: 'standard' })} />
        <Option label="自由" desc="允许支线发散，结尾回落主线" current={settings.writingMode === 'free'} onPick={() => void patch({ writingMode: 'free' })} />
      </div>

      {/* P22-B：正文排版（编辑器即时生效） */}
      <h3 style={{ fontSize: 13, margin: '8px 0 4px' }}>正文排版</h3>
      <div className="col gap-2">
        <label className="row" style={{ fontSize: 12, gap: 8 }}>
          <input type="checkbox" checked={typeIndent} onChange={(e) => { setTypeIndent(e.target.checked); patchType({ indent: e.target.checked }) }} />
          首行缩进 2 字符（每行缩进；段落=一行时视觉正确）
        </label>
        <div className="row" style={{ fontSize: 12, gap: 8 }}>
          <span style={{ minWidth: 48 }}>行距</span>
          <input
            type="range" min={1.5} max={2.2} step={0.05}
            value={typeLineHeight}
            onChange={(e) => { const v = Number(e.target.value); setTypeLineHeight(v); patchType({ lineHeight: v }) }}
          />
          <span className="muted">{typeLineHeight.toFixed(2)}</span>
        </div>
        <div className="row" style={{ fontSize: 12, gap: 8 }}>
          <span style={{ minWidth: 48 }}>字号</span>
          <input
            type="range" min={14} max={18} step={1}
            value={typeFontSize}
            onChange={(e) => { const v = Number(e.target.value); setTypeFontSize(v); patchType({ fontSize: v }) }}
          />
          <span className="muted">{typeFontSize}px</span>
        </div>
        <label className="row" style={{ fontSize: 12, gap: 8 }}>
          <input type="checkbox" checked={typeMaxWidth} onChange={(e) => { setTypeMaxWidth(e.target.checked); patchType({ maxWidth: e.target.checked }) }} />
          阅读宽度（720px 居中，长行更易读）
        </label>
      </div>
    </div>
  )
}

// P13 F0：外观设置（多主题选择器）
// P22-A：字体选择（正文字体 + 编辑器字体）
function FontPanel(): React.JSX.Element {
  const { toast } = useToast()
  const [settings, setSettings] = useState<FontSettings>(getStoredFonts())
  const update = (patch: Partial<FontSettings>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    applyFonts(next)
  }
  return (
    <div className="col" style={{ gap: 10, marginTop: 6 }}>
      <div>
        <div style={{ fontSize: 13, marginBottom: 4 }}>正文字体</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {SERIF_FONTS.map((f) => (
            <button
              key={f.key}
              onClick={() => update({ prose: f.key })}
              title={f.desc}
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--radius-m)',
                background: 'var(--bg-card)',
                border: `1px solid ${settings.prose === f.key ? 'var(--accent)' : 'var(--border)'}`,
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <div style={{ fontSize: 15, color: 'var(--text)', fontFamily: f.stack }}>
                {f.label} {settings.prose === f.key ? '✓' : ''}
              </div>
              <div className="muted t-small">{f.desc}</div>
            </button>
          ))}
        </div>
        <div
          style={{
            marginTop: 8,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'var(--bg-panel)',
            fontFamily: SERIF_FONTS.find((f) => f.key === settings.prose)?.stack,
            fontSize: 15,
            lineHeight: 1.8,
            color: 'var(--text-dim)'
          }}
        >
          仿佛面前展开了全新的世界。他推开那扇尘封的门，光线涌了进来——预览文字，用于感受字体观感。
        </div>
      </div>
      <div className="row gap-2">
        <span className="t-small">编辑器字体：</span>
        <select
          value={settings.editor}
          onChange={(e) => update({ editor: e.target.value as 'prose' | 'mono' })}
        >
          <option value="prose">跟随正文</option>
          <option value="mono">等宽（JetBrains Mono）</option>
        </select>
        <span className="t-small">界面字体：</span>
        <select value={settings.ui} onChange={(e) => update({ ui: e.target.value })}>
          {UI_FONTS.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <button className="sm" onClick={() => { update({ ...DEFAULTS }); toast('ok', '已恢复默认字体') }}>恢复默认</button>
      </div>
    </div>
  )
}

// P27 1-9：快捷键自定义（录制 + 冲突检测 + 恢复默认）
function ShortcutPanel(): React.JSX.Element {
  const { toast } = useToast()
  const [bindings, setBindings] = useState<Record<string, string>>(getStoredShortcuts())
  const [recording, setRecording] = useState<string | null>(null)

  const startRecord = (action: string): void => {
    setRecording(action)
    toast('info', '请按下新的组合键（Esc 取消）')
  }

  const onKey = (e: KeyboardEvent): void => {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecording(null)
      return
    }
    const combo = eventToCombo(e)
    if (!combo) return
    // 冲突检测
    const conflict = Object.entries(bindings).find(([a, b]) => b === combo && a !== recording)
    if (conflict) {
      toast('error', `与「${SHORTCUT_ACTIONS[conflict[0] as ShortcutAction]?.label ?? conflict[0]}」冲突`)
      setRecording(null)
      return
    }
    saveShortcut(recording as ShortcutAction, combo)
    setBindings(getStoredShortcuts())
    setRecording(null)
    toast('ok', `已设置：${formatCombo(combo)}`)
  }

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, bindings])

  return (
    <div className="col gap-2" style={{ marginBottom: 8 }}>
      <p className="muted t-small">点击「录制」后按下组合键即可自定义。命令面板默认 Ctrl+K（搜小说/跳页面）。</p>
      <div className="col gap-1">
        {(Object.entries(SHORTCUT_ACTIONS) as Array<[ShortcutAction, ShortcutBinding]>).map(([action, meta]) => (
          <div key={action} className="row justify-between" style={{ padding: '4px 0' }}>
            <span className="t-small">{meta.label}</span>
            <div className="row gap-2">
              <kbd style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontSize: 12, minWidth: 90, textAlign: 'center' }}>
                {recording === action ? '…按下组合键' : formatCombo(bindings[action] ?? meta.combo)}
              </kbd>
              <button className="sm" onClick={() => startRecord(action)} disabled={recording !== null && recording !== action}>
                录制
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="sm" onClick={() => { resetShortcuts(); setBindings(getStoredShortcuts()); toast('ok', '已恢复默认快捷键') }}>
        恢复默认
      </button>
    </div>
  )
}

function AppearancePanel(): React.JSX.Element {
  const { toast } = useToast()
  const [current, setCurrent] = useState<ThemeKey>(getStoredTheme())
  return (
    <div className="panel col">
      {/* P27 1-9：快捷键自定义 */}
      <h2>快捷键</h2>
      <ShortcutPanel />
      <h2>主题</h2>
      <p className="muted t-small">
        选择界面配色（灵感来自 FeelFish 色板与参考项目浅色风格）。主题即时生效并记住选择。
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
        {THEMES.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              applyTheme(t.key)
              setCurrent(t.key)
            }}
            style={{
              padding: 12,
              borderRadius: 'var(--radius-m)',
              background: 'var(--bg-card)',
              border: `1px solid ${current === t.key ? 'var(--accent)' : 'var(--border)'}`,
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 6, background: t.preview[0], border: '1px solid rgba(255,255,255,0.15)' }} />
              <span style={{ width: 28, height: 28, borderRadius: 6, background: t.preview[1] }} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>{t.label}</div>
            <div className="muted t-small">{current === t.key ? '✓ 当前' : t.key}</div>
          </button>
        ))}
      </div>

      {/* P22-A：字体设置 */}
      <h2 className="mt-2">字体</h2>
      <p className="muted t-small">
        正文字体作用于写作编辑器与预览；界面字体保持系统栈。打包字体为开源 OFL 协议（霞鹜文楷/思源宋体/思源黑体），离线可用。
      </p>
      <FontPanel />

      {/* P16 P0：数据管理 */}
      <h2 className="mt-2">数据与卸载</h2>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button onClick={() => void window.novelStudio?.openDataDir()}>📂 打开数据目录</button>
        {/* P18 B：备份导出/恢复 */}
        <button
          onClick={() =>
            void window.novelStudio?.exportBackup().then((r) => {
              if (!r.ok) {
                if (!r.canceled) toast('error', r.error ?? '导出失败')
                return
              }
              toast('ok', `已导出备份（${r.copied ?? 0} 个文件）`)
            })
          }
        >
          📦 导出备份
        </button>
        <button
          onClick={() => {
            if (window.confirm('从备份恢复将覆盖当前全部数据（小说/设定/Key），且需要重启应用。继续？')) {
              void window.novelStudio?.restoreBackup().then((r) => {
                if (!r.ok) {
                  if (!r.canceled) toast('error', r.error ?? '恢复失败')
                  return
                }
                toast('ok', '已恢复，正在重启…')
                setTimeout(() => window.location.reload(), 1200)
              })
            }
          }}
        >
          ♻️ 从备份恢复
        </button>
        <button
          className="danger"
          onClick={() => {
            if (window.confirm('清除全部数据（API Key、小说、设定、配置）？此操作不可恢复，应用将退出。')) {
              void window.novelStudio?.wipeData()
            }
          }}
        >
          🗑 清除全部数据
        </button>
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
        数据存于用户目录（AppData\\Roaming\\ai-novel-studio），与安装目录分离。卸载应用：Windows 设置 &gt; 应用 &gt; AI-Novel-Studio &gt; 卸载（会同时清除数据）；
        便携版 = 删除文件夹与旁 data/ 目录。
      </p>
    </div>
  )
}
