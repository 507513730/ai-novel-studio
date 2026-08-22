import { useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, PencilLine, Plus } from 'lucide-react'

// v0.24.2（F1 阅读/复盘视图）：干净排版预览章节正文——服务"每卷完成抽读"验收
// 复用 index.css 的 .prose 排印类（CJK 悬垂标点 + --prose-* token，v0.23.0 就绪）
const FS_KEY = 'ans-read-font-size'
const FS_MIN = 13
const FS_MAX = 24

interface ReadingViewProps {
  title: string
  content: string
  hanCount: number
  aiWords: number
  humanWords: number
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onBackToEdit: () => void
}

/** 简单渲染：空行分组 + 行级段落；`# `/`## ` 前缀渲染为标题 */
function renderLine(line: string, idx: number): React.JSX.Element {
  const text = line.trim()
  if (text.startsWith('### ')) return <h3 key={idx}>{text.slice(4)}</h3>
  if (text.startsWith('## ') || text.startsWith('# ')) return <h2 key={idx}>{text.replace(/^#{1,2}\s+/, '')}</h2>
  return <p key={idx}>{text}</p>
}

export function ReadingView(props: ReadingViewProps): React.JSX.Element {
  const [fontSize, setFontSize] = useState<number>(() => {
    const v = Number(localStorage.getItem(FS_KEY))
    return Number.isFinite(v) && v >= FS_MIN && v <= FS_MAX ? v : 16
  })
  const setFs = (n: number): void => {
    const clamped = Math.min(FS_MAX, Math.max(FS_MIN, n))
    localStorage.setItem(FS_KEY, String(clamped))
    setFontSize(clamped)
  }
  const lines = props.content.split(/\n/).filter((l) => l.trim().length > 0)

  return (
    <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 'var(--prose-max-width, 720px)', margin: '0 auto', padding: '18px 24px 64px' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 6 }}>
            <button className="sm" disabled={!props.canPrev} onClick={props.onPrev} title="上一章">
              <ChevronLeft size={13} className="icon-gap" />上一章
            </button>
            <button className="sm" disabled={!props.canNext} onClick={props.onNext} title="下一章">
              下一章<ChevronRight size={13} className="icon-gap" />
            </button>
          </div>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span className="muted t-small">
              {props.hanCount} 字 · 我的 {props.humanWords.toLocaleString()} · AI {props.aiWords.toLocaleString()}
            </span>
            <button className="sm" title="减小字号" onClick={() => setFs(fontSize - 1)}>
              <Minus size={12} />
            </button>
            <span className="muted t-small" style={{ width: 34, textAlign: 'center' }}>{fontSize}px</span>
            <button className="sm" title="增大字号" onClick={() => setFs(fontSize + 1)}>
              <Plus size={12} />
            </button>
            <button className="sm primary" onClick={props.onBackToEdit}>
              <PencilLine size={12} className="icon-gap" />返回编辑
            </button>
          </div>
        </div>
        <h1 style={{ fontSize: 'var(--fs-24)', fontWeight: 600, lineHeight: 1.4, margin: '0 0 var(--sp-4)' }}>
          {props.title}
        </h1>
        {lines.length === 0 ? (
          <div className="panel" style={{ padding: '40px 24px', textAlign: 'center', background: 'var(--bg-card)' }}>
            <p className="muted">本章还没有正文。</p>
            <button className="primary" onClick={props.onBackToEdit}>去写正文</button>
          </div>
        ) : (
          <div className="prose" style={{ ['--prose-font-size' as string]: `${fontSize}px` } as React.CSSProperties}>
            {lines.map(renderLine)}
          </div>
        )}
      </div>
    </div>
  )
}
