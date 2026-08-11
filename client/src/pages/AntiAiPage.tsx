import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Plus, X } from 'lucide-react'
import { antiAiApi, assetsApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/Toast'
import { AssetCreator } from '../components/AssetCreator'

// P16 P1：反 AI 规则管理（词库查看/增删）
export function AntiAiPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newWord, setNewWord] = useState('')

  const assets = useQuery({
    queryKey: ['anti-ai'],
    queryFn: antiAiApi.list
  })

  const saveWords = async (id: number, words: string[]): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await antiAiApi.update(id, words)
      toast('ok', '词库已更新')
      void queryClient.invalidateQueries({ queryKey: ['anti-ai'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div className="row mb-4">
        <ShieldCheck size={20} />
        <h1 className="ml-2">反 AI 规则</h1>
      </div>
      {/* P23：上传/粘贴/手动 → AI 提炼反 AI 词库 */}
      <AssetCreator
        type="anti-ai"
        typeLabel="反 AI 词库"
        placeholder="粘贴你的正文或 AI 生成文本…（AI 提炼模板腔词汇/句式）"
        maxLen={8000}
        onSave={async (draft) => {
          await assetsApi.antiAiAssetCreate({
            name: String(draft.name ?? 'AI 腔词库').slice(0, 40),
            words: Array.isArray(draft.words) ? (draft.words as string[]).map((w) => String(w).slice(0, 30)) : []
          })
        }}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['anti-ai'] })}
      />
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        高频腔词与模板句会在审核与生成链路中检测/约束，降低正文的 AI 腔。可自由增删。
      </p>
      {error && <ErrorMsg error={error} />}
      {assets.isLoading && <p className="muted">加载中…</p>}
      <div className="col" style={{ gap: 12 }}>
        {assets.data?.assets.map((a) => (
          <div key={a.id} className="panel">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <strong>{a.name}</strong>
              <span className="badge">{a.type === 'anti_ai_lexicon' ? '腔词' : '模板句'}</span>
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {a.words.map((w) => (
                <span key={w} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {w}
                  <button
                    className="ghost sm"
                    style={{ padding: 0, fontSize: 11 }}
                    onClick={() => void saveWords(a.id, a.words.filter((x) => x !== w))}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <input
                style={{ width: 200 }}
                placeholder="新增词汇"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newWord.trim()) {
                    void saveWords(a.id, [...a.words, newWord.trim()])
                    setNewWord('')
                  }
                }}
              />
              <button
                className="sm primary"
                disabled={busy || !newWord.trim()}
                onClick={() => {
                  void saveWords(a.id, [...a.words, newWord.trim()])
                  setNewWord('')
                }}
              >
                <Plus size={12} className="icon-gap" />添加
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
