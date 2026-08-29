import { useState } from 'react'
import { BookOpenText, Users, Map, Scale } from 'lucide-react'
import { novelApi, styleApi } from '../../api'
import type { ChapterSummary, WorldData } from '../../types'
import { BookSearchPanel } from './BookSearchPanel'
import { ChapterListItem } from './ChapterListItem'
import { Loading } from '../../components/Loading'
import type { ResourceDetail, ResourceTabKey } from './types'

// v0.25.0（审查 S1）：从 ChapterExecutionPage 拆出的左栏资源树。
// 自带 6 个 useState（resourceTab/角色/设定/规则/loading/error）——这些状态仅服务于本面板，
// 移出后主页面不再因资源树加载而整体重渲染。

const TABS: Array<[ResourceTabKey, string, typeof BookOpenText]> = [
  ['chapters', '章节', BookOpenText],
  ['characters', '角色', Users],
  ['world', '设定', Map],
  ['rules', '规则', Scale]
]

function profileToBody(profile: Record<string, unknown>): string {
  return Object.entries(profile)
    .map(([k, v]) => `${k}：${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n')
}

export function ResourcePanel({
  novelId,
  hidden,
  chapters,
  loading,
  error,
  selectedChapter,
  onSelectChapter,
  onShowDetail,
  onNewChapter,
  onOpenWorkspace
}: {
  novelId: number
  hidden: boolean
  chapters: ChapterSummary[]
  loading: boolean
  error: unknown
  selectedChapter: number | null
  onSelectChapter: (id: number) => void
  onShowDetail: (detail: ResourceDetail) => void
  onNewChapter: () => void
  onOpenWorkspace: () => void
}): React.JSX.Element {
  const [resourceTab, setResourceTab] = useState<ResourceTabKey>('chapters')
  const [resourceChars, setResourceChars] = useState<Array<{ id: number; name: string; status: string; profile: Record<string, unknown> }> | null>(null)
  const [resourceWorld, setResourceWorld] = useState<WorldData | null>(null)
  const [resourceRules, setResourceRules] = useState<Array<{ id: number; name: string; features: Array<Record<string, unknown>> }> | null>(null)
  const [resourceLoading, setResourceLoading] = useState(false)
  const [resourceError, setResourceError] = useState<string | null>(null)

  // D1：加载资源（角色/设定/规则）（P9 B5：loading + 错误 + 重试三态）
  const loadResourceTab = async (tab: ResourceTabKey): Promise<void> => {
    setResourceTab(tab)
    setResourceError(null)
    try {
      if (tab === 'characters' && !resourceChars) {
        setResourceLoading(true)
        const r = await novelApi.characters(novelId)
        setResourceChars(r.characters)
      } else if (tab === 'world' && !resourceWorld) {
        setResourceLoading(true)
        const r = await novelApi.world(novelId)
        setResourceWorld(r.world)
      } else if (tab === 'rules' && !resourceRules) {
        setResourceLoading(true)
        const r = await styleApi.list(novelId)
        setResourceRules(r.assets)
      }
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : String(err))
    } finally {
      setResourceLoading(false)
    }
  }

  const errorBlock = (retryTab: ResourceTabKey): React.JSX.Element => (
    <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
      加载失败：{resourceError}
      <button className="sm ml-2" onClick={() => void loadResourceTab(retryTab)}>
        重试
      </button>
    </div>
  )

  return (
    <div
      style={{
        width: 260,
        borderRight: '1px solid var(--border)',
        padding: 12,
        overflowY: 'auto',
        background: 'var(--bg-panel)',
        display: hidden ? 'none' : undefined
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {TABS.map(([k, label, Icon]) => (
            <button
              key={k}
              className={`nav-tab${resourceTab === k ? ' active' : ''}`}
              onClick={() => void loadResourceTab(k)}
            >
              <Icon size={12} className="icon-gap" />
              {label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {/* P23（N2）：手动新建章节 */}
          <button className="sm" title="手动新建空章节（可改标题后生成正文）" onClick={onNewChapter}>
            + 章节
          </button>
          <button className="sm" onClick={onOpenWorkspace}>
            工作台
          </button>
        </div>
      </div>

      {resourceTab === 'chapters' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* v0.24.2（F2）：书内全文检索 */}
          <BookSearchPanel novelId={novelId} onSelectChapter={(cid) => onSelectChapter(cid)} />
          {chapters.map((c) => (
            // P22-C1：memo 化列表项（100+ 章时避免整列表重渲染）
            <ChapterListItem
              key={c.id}
              c={c}
              selected={selectedChapter === c.id}
              onSelect={() => onSelectChapter(c.id)}
            />
          ))}
          {loading && <Loading label="章节加载中…" lines={3} />}
          {error !== undefined && error !== null && (
            <p className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
              加载失败：{String(error)}
            </p>
          )}
          {!loading && !error && chapters.length === 0 && (
            <p className="muted t-small">还没有章节，请先在工作台生成章节清单。</p>
          )}
        </div>
      )}

      {resourceTab === 'characters' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {resourceLoading && <p className="muted t-small">加载中…</p>}
          {resourceError && errorBlock('characters')}
          {resourceChars?.map((c) => (
            <div
              key={c.id}
              // v0.17.0（审查 A21）：可点击 div 补键盘可达（参考 ChapterListItem 模式）
              role="button"
              tabIndex={0}
              onClick={() => onShowDetail({ title: c.name, body: profileToBody(c.profile) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onShowDetail({ title: c.name, body: profileToBody(c.profile) })
                }
              }}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                background: 'var(--bg-card)'
              }}
            >
              {c.name}
              <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                {c.status === 'pending' ? '待确认' : '正式'}
              </span>
            </div>
          ))}
          {resourceChars === null && !resourceLoading && !resourceError && (
            <p className="muted t-small">点击上方「👤 角色」加载</p>
          )}
        </div>
      )}

      {resourceTab === 'world' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {resourceLoading && <p className="muted t-small">加载中…</p>}
          {resourceError && errorBlock('world')}
          {resourceWorld &&
            Object.entries(resourceWorld.manual ?? {}).map(([k, v]) => (
              <div
                key={k}
                role="button"
                tabIndex={0}
                onClick={() => onShowDetail({ title: k, body: String(v) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onShowDetail({ title: k, body: String(v) })
                  }
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  background: 'var(--bg-card)'
                }}
              >
                {k}
              </div>
            ))}
          {resourceWorld === null && !resourceLoading && !resourceError && (
            <p className="muted t-small">点击上方「🌍 设定」加载</p>
          )}
        </div>
      )}

      {resourceTab === 'rules' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {resourceLoading && <p className="muted t-small">加载中…</p>}
          {resourceError && errorBlock('rules')}
          {resourceRules?.map((r) => (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() =>
                onShowDetail({
                  title: r.name,
                  body: r.features.map((f) => `✓ ${String(f.name)}：${String(f.description ?? '')}`).join('\n')
                })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onShowDetail({
                    title: r.name,
                    body: r.features.map((f) => `✓ ${String(f.name)}：${String(f.description ?? '')}`).join('\n')
                  })
                }
              }}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                background: 'var(--bg-card)'
              }}
            >
              {r.name}
            </div>
          ))}
          {resourceRules === null && !resourceLoading && !resourceError && (
            <p className="muted t-small">点击上方「📐 规则」加载</p>
          )}
        </div>
      )}
    </div>
  )
}
