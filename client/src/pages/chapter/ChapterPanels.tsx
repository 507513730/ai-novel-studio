import { Wand2 } from 'lucide-react'
import { countCjk, type CtxSection, type PendingData, type ProofreadIssue, type ResourceDetail } from './types'

// v0.25.0（审查 S1）：从 ChapterExecutionPage 拆出的纯展示面板。
// 这些组件无自身状态、仅依赖 props，可独立测试，也让主页面从 1989 行降下来。

/** P12 A3：本章进度矩阵（信号由主页面从现有状态推导后传入） */
export function ProgressMatrix({ segments }: { segments: Array<[string, boolean]> }): React.JSX.Element {
  const doneCount = segments.filter(([, v]) => v).length
  return (
    <div className="panel" style={{ background: 'var(--bg-card)', padding: 12, marginBottom: 12 }}>
      <div className="row justify-between">
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>本章进度</span>
        <span style={{ fontSize: 12, color: 'var(--accent-bright)' }}>
          {doneCount}/{segments.length}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        {segments.map(([label, done]) => (
          <div key={label} title={`${label}${done ? ' ✓' : ''}`} className="flex-1">
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: done ? 'var(--ok)' : 'var(--bg-input)',
                transition: 'background 200ms'
              }}
            />
            <div
              style={{
                fontSize: 'var(--fs-11)',
                color: done ? 'var(--ok)' : 'var(--text-faint)',
                marginTop: 3,
                textAlign: 'center',
                whiteSpace: 'nowrap'
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 资源详情（角色/设定/规则/版本全文——统一浮层容器） */
export function ResourceDetailPanel({
  detail,
  onClose
}: {
  detail: ResourceDetail
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
      <div className="row justify-between">
        <strong className="t3">{detail.title}</strong>
        <button onClick={onClose} style={{ fontSize: 12, padding: '2px 6px' }}>
          ✕
        </button>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          lineHeight: 1.6,
          maxHeight: 300,
          overflowY: 'auto'
        }}
      >
        {detail.body || '（无内容）'}
      </div>
    </div>
  )
}

/** 待确认区（未确认事实 / 待确认角色） */
export function PendingPanel({
  pending,
  onClose
}: {
  pending: PendingData | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
      <div className="row justify-between">
        <strong>待确认区</strong>
        <button onClick={onClose} style={{ fontSize: 12, padding: '2px 6px' }}>
          关闭
        </button>
      </div>
      {pending && pending.pendingFacts.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <span className="muted">未确认事实：</span>
          {pending.pendingFacts.map((f) => (
            <div key={f.id}>• {f.content}</div>
          ))}
        </div>
      )}
      {pending && pending.pendingCharacters.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <span className="muted">待确认角色：</span>
          {pending.pendingCharacters.map((c) => (
            <div key={c.id}>• {c.name}</div>
          ))}
        </div>
      )}
      {pending && pending.pendingFacts.length === 0 && pending.pendingCharacters.length === 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          暂无待确认项
        </p>
      )}
    </div>
  )
}

/** 回灌提取结果（待确认的角色状态 / 新事实 / 新伏笔） */
export function BackfillResultPanel({
  result,
  busy,
  onConfirm
}: {
  result: Record<string, unknown>
  busy: boolean
  onConfirm: () => void
}): React.JSX.Element {
  return (
    <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
      <strong>回灌提取（待确认）</strong>
      {Array.isArray(result.characterStates) &&
        (result.characterStates as Array<{ name: string; state: string }>).length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            {result.characterStates.map((cs, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                • {cs.name}：{cs.state}
              </div>
            ))}
          </div>
        )}
      {Array.isArray(result.newFacts) &&
        (result.newFacts as Array<{ content: string }>).length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <span className="muted">新事实：</span>
            {result.newFacts.map((f, i) => (
              <div key={i}>• {f.content}</div>
            ))}
          </div>
        )}
      {Array.isArray(result.foreshadows) &&
        (result.foreshadows as Array<{ content: string }>).length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <span className="muted">新伏笔：</span>
            {result.foreshadows.map((f, i) => (
              <div key={i}>• {f.content}</div>
            ))}
          </div>
        )}
      <button className="primary" style={{ marginTop: 10 }} disabled={busy} onClick={onConfirm}>
        确认角色状态入账
      </button>
    </div>
  )
}

