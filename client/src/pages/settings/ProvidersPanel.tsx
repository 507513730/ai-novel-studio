// v0.23.1（批次 E2）：自 SettingsPage.tsx 机械拆分（同 tab 互引组件同文件）
import { useState } from 'react'
import { ErrorMsg } from '../../components/ErrorMsg'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Provider } from '@shared/types'
import { apiFetch } from '../../api'
import { useToast } from '../../components/toastGlobal'

export function ProvidersPanel(): React.JSX.Element {
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
