import { useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { apiFetch } from '../api'

interface OnboardingProps {
  onDone: () => void
}

export function Onboarding({ onDone }: OnboardingProps): React.JSX.Element {
  const [step, setStep] = useState(1)
  const [apiKey, setApiKey] = useState('')
  const [providerChoice, setProviderChoice] = useState('deepseek')
  const [customUrl, setCustomUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const baseUrl =
    providerChoice === 'custom'
      ? customUrl.trim() || 'https://api.deepseek.com'
      : providerChoice === 'siliconflow'
        ? 'https://api.siliconflow.cn/v1'
        : providerChoice === 'openai'
          ? 'https://api.openai.com/v1'
          : 'https://api.deepseek.com'

  const saveAndTest = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // P9 D10：自定义 URL 非空时必须合法
      if (providerChoice === 'custom' && customUrl.trim()) {
        try {
          new URL(customUrl.trim())
        } catch {
          throw new Error('自定义地址不是合法的 URL（示例：https://your-provider/v1）')
        }
      }
      let providerId: number | null = null
      if (providerChoice === 'opencode-go') {
        // 一键：从本机 ~/.local/share/opencode/auth.json 导入 OpenCode Go 网关 key
        const imported = (await apiFetch('/settings/import-opencode', {
          method: 'POST',
          body: JSON.stringify({ provider: 'opencode-go' })
        })) as { id: number; name: string }
        providerId = imported.id
      } else {
        const list = (await apiFetch('/settings/providers')) as {
          providers: Array<{ id: number; name: string }>
        }
        if (list.providers.length > 0) {
          providerId = list.providers[0].id
          // P9 A5：空 key 不覆盖已有凭证
          if (apiKey.trim()) {
            await apiFetch(`/settings/providers/${providerId}`, {
              method: 'PATCH',
              body: JSON.stringify({ apiKey })
            })
          }
        } else {
          if (!apiKey.trim()) throw new Error('请先输入 API Key')
          const created = (await apiFetch('/settings/providers', {
            method: 'POST',
            body: JSON.stringify({ name: 'DeepSeek', baseUrl, apiKey })
          })) as { id: number }
          providerId = created.id
        }
      }
      const test = (await apiFetch('/settings/test-connection', {
        method: 'POST',
        body: JSON.stringify({ providerId, taskType: 'prose' })
      })) as { ok: boolean; reply: string }
      if (!test.ok) throw new Error('连接测试失败')
      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '80px auto', padding: 24 }} className="panel">
      <h1 style={{ marginBottom: 4 }}>欢迎使用 AI 小说创作工作台</h1>
      <p className="muted">三步完成配置，开始你的第一本书</p>

      {step === 1 && (
        <div className="col" style={{ marginTop: 20 }}>
          <div>
            <label>步骤 1 / 3：选择模型供应商</label>
            <select value={providerChoice} onChange={(e) => setProviderChoice(e.target.value)}>
              <option value="opencode-go">OpenCode Go 网关（推荐：一键聚合 DeepSeek/GLM/GPT/Grok/Kimi）</option>
              <option value="deepseek">DeepSeek（官方直连）</option>
              <option value="siliconflow">SiliconFlow（硅基流动）</option>
              <option value="openai">OpenAI</option>
              <option value="custom">自定义（OpenAI 兼容）</option>
            </select>
            {providerChoice === 'custom' && (
              <input
                style={{ marginTop: 8, width: '100%' }}
                placeholder="https://your-provider/v1"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
              />
            )}
            {providerChoice === 'opencode-go' && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                自动从本机 ~/.local/share/opencode/auth.json 导入订阅凭证，无需手动输入 Key
              </p>
            )}
          </div>
          {error && <ErrorMsg error={error} />}
          <div className="row justify-between">
            <button onClick={() => setStep(2)}>
              {providerChoice === 'opencode-go' ? '下一步（自动导入凭证）' : '下一步（输入 API Key）'}
            </button>
            <button className="primary" disabled={busy} onClick={() => void saveAndTest()}>
              {providerChoice === 'opencode-go' ? '保存并测试连接' : '先配置 API Key'}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="col" style={{ marginTop: 20 }}>
          {providerChoice === 'opencode-go' ? (
            <p className="muted">
              已选择 OpenCode Go 网关：凭证将从本机 opencode 订阅自动导入，无需手动输入 Key。
            </p>
          ) : (
            <div>
              <label>步骤 2 / 3：输入 API Key（本地加密存储，仅存本机）</label>
              <input
                type="password"
                style={{ width: '100%' }}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
          )}
          {error && <ErrorMsg error={error} />}
          <div className="row">
            <button onClick={() => setStep(1)}>上一步</button>
            <button
              className="primary"
              disabled={busy || (providerChoice !== 'opencode-go' && !apiKey)}
              onClick={() => void saveAndTest()}
            >
              {busy ? '测试连接中…' : '保存并测试连接'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="col" style={{ marginTop: 20 }}>
          <div>
            <span className="badge">✓ 连接成功</span>
          </div>
          <p className="muted">
            {providerChoice === 'opencode-go'
              ? 'OpenCode Go 网关已就绪：DeepSeek/GLM/GPT/Grok/Kimi 等模型全量可用，你可以在设置中随时调整各任务路由的模型。'
              : '默认资源已就绪：DeepSeek 模型路由、6 个流派预设、反 AI 规则库。你可以随时在设置中调整模型参数。'}
          </p>
          <button className="primary" onClick={onDone}>
            进入工作台
          </button>
        </div>
      )}
    </div>
  )
}
