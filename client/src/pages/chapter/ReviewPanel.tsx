import { CharStateAdd, FactionStateEdit } from './MemoryInputs'
import type { MemoryData } from './types'

// v0.25.0（审查 S1）：从 ChapterExecutionPage 拆出的审核结果与记忆面面板。

const SEVERITY_WEIGHT: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** 按 severity 排序取前 3 条优先建议 */
function topIssues(review: Record<string, unknown>): Array<Record<string, unknown>> {
  const issues = Array.isArray(review.issues) ? (review.issues as Array<Record<string, unknown>>) : []
  return issues
    .slice()
    .sort((a, b) => (SEVERITY_WEIGHT[String(a.severity)] ?? 3) - (SEVERITY_WEIGHT[String(b.severity)] ?? 3))
    .slice(0, 3)
}

/** 审核结果（评分 + 优先建议一键采纳重写 + 全部问题列表） */
export function ReviewResultPanel({
  review,
  streaming,
  busy,
  onAdopt
}: {
  review: Record<string, unknown>
  streaming: boolean
  busy: boolean
  onAdopt: (advice: string) => void
}): React.JSX.Element {
  const issues = Array.isArray(review.issues) ? (review.issues as Array<Record<string, unknown>>) : []
  const hasIssues = issues.length > 0
  return (
    <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
      <div className="row justify-between">
        <strong>审核结果</strong>
        <span className="badge">评分 {String(review.score)}</span>
      </div>
      {hasIssues && (
        <>
          {/* P19 ⑧：优先优化建议（severity 排序 top 3，一键采纳重写） */}
          <div style={{ marginTop: 10, fontSize: 12 }}>
            <span style={{ fontWeight: 600, color: 'var(--accent-bright)' }}>优先优化建议（按优先级）</span>
            <ol style={{ margin: '6px 0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {topIssues(review).map((issue, i) => (
                <li key={i}>
                  {String(issue.problem)} <span className="muted">→ {String(issue.suggestion)}</span>
                </li>
              ))}
            </ol>
          </div>
          <button
            className="sm"
            style={{ marginTop: 10, color: 'var(--accent-bright)', borderColor: 'var(--accent)' }}
            disabled={streaming || busy}
            onClick={() => {
              const advice = topIssues(review)
                .map((i) => `${String(i.location)}：${String(i.problem)}（建议：${String(i.suggestion)}）`)
                .join('；')
              onAdopt(advice)
            }}
          >
            采纳建议并重写
          </button>
          <div style={{ marginTop: 10, borderTop: '1px solid var(--border)' }}>
            {issues.map((issue, i) => (
              <div key={i} style={{ marginTop: 8, fontSize: 12, paddingTop: 8 }}>
                <span
                  className="badge"
                  style={
                    issue.severity === 'high'
                      ? { color: 'var(--danger)', background: 'var(--danger-soft)' }
                      : {}
                  }
                >
                  {String(issue.severity)}
                </span>
                <div style={{ marginTop: 4 }}>{String(issue.problem)}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  建议：{String(issue.suggestion)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** v0.20.0：记忆面（角色状态 / 势力状态 / 待确认事实——可手动修正） */
export function MemoryPanel({
  memory,
  patchBusy,
  onPatchCharState,
  onPatchFactionState,
  onClose
}: {
  memory: MemoryData | null
  patchBusy: boolean
  onPatchCharState: (name: string, state: string, remove: boolean) => void
  onPatchFactionState: (name: string, state: string) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
      <div className="row justify-between">
        <strong>记忆面</strong>
        <button onClick={onClose} style={{ fontSize: 12, padding: '2px 6px' }}>
          关闭
        </button>
      </div>
      <div className="muted" style={{ fontSize: 11, margin: '6px 0' }}>
        状态机显式视图——AI 回灌与手动修正共用同一账本；可增删角色状态、修正势力状态。
      </div>
      {memory && (
        <>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            <span className="muted">角色状态：</span>
            {memory.characters.filter((c) => c.states.length > 0).length === 0 && (
              <span className="muted">（暂无——运行「状态回灌提取」后生成）</span>
            )}
            {memory.characters
              .filter((c) => c.states.length > 0)
              .map((c) => (
                <div
                  key={c.name}
                  className="row"
                  style={{ gap: 6, flexWrap: 'wrap', padding: '3px 0', alignItems: 'center' }}
                >
                  <strong style={{ minWidth: 90 }}>{c.name}</strong>
                  {c.states.map((s) => (
                    <span
                      key={s}
                      className="badge"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent-bright)' }}
                    >
                      {s}
                      <button
                        style={{
                          marginLeft: 4,
                          background: 'none',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: 0
                        }}
                        disabled={patchBusy}
                        onClick={() => onPatchCharState(c.name, s, true)}
                        title="删除此状态"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <CharStateAdd
                    name={c.name}
                    disabled={patchBusy}
                    onAdd={(s) => onPatchCharState(c.name, s, false)}
                  />
                </div>
              ))}
          </div>
          <div style={{ fontSize: 12, marginTop: 10 }}>
            <span className="muted">势力状态：</span>
            {memory.factions.length === 0 && <span className="muted">（世界观未生成势力）</span>}
            {memory.factions.map((f) => (
              <div
                key={f.name}
                className="row"
                style={{ gap: 6, flexWrap: 'wrap', padding: '3px 0', alignItems: 'center' }}
              >
                <strong style={{ minWidth: 90 }}>{f.name}</strong>
                <span className="muted">{f.currentState || '（无）'}</span>
                <FactionStateEdit
                  current={f.currentState}
                  disabled={patchBusy}
                  onSave={(s) => onPatchFactionState(f.name, s)}
                />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, marginTop: 10 }}>
            <span className="muted">待确认事实（{memory.pendingFacts.length}）：</span>
            {memory.pendingFacts.map((f) => (
              <div key={f.id}>• {f.content}</div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
