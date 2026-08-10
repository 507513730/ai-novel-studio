import { useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ModelRoute, Provider, UsageGroup, UsageTotal } from '@shared/types'
import { taskTypeLabels, taskTypes } from '@shared/types'
import { apiFetch } from '../api'
import { useToast } from '../components/Toast'
import { THEMES, applyTheme, getStoredTheme, type ThemeKey } from '../utils/theme'

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
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>供应商</h2>
        <button onClick={() => void importOpencode()} disabled={busy} title="从本机 ~/.local/share/opencode/auth.json 导入 OpenCode Go 网关 key（聚合 DeepSeek/GLM/GPT/Grok/Kimi）">
          导入 OpenCode Go 网关
        </button>
      </div>
      {providers.data?.providers.map((p) => (
        <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong>{p.name}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
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
                style={{ flex: 1 }}
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
      <div className="row" style={{ justifyContent: 'space-between' }}>
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
      {providers.isLoading && <p className="muted" style={{ fontSize: 12 }}>加载中…</p>}
      {providers.isError && (
        <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
          加载失败：{String(providers.error)}
          <button className="sm" style={{ marginLeft: 8 }} onClick={() => void providers.refetch()}>重试</button>
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
      <p className="muted" style={{ fontSize: 12 }}>
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
      <div className="row" style={{ flexWrap: 'wrap' }}>
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
    </div>
  )
}

export function SettingsPage({ initialTab = 'providers' }: { initialTab?: 'providers' | 'routes' | 'usage' | 'appearance' }): React.JSX.Element {
  const [tab, setTab] = useState<'providers' | 'routes' | 'usage' | 'appearance'>(initialTab)
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
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
          <button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}>
            外观
          </button>
        </div>
      </div>
      {tab === 'providers' && <ProvidersPanel />}
      {tab === 'routes' && <ModelRoutesPanel />}
      {tab === 'usage' && <UsagePanel />}
      {tab === 'appearance' && <AppearancePanel />}
    </div>
  )
}

// P13 F0：外观设置（多主题选择器）
function AppearancePanel(): React.JSX.Element {
  const { toast } = useToast()
  const [current, setCurrent] = useState<ThemeKey>(getStoredTheme())
  return (
    <div className="panel col">
      <h2>主题</h2>
      <p className="muted" style={{ fontSize: 12 }}>
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
            <div className="muted" style={{ fontSize: 11 }}>{current === t.key ? '✓ 当前' : t.key}</div>
          </button>
        ))}
      </div>

      {/* P16 P0：数据管理 */}
      <h2 style={{ marginTop: 8 }}>数据与卸载</h2>
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
