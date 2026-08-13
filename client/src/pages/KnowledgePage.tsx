import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Trash2, Globe, Search, Download } from 'lucide-react'
import { resourcesApi, assetsApi, apiFetch } from '../api'
import { useToast } from '../components/Toast'
import { AssetCreator } from '../components/AssetCreator'
import { useConfirm } from '../components/ConfirmDialog'

interface WebHit {
  title: string
  snippet: string
  url: string
  excerpt?: string
}

// v0.18.0：联网搜索（零 key Wikipedia）——搜索 → 一键导入知识库
function WebSearchBox({ onImported }: { onImported: () => void }): React.JSX.Element {
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [hits, setHits] = useState<WebHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importBusy, setImportBusy] = useState<string | null>(null)

  const search = async (): Promise<void> => {
    const q = query.trim()
    if (!q || busy) return
    setBusy(true)
    setError(null)
    setHits(null)
    try {
      const d = (await apiFetch('/settings/web/search', {
        method: 'POST',
        body: JSON.stringify({ query: q })
      })) as { results?: WebHit[]; excerpt?: string }
      setHits(d.results ?? [])
      if ((d.results ?? []).length === 0) setError('无结果（换个关键词试试）')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const importHit = async (h: WebHit): Promise<void> => {
    setImportBusy(h.title)
    try {
      const content = h.excerpt ? `${h.title}\n来源：${h.url}\n\n${h.excerpt}` : `${h.title}\n来源：${h.url}\n\n${h.snippet}`
      await assetsApi.knowledgeCreate({
        title: `联网-${h.title.slice(0, 60)}`,
        content: content.slice(0, 50000),
        status: 'indexed'
      })
      toast('ok', `已导入「${h.title}」`)
      onImported()
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setImportBusy(null)
    }
  }

  return (
    <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Globe size={14} color="var(--accent-bright)" />
        <strong style={{ fontSize: 13 }}>联网搜索</strong>
        <span className="muted t-small">零 key（Wikipedia，中文优先）——搜设定资料，一键导入知识库</span>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <input
          style={{ flex: 1 }}
          placeholder="如：完美世界 石昊 / 洪荒 量劫 / 九州 设定…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
        />
        <button className="primary" disabled={busy || !query.trim()} onClick={() => void search()}>
          <Search size={12} className="icon-gap" />
          {busy ? '搜索中…' : '搜索'}
        </button>
      </div>
      {error && <p className="t-small" style={{ color: 'var(--danger)', margin: '8px 0 0' }}>{error}</p>}
      {hits && hits.length > 0 && (
        <div className="col" style={{ gap: 6, marginTop: 8 }}>
          {hits.map((h) => (
            <div key={h.title} className="row flex-wrap" style={{ gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <strong>{h.title}</strong>
                <span className="muted" style={{ display: 'block', marginTop: 2 }}>{h.snippet.slice(0, 160)}</span>
              </div>
              <button
                className="sm"
                disabled={importBusy !== null}
                onClick={() => void importHit(h)}
                title="导入为知识库文档（含摘要正文）"
              >
                <Download size={11} className="icon-gap" />
                {importBusy === h.title ? '导入中…' : '导入'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// P17-2：知识库页（kb_doc 总览：拆书发布物/外部资料/反 AI 规则）
export function KnowledgePage(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const docs = useQuery({ queryKey: ['knowledge'], queryFn: resourcesApi.knowledge })

  // v0.17.0（审查 A37）：确认后加 busy——防连点重复删除
  const [busy, setBusy] = useState(false)
  // v0.21.0（审查 P3-6：themed confirm 统一）——替代 window.confirm 的主题化确认
  const [confirmDelete, deleteDialog] = useConfirm()

  const remove = async (id: number): Promise<void> => {
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
      {/* v0.18.0：联网搜索（设置 → 写作 → 联网查找 开启后可用） */}
      <WebSearchBox onImported={() => void queryClient.invalidateQueries({ queryKey: ['knowledge'] })} />
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
                <button
                  className="sm danger"
                  disabled={busy}
                  onClick={() =>
                    confirmDelete({
                      title: '删除文档',
                      message: `删除文档「${d.title}」？`,
                      confirmText: '删除',
                      danger: true,
                      action: () => void remove(d.id)
                    })
                  }
                ><Trash2 size={12} /></button>
              </div>
            </div>
          </div>
        ))}
        {!docs.isLoading && docs.data?.docs.length === 0 && <p className="muted">知识库为空。拆书发布、外部资料直塞后会出现在这里。</p>}
      </div>
      {deleteDialog}
    </div>
  )
}
