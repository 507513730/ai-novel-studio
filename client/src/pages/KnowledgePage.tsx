import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Trash2 } from 'lucide-react'
import { resourcesApi } from '../api'
import { useToast } from '../components/Toast'

// P17-2：知识库页（kb_doc 总览：拆书发布物/外部资料/反 AI 规则）
export function KnowledgePage(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const docs = useQuery({ queryKey: ['knowledge'], queryFn: resourcesApi.knowledge })

  const remove = async (id: number): Promise<void> => {
    if (!window.confirm('删除该文档？')) return
    try {
      await resourcesApi.knowledgeDelete(id)
      toast('ok', '已删除')
      void queryClient.invalidateQueries({ queryKey: ['knowledge'] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const statusLabel: Record<string, string> = { direct: '直塞', indexed: '已索引', draft: '草稿' }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <Database size={20} />
        <h1 style={{ marginLeft: 8 }}>知识库</h1>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        全部文档总览（拆书发布物 / 外部资料 / 反 AI 规则）。直塞文档会注入章节生成上下文。
      </p>
      <div className="col" style={{ gap: 8 }}>
        {docs.data?.docs.map((d) => (
          <div key={d.id} className="panel" style={{ background: 'var(--bg-card)', padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>{d.title}</strong>
                <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                  {d.novelTitle || `#${d.novelId}`} · {d.source} · {d.createdAt}
                </span>
              </div>
              <div className="row">
                <span className="badge" style={d.status === 'direct' ? { color: 'var(--accent-bright)' } : {}}>
                  {statusLabel[d.status] ?? d.status}
                </span>
                <button className="sm" onClick={() => d.novelId > 0 && navigate(`/novels/${d.novelId}`)}>去书</button>
                <button className="sm danger" onClick={() => void remove(d.id)}><Trash2 size={12} /></button>
              </div>
            </div>
          </div>
        ))}
        {!docs.isLoading && docs.data?.docs.length === 0 && <p className="muted">知识库为空。拆书发布、外部资料直塞后会出现在这里。</p>}
      </div>
    </div>
  )
}
