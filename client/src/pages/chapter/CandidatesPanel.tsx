import { Check, GitBranch, X } from 'lucide-react'
import type { CandidateDraft } from './types'

// v1.0 后续（A1 多候选分支生成）：候选并排对比面板——串行生成的 N 份候选逐份预览，
// 用户选定一份"采用为正文"（复制走版本恢复），其余候选保留在版本历史（note=「候选 N」）。
// 纯展示 + 采纳回调，无自身状态（AGENTS #38）。

interface CandidatesPanelProps {
  candidates: CandidateDraft[]
  busy: boolean
  onAdopt: (candidate: CandidateDraft) => void
  onClose: () => void
}

export function CandidatesPanel({ candidates, busy, onAdopt, onClose }: CandidatesPanelProps): React.JSX.Element {
  return (
    <div className="panel" style={{ background: 'var(--bg-card)', padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          <GitBranch size={14} style={{ color: 'var(--accent-bright)' }} />
          <strong className="t3">候选对比（{candidates.length} 份）</strong>
        </div>
        <button onClick={onClose} style={{ fontSize: 12, padding: '2px 6px' }} title="关闭">
          <X size={14} />
        </button>
      </div>
      <div className="muted t-small" style={{ marginBottom: 8, lineHeight: 1.6 }}>
        每份候选已存入版本历史（note=「候选 N」）。选中一份采用为正文，其余保留便于回退。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
        {candidates.map((c) => (
          <div
            key={c.versionId}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-m)',
              padding: 8,
              background: 'var(--bg-panel)'
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <strong className="t3">{c.note} · {c.wordCount.toLocaleString()} 字</strong>
              <button
                className="sm primary"
                disabled={busy}
                onClick={() => onAdopt(c)}
                title="把这份候选设为当前正文（当前内容先存版本快照）"
              >
                <Check size={12} className="icon-gap" />采用为正文
              </button>
            </div>
            <div
              className="muted"
              style={{
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
                maxHeight: 140,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 6,
                background: 'var(--bg-card)'
              }}
            >
              {c.content.slice(0, 600)}
              {c.content.length > 600 ? ' …' : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
