import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { novelApi } from '../../api'
import type { ExportPreview } from '../../types'
import type { ExportFormat } from './EditorArea'
import { Loading } from '../../components/Loading'

// v1.0 后续（A5 导出预览）：整本书导出前的排版预览——复用 .prose 排印类（CJK 悬垂标点 + --prose-* token），
// 让用户在下载 TXT/MD/EPUB/DOCX 前先确认整本书的版面效果，避免导出后才发现格式问题。
// 数据源与 /export 共用同一份"已写章节"查询，保证预览与真实导出一致。

interface ExportPreviewModalProps {
  novelId: number
  format: ExportFormat
  onClose: () => void
  onDownload: (format: ExportFormat) => void
  downloadBusy: string | null
  onToggleFormat: (format: ExportFormat) => void
}

/** 简单渲染：空行分组 + 行级段落；`# `/`## `/`### ` 前缀渲染为标题（与 ReadingView 一致） */
function renderLine(line: string, idx: number): React.JSX.Element {
  const text = line.trim()
  if (text.startsWith('### ')) return <h3 key={idx}>{text.slice(4)}</h3>
  if (text.startsWith('## ') || text.startsWith('# ')) return <h2 key={idx}>{text.replace(/^#{1,2}\s+/, '')}</h2>
  return <p key={idx}>{text}</p>
}

const FORMAT_HINT: Record<ExportFormat, string> = {
  txt: '纯文本（TXT）· 含 UTF-8 BOM，兼容旧版 Windows 记事本',
  md: 'Markdown · 保留标题层级，适合二次编辑',
  epub: '电子书（EPUB）· 适合阅读器 / 手机排版',
  docx: 'Word 文档（DOCX）· 投稿平台事实标准'
}

export function ExportPreviewModal({
  novelId,
  format,
  onClose,
  onDownload,
  downloadBusy,
  onToggleFormat
}: ExportPreviewModalProps): React.JSX.Element {
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setError(null)
    novelApi
      .exportPreview(novelId)
      .then((data) => {
        if (!cancelled) setPreview(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [novelId])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const totalWords = preview ? preview.chapters.reduce((sum, c) => sum + c.content.length, 0) : 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--z-modal)',
        padding: 24
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 'min(920px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-elevated)', padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="导出预览"
      >
        {/* 顶栏 */}
        <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>导出预览 · {preview?.title ?? '加载中'}</h2>
            {preview && (
              <span className="muted t-small">
                {preview.chapters.length} 章 · {totalWords.toLocaleString()} 字
              </span>
            )}
          </div>
          <button className="sm" onClick={onClose} title="关闭">
            <X size={14} />
          </button>
        </div>

        {/* 格式切换 + 提示 */}
        <div className="row flex-wrap" style={{ padding: '10px 16px', gap: 8, borderBottom: '1px solid var(--border)' }}>
          {(['txt', 'md', 'epub', 'docx'] as ExportFormat[]).map((f) => (
            <button
              key={f}
              className="sm"
              style={f === format ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent-bright)' } : undefined}
              onClick={() => onToggleFormat(f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
          <span className="muted t-small" style={{ alignSelf: 'center' }}>{FORMAT_HINT[format]}</span>
        </div>

        {/* 正文预览 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 56px' }}>
          {error ? (
            <div className="error-msg">{error}</div>
          ) : !preview ? (
            <div className="col" style={{ alignItems: 'center', gap: 12, paddingTop: 60 }}>
              <Loading label="正在组装导出预览…" />
            </div>
          ) : (
            <div className="prose">
              <h1 style={{ fontSize: 'var(--fs-24)', fontWeight: 600, lineHeight: 1.4, margin: '0 0 var(--sp-4)' }}>
                {preview.title}
              </h1>
              {preview.inspiration && (
                <p className="muted" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
                  灵感：{preview.inspiration}
                </p>
              )}
              {preview.chapters.length === 0 ? (
                <p className="muted">本书还没有已写正文（需状态为「已写 / 已审 / 已完成」的章节才能导出）。</p>
              ) : (
                preview.chapters.map((c) => (
                  <div key={c.title} style={{ marginBottom: 'var(--sp-5)' }}>
                    <h2 style={{ fontSize: 'var(--fs-18)', fontWeight: 600, margin: '0 0 var(--sp-3)' }}>
                      {c.title || '（未命名章节）'}
                    </h2>
                    {c.content.split(/\n/).filter((l) => l.trim().length > 0).map(renderLine)}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 底栏：下载 */}
        <div className="row" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', justifyContent: 'flex-end', gap: 8 }}>
          <button className="sm" onClick={onClose}>取消</button>
          <button
            className="primary"
            disabled={downloadBusy !== null || !preview || preview.chapters.length === 0}
            onClick={() => onDownload(format)}
          >
            {downloadBusy === format ? '导出中…' : (
              <>
                <Download size={14} className="icon-gap" />下载 {format.toUpperCase()}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
