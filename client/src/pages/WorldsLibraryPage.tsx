import { EmptyState } from '../components/EmptyState'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe2, Save, Trash2, Copy } from 'lucide-react'
import { resourcesApi, novelApi, assetsApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { AssetCreator } from '../components/AssetCreator'
import { useToast } from '../components/Toast'

// P17-2：世界样本库（从书保存样本 / 应用样本到书）
export function WorldsLibraryPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveFrom, setSaveFrom] = useState(0)
  const [saveName, setSaveName] = useState('')

  const templates = useQuery({ queryKey: ['world-templates'], queryFn: resourcesApi.worldTemplates })
  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({ queryKey: ['novels'], queryFn: novelApi.list })

  const saveFromNovel = async (): Promise<void> => {
    if (!saveFrom || !saveName.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await resourcesApi.worldTemplateFromNovel(saveFrom, saveName.trim())
      setSaveName('')
      toast('ok', '已保存为世界样本')
      void queryClient.invalidateQueries({ queryKey: ['world-templates'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  const apply = async (templateId: number, novelId: number): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await resourcesApi.worldTemplateApply(templateId, novelId)
      toast('ok', '已应用世界样本')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number): Promise<void> => {
    if (!window.confirm('删除该世界样本？')) return
    try {
      await resourcesApi.worldTemplateDelete(id)
      void queryClient.invalidateQueries({ queryKey: ['world-templates'] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <Globe2 size={20} />
        <h1 style={{ marginLeft: 8 }}>世界样本库</h1>
      </div>
      {error && <ErrorMsg error={error} />}
      {/* P23：上传/粘贴/手动 → AI 生成世界样本 */}
      <AssetCreator
        type="world"
        typeLabel="世界样本"
        placeholder="粘贴设定文本、世界观描写、背景资料…（AI 提炼世界手册与势力）"
        maxLen={12000}
        onSave={async (draft) => {
          await assetsApi.worldTemplateCreate({
            name: String(draft.name ?? '未命名世界').slice(0, 60),
            manual: (draft.manual as Record<string, string>) ?? {},
            factions: Array.isArray(draft.factions) ? (draft.factions as string[]) : [],
            map: (draft.map as Record<string, string>) ?? {},
            timeline: Array.isArray(draft.timeline) ? (draft.timeline as string[]) : []
          })
        }}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['world-templates'] })}
        hint="保存后可应用到任意书籍（世界 → 本书世界）。"
      />
      <div className="panel" style={{ marginBottom: 16, marginTop: 12 }}>
        <h2 style={{ marginBottom: 8 }}>从书保存为样本</h2>
        <div className="row">
          <select style={{ flex: 2 }} value={saveFrom} onChange={(e) => setSaveFrom(Number(e.target.value))}>
            <option value={0}>选择书…</option>
            {novels.data?.novels.map((n) => <option key={n.id} value={n.id}>{n.title || `#${n.id}`}</option>)}
          </select>
          <input style={{ flex: 3 }} placeholder="样本名" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          <button className="primary" disabled={busy || !saveFrom || !saveName.trim()} onClick={() => void saveFromNovel()}>
            <Save size={14} style={{ verticalAlign: -1, marginRight: 4 }} />保存
          </button>
        </div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        {templates.data?.templates.map((t) => (
          <div key={t.id} className="panel" style={{ background: 'var(--bg-card)', padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>{t.name}</strong>
                <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                  手册 {Object.keys(t.manual).length} 项 · 势力 {t.factions.length} · 地点 {Object.keys(t.map).length}
                </span>
              </div>
              <div className="row">
                <select
                  style={{ width: 160, padding: '4px 8px', fontSize: 12 }}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      if (window.confirm('应用样本将覆盖目标书的世界观，继续？')) void apply(t.id, Number(e.target.value))
                      e.target.value = ''
                    }
                  }}
                >
                  <option value="" disabled>应用样本到…</option>
                  {novels.data?.novels.map((n) => <option key={n.id} value={n.id}>{n.title || `#${n.id}`}</option>)}
                </select>
                <button className="sm" title="复制样本 JSON" onClick={() => void navigator.clipboard.writeText(JSON.stringify({ name: t.name, manual: t.manual, factions: t.factions, map: t.map }, null, 2)).then(() => toast('ok', '已复制样本 JSON'))}><Copy size={12} /></button>
                <button className="sm danger" onClick={() => void remove(t.id)}><Trash2 size={12} /></button>
              </div>
            </div>
          </div>
        ))}
        {!templates.isLoading && templates.data?.templates.length === 0 && <EmptyState icon={Globe2} title="暂无世界样本" desc="可导入示例或从书籍内容提取世界观。" />}
      </div>
    </div>
  )
}
