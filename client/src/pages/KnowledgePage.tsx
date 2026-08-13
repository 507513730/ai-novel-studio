import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Trash2 } from 'lucide-react'
import { resourcesApi, assetsApi } from '../api'
import { useToast } from '../components/Toast'
import { AssetCreator } from '../components/AssetCreator'

// P17-2：知识库页（kb_doc 总览：拆书发布物/外部资料/反 AI 规则）
export function KnowledgePage(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const docs = useQuery({ queryKey: ['knowledge'], queryFn: resourcesApi.knowledge })

  // v0.17.0（审查 A37）：确认后加 busy——防连点重复删除
  const [busy, setBusy] = useState(false)

  const remove = async (id: number): Promise<void> => {
    if (!window.confirm('删除该文档？')) return
    if (busy) return
    setBusy(true)
    try {
      await resourcesApi.knowledgeDelete(id)
      toast('ok', '已删除')
      void queryClient.invalidateQueries({ queryKey: ['knowledge'] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const statusLabel: Record<string, string> = { direct: '直塞', indexed: '已索引', draft: '草稿' }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <div className="row mb-4">
        <Database size={20} />
        <h1 className="ml-2">知识库</h1>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        全局文档库（拆书发布 / 外部资料 / AI 导入）。直塞文档会注入正文生成。
      </p>
      {/* P23：上传/粘贴 → AI 生成知识库文档 */}
      <AssetCreator
        type="knowledge"
        typeLabel="知识库文档"
        placeholder="粘贴小说片段、设定资料、灵感素材…（AI 会整理成文档草稿）"
        maxLen={12000}
        onSave={async (draft, source) => {
          await assetsApi.knowledgeCreate({
            title: String(draft.title ?? source.title ?? '未命名文档').slice(0, 100),
            content: String(draft.content ?? JSON.stringify(draft)).slice(0, 50000),
            status: 'indexed'
          })
        }}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['knowledge'] })}
        hint="保存为全局知识库文档（可被检索注入生成上下文）。"
      />
      <div className="col" style={{ gap: 8, marginTop: 12 }}>
        {docs.data?.docs.map((d) => (
          <div key={d.id} className="panel" style={{ background: 'var(--bg-card)', padding: 12 }}>
            <div className="row justify-between flex-wrap gap-2">
              <div style={{ minWidth: 0 }}>
                <strong className="t3">{d.title}</strong>
                <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                  {d.novelTitle || `#${d.novelId}`} · {d.source} · {d.createdAt}
                </span>
              </div>
              <div className="row">
                <span className="badge" style={d.status === 'direct' ? { color: 'var(--accent-bright)' } : {}}>
                  {statusLabel[d.status] ?? d.status}
                </span>
                <button className="sm" onClick={() => d.novelId > 0 && navigate(`/novels/${d.novelId}`)}>去书</button>
                <button className="sm danger" disabled={busy} onClick={() => void remove(d.id)}><Trash2 size={12} /></button>
              </div>
            </div>
          </div>
        ))}
        {!docs.isLoading && docs.data?.docs.length === 0 && <p className="muted">知识库为空。拆书发布、外部资料直塞后会出现在这里。</p>}
      </div>
    </div>
  )
}
