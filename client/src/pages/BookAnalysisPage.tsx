import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ScanSearch, Upload } from 'lucide-react'
import { novelApi, analysisApi, assetsApi } from '../api'
import { useToast } from '../components/Toast'

// P23：外部书导入卡片（上传 → 解析分章 → 建外部书 → 拆书）
function ImportBookCard({ onImported }: { onImported: (id: number) => void }): React.JSX.Element {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ title: string; chapters: Array<{ title: string; content: string }> } | null>(null)

  const handleFile = async (file: File): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('文件读取失败'))
        reader.readAsDataURL(file)
      })
      const r = await assetsApi.importFile(file.name, dataUrl.split(',')[1] ?? '', true)
      if (!r.chapters || r.chapters.length === 0) {
        setError('未能从文件中识别章节（支持 TXT/MD/EPUB，按「第X章」或空行分段）')
        return
      }
      setPreview({ title: r.title, chapters: r.chapters })
      toast('ok', `已解析 ${r.chapters.length} 章，确认后导入拆书`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (): Promise<void> => {
    if (!preview || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await assetsApi.importBook({ title: preview.title, chapters: preview.chapters })
      toast('ok', `外部书「${preview.title}」已导入（${r.chapterCount} 章），进入拆书`)
      onImported(r.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Upload size={15} />
        <strong className="t3">导入外部文件拆书</strong>
        <span className="muted t-small">支持 TXT / MD / EPUB（自动分章，≤300 章）</span>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <input
          type="file"
          accept=".txt,.md,.markdown,.epub"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />
        {preview && (
          <>
            <button className="sm primary" disabled={busy} onClick={() => void doImport()}>
              {busy ? '导入中…' : `确认导入「${preview.title}」（${preview.chapters.length} 章）`}
            </button>
            <button className="sm" disabled={busy} onClick={() => setPreview(null)}>取消</button>
          </>
        )}
      </div>
      {error && <p className="muted" style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{error}</p>}
      {preview && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6, maxHeight: 80, overflowY: 'auto' }}>
          章节预览：{preview.chapters.slice(0, 5).map((ch) => ch.title).join('、')}{preview.chapters.length > 5 ? '…' : ''}
        </div>
      )}
    </div>
  )
}

// P17-1：拆书全局页（所有书拆书记录 + 发布物总览）
export function BookAnalysisPage(): React.JSX.Element {
  const navigate = useNavigate()
  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({ queryKey: ['novels'], queryFn: novelApi.list })

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <div className="row mb-4">
        <ScanSearch size={20} />
        <h1 className="ml-2">拆书</h1>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        各书的拆书分析与发布物总览。进入书内可执行新拆书、角色档案与形象演变。
      </p>
      {/* P23：导入外部文件（TXT/MD/EPUB）→ 建外部书 → 直接拆书 */}
      <ImportBookCard onImported={(id) => navigate(`/novels/${id}/?tab=analysis`)} />
      <div className="col" style={{ gap: 12, marginTop: 12 }}>
        {novels.data?.novels.map((n) => (
          <NovelAnalyses key={n.id} novelId={n.id} title={n.title} onOpen={() => navigate(`/novels/${n.id}/?tab=analysis`)} />
        ))}
        {novels.data?.novels.length === 0 && <p className="muted">还没有小说。</p>}
      </div>
    </div>
  )
}

function NovelAnalyses({ novelId, title, onOpen }: { novelId: number; title: string; onOpen: () => void }): React.JSX.Element {
  const q = useQuery({
    queryKey: ['analysis', novelId],
    queryFn: () => analysisApi.list(novelId)
  })
  return (
    <div className="panel">
      <div className="row justify-between">
        <strong>{title} <span className="muted t-small">#{novelId}</span></strong>
        <button className="sm" onClick={onOpen}>进入拆书工作台</button>
      </div>
      {q.data?.analyses.length === 0 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>暂无拆书记录。</p>}
      <div className="col" style={{ gap: 6, marginTop: 8 }}>
        {q.data?.analyses.map((a) => (
          <div key={a.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6, fontSize: 13 }}>
            <span><span className="badge">{a.depth}</span> <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{String((a.result as Record<string, unknown>)?.genre ?? '')} · {a.createdAt}</span></span>
            <span className="muted t-small">id {a.id}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
