// v0.23.1（批次 E2）：自 SettingsPage.tsx 机械拆分（同 tab 互引组件同文件）
import { useState } from 'react'
import { ErrorMsg } from '../../components/ErrorMsg'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ModelRoute, Provider } from '@shared/types'
import { taskTypeLabels, taskTypes } from '@shared/types'
import { apiFetch } from '../../api'
import { useToast } from '../../components/Toast'

export function ModelRoutesPanel(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // v0.17.0（审查 A8）：一键预设 busy 门控
  const [presetBusy, setPresetBusy] = useState(false)

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

  const setDeepSeekPreset = async (): Promise<void> => {
    const providerId = providers.data?.providers.find((p) => p.name === 'DeepSeek')?.id
    if (!providerId) return
    // v0.17.0（审查 A8）：busy 门控 + 串行 await——此前 9 个 mutateAsync 并发发出，无顺序且可重复点击
    setPresetBusy(true)
    setError(null)
    try {
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
        await saveRoute.mutateAsync({
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
      toast('ok', 'DeepSeek 预设已应用到全部 9 个任务')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPresetBusy(false)
    }
  }

  return (
    <div className="panel col">
      <div className="row justify-between">
        <h2>模型路由（任务级）</h2>
        {/* v0.17.0（审查 A8）：busy 门控——串行应用期间禁点 */}
        <button onClick={() => void setDeepSeekPreset()} disabled={presetBusy || !providers.data?.providers.some((p) => p.name === 'DeepSeek')}>
          {presetBusy ? '应用中…' : '一键应用 DeepSeek 预设'}
        </button>
      </div>
      {error && <ErrorMsg error={error} />}
      {routes.data?.routes.map((r) => (
        <div key={r.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 160 }}>
            <strong>{taskTypeLabels[r.taskType]}</strong>
            {/* v0.21.0（审查 M10 残）：预留路由标注（未消费的死配置——禁编辑防误导） */}
            {r.reserved && (
              <span className="badge warn" style={{ marginLeft: 6 }} title="预留路由（当前功能未消费，仅供后续扩展）">预留</span>
            )}
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              {r.taskType}
            </span>
          </div>
          <div className="row">
            {/* v0.17.0（审查 H9）：加载/错误态移出 <select>（无效 HTML——此前被浏览器丢弃不可见） */}
            {providers.isLoading && <p className="muted t-small">加载中…</p>}
            {providers.isError && (
              <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
                加载失败：{String(providers.error)}
                <button className="sm ml-2" onClick={() => void providers.refetch()}>重试</button>
              </div>
            )}
            {/* v0.17.0（审查 A6）：isPending 门控——保存期间禁改，防连发覆盖 */}
            <select
              value={r.providerId}
              disabled={saveRoute.isPending || r.reserved}
              onChange={(e) =>
                saveRoute.mutate({
                  ...r,
                  providerId: Number(e.target.value),
                  providerName:
                    providers.data?.providers.find((p) => p.id === Number(e.target.value))?.name ?? ''
                })
              }
            >
              {providers.data?.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              style={{ width: 180 }}
              disabled={saveRoute.isPending}
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
              disabled={saveRoute.isPending}
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
              disabled={saveRoute.isPending}
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
              disabled={saveRoute.isPending}
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
