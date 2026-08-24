import { useState } from 'react'
import { Upload, FileText, PenLine, Sparkles, Save } from 'lucide-react'
import { assetsApi } from '../api'
import { useToast } from './Toast'

// ============================================================
// P23：统一资产创建器（三模式：上传文件 / 粘贴文本 / 手动填写）
// → AI 提取草稿（可编辑）→ 保存到对应库
// ============================================================

export interface AssetDraft {
  type: string
  draft: Record<string, unknown>
}

export type AssetSaveFn = (draft: Record<string, unknown>, source: { title: string; text: string }) => Promise<void>

interface AssetCreatorProps {
  type: string
  typeLabel: string
  placeholder: string
  maxLen: number
  onSave: AssetSaveFn
  onSaved: () => void
  hint?: string
  /** 无需保存的类型（如标题组：生成结果直接展示） */
  saveable?: boolean
}

type Mode = 'upload' | 'paste' | 'manual'

export function AssetCreator({ type, typeLabel, placeholder, maxLen, onSave, onSaved, hint, saveable = true }: AssetCreatorProps): React.JSX.Element {
  const { toast } = useToast()
  const [mode, setMode] = useState<Mode>('paste')
  const [sourceTitle, setSourceTitle] = useState('')
  const [text, setText] = useState('')
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<AssetDraft | null>(null)
  const [draftText, setDraftText] = useState('')
  const [chapterCount, setChapterCount] = useState<number | null>(null)

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.readAsDataURL(file)
    })

  const handleFile = async (file: File): Promise<void> => {
    setBusy('upload')
    setError(null)
    try {
      const dataUrl = await readFile(file)
      const base64 = dataUrl.split(',')[1] ?? ''
      const r = await assetsApi.importFile(file.name, base64, true)
      setSourceTitle(r.title)
      setText(r.text.slice(0, maxLen))
      setChapterCount(r.chapterCount ?? null)
      toast('ok', `已解析 ${r.title}${r.chapterCount ? `（${r.chapterCount} 章）` : ''}，可点「AI 生成」`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const genDraft = async (): Promise<void> => {
    const src = mode === 'manual' ? manual : text
    if (src.trim().length < 10) {
      setError('内容太少（至少 10 字）')
      return
    }
    setBusy('gen')
    setError(null)
    try {
      const r = await assetsApi.extract(type, src.trim().slice(0, maxLen), sourceTitle)
      setDraft(r)
      setDraftText(JSON.stringify(r.draft, null, 2))
      setMode('manual')
      toast('ok', `已生成${typeLabel}草稿，可修改后保存`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy('save')
    setError(null)
    try {
      const parsed = JSON.parse(draftText) as Record<string, unknown>
      await onSave(parsed, { title: sourceTitle, text })
      toast('ok', `${typeLabel}已保存`)
      setDraft(null)
      setDraftText('')
      setText('')
      setManual('')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className={`sm${mode === 'upload' ? ' primary' : ''}`} onClick={() => setMode('upload')}>
          <Upload size={12} className="icon-gap" />上传文件
        </button>
        <button className={`sm${mode === 'paste' ? ' primary' : ''}`} onClick={() => setMode('paste')}>
          <FileText size={12} className="icon-gap" />粘贴文本
        </button>
        <button className={`sm${mode === 'manual' ? ' primary' : ''}`} onClick={() => setMode('manual')}>
          <PenLine size={12} className="icon-gap" />手动填写
        </button>
      </div>

      {mode === 'upload' && (
        // v0.24.4（A7）：文件拖拽导入（拖到区域即解析）
        <div
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files?.[0]
            if (f) void handleFile(f)
          }}
          style={{ border: '2px dashed var(--border)', borderRadius: 8, padding: 14, textAlign: 'center', cursor: 'pointer' }}
        >
          <Upload size={16} className="muted" />
          <p className="muted t-small" style={{ margin: '4px 0 8px' }}>拖拽文件到这里，或点击选择</p>
          <input
            type="file"
            accept=".txt,.md,.markdown,.epub"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            支持 TXT / MD / EPUB（自动分章）。解析后可点「AI 生成」提取{typeLabel}。
          </p>
          {chapterCount !== null && <p className="muted t-small">已解析 {chapterCount} 章，将取前 {Math.min(chapterCount, 300)} 章内容。</p>}
        </div>
      )}

      {(mode === 'paste' || mode === 'upload') && text.length > 0 && (
        <div className="mt-2">
          <textarea
            style={{ width: '100%', minHeight: 120, fontSize: 12 }}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      )}

      {mode === 'paste' && (
        <textarea
          style={{ width: '100%', minHeight: 120, fontSize: 12, marginTop: 8 }}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}

      {mode === 'manual' && (
        <textarea
          style={{ width: '100%', minHeight: 120, fontSize: 12, marginTop: 8 }}
          placeholder={draft ? 'AI 草稿（可编辑 JSON）…' : '手动填写内容（点「AI 生成」可由 AI 整理，或直接编辑草稿保存）…'}
          value={draftText || manual}
          onChange={(e) => {
            if (draft) setDraftText(e.target.value)
            else setManual(e.target.value)
          }}
        />
      )}

      {error && <p className="muted" style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{error}</p>}

      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        <button
          className="sm primary"
          disabled={busy !== null}
          onClick={() => void genDraft()}
          title="AI 从内容中提取草稿（可修改后保存）"
        >
          <Sparkles size={12} className="icon-gap" />
          {busy === 'gen' ? '生成中…' : 'AI 生成'}
        </button>
        {saveable && (
          <button className="sm" disabled={busy !== null || !draft} onClick={() => void save()}>
            <Save size={12} className="icon-gap" />
            {busy === 'save' ? '保存中…' : '保存'}
          </button>
        )}
        {draft && (
          <button className="sm" onClick={() => { setDraft(null); setDraftText(''); }}>
            取消
          </button>
        )}
      </div>
      {hint && <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>{hint}</p>}
    </div>
  )
}