/** v0.24.4（A4）：本地校对结果 */
export function ProofreadPanel({
  issues,
  onClose
}: {
  issues: ProofreadIssue[]
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="panel col" style={{ padding: 10, background: 'var(--bg-panel)', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong className="t-small">校对结果（{issues.length} 条）</strong>
        <button className="sm" onClick={onClose}>
          关闭
        </button>
      </div>
      {issues.length === 0 && (
        <p className="muted t-small">未发现明显问题 ✓（检查：重复词/乱码/错别字/称谓一致性）</p>
      )}
      {issues.map((p, i) => (
        <div key={i} className="row" style={{ gap: 6, fontSize: 11, alignItems: 'flex-start' }}>
          <span
            className="badge"
            style={{
              color:
                p.type === 'mojibake'
                  ? 'var(--danger)'
                  : p.type === 'repeat'
                    ? 'var(--warn)'
                    : 'var(--accent-bright)'
            }}
          >
            {p.type === 'typo'
              ? '错别字'
              : p.type === 'name'
                ? '称谓'
                : p.type === 'repeat'
                  ? '重复词'
                  : p.type === 'mojibake'
                    ? '乱码'
                    : '语病'}
          </span>
          <div className="col" style={{ gap: 2, flex: 1 }}>
            <span style={{ color: 'var(--text)' }}>{p.problem}</span>
            <span className="muted" style={{ wordBreak: 'break-all' }}>
              「{p.location}」 → {p.suggestion}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** B1：写作上下文（生成时注入；可勾选过滤省 token） */
export function ContextPanel({
  sections,
  toggles,
  onToggle,
  onClose
}: {
  sections: CtxSection[]
  toggles: Record<string, boolean>
  onToggle: (key: string) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
      <div className="row justify-between">
        <strong>写作上下文（生成时注入）</strong>
        <button onClick={onClose} style={{ fontSize: 12, padding: '2px 6px' }}>
          关闭
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {sections.map((s) => (
          <label
            key={s.key}
            className="row"
            style={{ fontSize: 12, cursor: 'pointer', justifyContent: 'space-between' }}
          >
            <span className="row gap-2">
              <input type="checkbox" checked={toggles[s.key] ?? true} onChange={() => onToggle(s.key)} />
              {s.key}
            </span>
            <span className="muted t-small">{Math.round(s.tokens)} tokens</span>
          </label>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        取消勾选后，该段不注入生成上下文（可省 token，但可能影响一致性）。勾选改动在下次生成时生效。
      </p>
    </div>
  )
}

/** P10：空状态引导（编辑器空置时告诉用户下一步） */
export function EmptyStateGuide({
  summary,
  busy,
  onGenerate
}: {
  summary?: string
  busy: boolean
  onGenerate: () => void
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 5
      }}
    >
      <div
        className="panel"
        style={{
          background: 'var(--bg-panel)',
          maxWidth: 380,
          padding: '20px 24px',
          textAlign: 'center',
          pointerEvents: 'auto',
          boxShadow: 'var(--shadow-lg)'
        }}
      >
        <div style={{ fontSize: 16, marginBottom: 8 }}>📝 本章还没有正文</div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 14 }}>
          点击下方按钮，AI 将根据本章任务单、写作上下文与角色账本生成正文。
          {summary ? (
            <>
              <br />
              本章概要：{summary}
            </>
          ) : null}
        </div>
        <button className="primary" onClick={onGenerate} disabled={busy}>
          生成正文
        </button>
      </div>
    </div>
  )
}

/** v0.19.0：光标续写建议浮层（Cmd/Ctrl+J 生成 → Tab 插入 / Esc 关闭） */
export function SuggestionOverlay({
  suggestion,
  busy,
  onAccept,
  onRegenerate,
  onClose
}: {
  suggestion: { text: string; pos: number } | null
  busy: boolean
  onAccept: () => void
  onRegenerate: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: 8,
        zIndex: 20,
        background: 'var(--bg-panel)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-m)',
        boxShadow: 'var(--shadow-lg)',
        padding: '8px 12px'
      }}
    >
      {busy && !suggestion ? (
        <div className="row" style={{ gap: 8, fontSize: 12, color: 'var(--text-dim)' }}>
          <Wand2 size={13} /> 正在生成续写建议…
        </div>
      ) : suggestion ? (
        <div className="col" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Wand2 size={13} color="var(--accent-bright)" />
            <strong style={{ fontSize: 12 }}>AI 续写建议</strong>
            <span className="muted t-small">（{countCjk(suggestion.text)} 字）</span>
            <span style={{ flex: 1 }} />
            <button className="sm primary" onClick={onAccept}>
              Tab 插入
            </button>
            <button className="sm" onClick={onRegenerate}>
              ↻ 再生成
            </button>
            <button className="sm" onClick={onClose}>
              Esc 关闭
            </button>
          </div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.7,
              color: 'var(--text)',
              maxHeight: 96,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              padding: '6px 8px',
              background: 'var(--bg-card)',
              borderRadius: 6
            }}
          >
            {suggestion.text}
          </div>
        </div>
      ) : null}
    </div>
  )
}
