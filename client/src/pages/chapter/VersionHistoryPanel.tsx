import type { VersionDiffInfo } from '../../types'
import type { ChapterVersion } from './types'

// v0.25.0（审查 S1）：从 ChapterExecutionPage 拆出的版本历史面板。
// 数据操作（查看/恢复/对比）由主页面以 actions 注入，本组件只负责呈现与交互编排。

// 传入完整版本对象而非仅 id——「查看」需要 note/createdAt 组装详情标题
export interface VersionActions {
  view: (v: ChapterVersion) => void
  restore: (v: ChapterVersion) => void
  diff: (v: ChapterVersion) => void
}

export function VersionHistoryPanel({
  versions,
  versionDiff,
  busy,
  streaming,
  actions,
  onClose
}: {
  versions: ChapterVersion[] | null
  versionDiff: VersionDiffInfo | null
  busy: boolean
  streaming: boolean
  actions: VersionActions
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
      <div className="row justify-between">
        <strong>版本历史</strong>
        <button onClick={onClose} style={{ fontSize: 12, padding: '2px 6px' }}>
          关闭
        </button>
      </div>
      {versions && versions.length === 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          暂无版本（生成正文时会自动存快照）
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {versions?.map((v) => (
          <div
            key={v.id}
            style={{ fontSize: 12, padding: '6px 10px', background: 'var(--bg-panel)', borderRadius: 6 }}
          >
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
              <span className="badge">#{v.id}</span>
              <span className="muted t-small">
                {v.note} · {v.createdAt} · {v.wordCount} 字
              </span>
            </div>
            <div
              className="muted"
              style={{
                fontSize: 11,
                marginTop: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {v.preview}
            </div>
            {/* P20（U1）：查看全文 + 恢复此版本（版本历史可用了） */}
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <button className="sm" disabled={busy} onClick={() => actions.view(v)}>
                查看
              </button>
              <button
                className="sm"
                style={{ color: 'var(--accent-bright)', borderColor: 'var(--accent)' }}
                disabled={busy || streaming}
                onClick={() => actions.restore(v)}
              >
                恢复
              </button>
              {/* v0.24.2（F3）：对比当前——恢复前检视差异 */}
              <button className="sm" disabled={busy} onClick={() => actions.diff(v)}>
                对比当前
              </button>
            </div>
            {versionDiff?.versionId === v.id && (
              <div
                style={{
                  marginTop: 6,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  maxHeight: 280,
                  overflow: 'auto',
                  fontSize: 11,
                  lineHeight: 1.6,
                  background: 'var(--bg)'
                }}
              >
                <div
                  className="muted t-small"
                  style={{
                    padding: '4px 8px',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--bg-card)',
                    borderBottom: '1px solid var(--border)'
                  }}
                >
                  v{v.id} vs 当前：+{versionDiff.added} / -{versionDiff.removed}
                  {versionDiff.degraded ? '（差异过大，仅逐行对照）' : ''}
                </div>
                {versionDiff.lines.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '1px 8px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      background:
                        l.type === 'add'
                          ? 'var(--ok-soft)'
                          : l.type === 'del'
                            ? 'var(--danger-soft)'
                            : undefined,
                      color:
                        l.type === 'add'
                          ? 'var(--ok)'
                          : l.type === 'del'
                            ? 'var(--danger)'
                            : 'var(--text-dim)'
                    }}
                  >
                    {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
                    {l.text || ' '}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
