import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { BarChart3, BookOpenCheck, CircleAlert, Coins, PenLine, ScrollText, Pin } from 'lucide-react'
import { novelApi } from '../api'
import type { NovelStats } from '../types'

// v0.24.4（A3）：写作统计面板——全书字数/AI 占比/卷分布/审核分分布/成本（零图表库，CSS bar 自绘）
const STATUS_COLOR: Record<string, string> = {
  planned: 'var(--text-dim)',
  imported: 'var(--text-dim)',
  written: 'var(--accent)',
  reviewed: 'var(--ok)',
  done: 'var(--ok)',
  failed: 'var(--danger)'
}
const STATUS_LABEL: Record<string, string> = {
  planned: '待生成',
  imported: '已导入',
  generating: '生成中',
  written: '已写',
  reviewed: '已审',
  done: '完成',
  failed: '失败'
}

function fmtW(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n)
}
function fmtCost(c: number): string {
  return `$${c.toFixed(4)}`
}

export function StatsPage(): React.JSX.Element {
  const { novelId } = useParams()
  const navigate = useNavigate()
  const id = Number(novelId)
  const stats = useQuery({
    queryKey: ['novel-stats', id],
    queryFn: () => novelApi.novelStats(id),
    enabled: id > 0
  })
  // v0.24.4（B5）：伏笔/事实账本（与章节页记忆面同源）
  const foreshadows = useQuery({
    queryKey: ['novel-foreshadows', id],
    queryFn: () => novelApi.novelForeshadows(id),
    enabled: id > 0
  })
  const data: NovelStats | undefined = stats.data
  const fs = foreshadows.data

  return (
    <div className="page" style={{ maxWidth: 1080, margin: '0 auto' }}>
      <h2 className="mb-2 row gap-2">
        <BarChart3 size={18} />
        写作统计{data ? ` · 《${data.title}》` : ''}
      </h2>
      <p className="muted t-small mb-2">全书数据洞察（字数/AI 占比/卷分布/审核分布/成本）——v0.24.4 新增</p>

      {stats.isLoading && <p className="muted">加载中…</p>}
      {stats.isError && (
        <p className="muted" style={{ color: 'var(--danger)' }}>
          加载失败：{String(stats.error)}
        </p>
      )}

      {data && (
        <>
          {/* 汇总卡 */}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {[
              {
                icon: <ScrollText size={14} />,
                label: '全书字数',
                value: fmtW(data.total.words),
                sub: `${data.total.written}/${data.total.chapters} 章已有正文`
              },
              {
                icon: <BookOpenCheck size={14} />,
                label: `AI ${fmtW(data.total.aiWords)} · 我的 ${fmtW(data.total.humanWords)}`,
                value:
                  data.total.words > 0
                    ? `${Math.round((data.total.aiWords / data.total.words) * 100)}% AI`
                    : '—',
                sub: '字数分离口径（当前内容 AI 来源/人工累计）'
              },
              {
                icon: <CircleAlert size={14} />,
                label: '质量债（未解决）',
                value: String(data.pendingDebts),
                sub: '提示词/审核/约束登记，可手动修复'
              },
              {
                icon: <PenLine size={14} />,
                label: '审核分样本',
                value: `${data.reviewScores.length} 章`,
                sub:
                  data.reviewScores.length > 0
                    ? `均值 ${Math.round(data.reviewScores.reduce((a, s) => a + s.score, 0) / data.reviewScores.length)} 分`
                    : '尚未审核'
              },
              {
                icon: <Coins size={14} />,
                label: '累计成本',
                value: fmtCost(data.usage.cost),
                sub: `${data.usage.calls} 次调用 · ${fmtW(data.usage.tokens)} tokens`
              }
            ].map((c) => (
              <div key={c.label} className="panel" style={{ minWidth: 180, flex: '1 1 180px', padding: 14 }}>
                <div className="row gap-2 muted t-small" style={{ marginBottom: 6 }}>
                  {c.icon}
                  {c.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{c.value}</div>
                <div className="muted t-small" style={{ marginTop: 4 }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* 卷分布 */}
          <div className="panel" style={{ marginTop: 14, padding: 14 }}>
            <strong className="t3">卷分布（字数 vs 章节数）</strong>
            <div className="col" style={{ gap: 8, marginTop: 10 }}>
              {data.byVolume.length === 0 && <p className="muted t-small">还没有卷。</p>}
              {data.byVolume.map((v) => {
                const maxWords = Math.max(...data.byVolume.map((x) => x.words), 1)
                return (
                  <div key={v.id} className="row" style={{ alignItems: 'center', gap: 10 }}>
                    <span className="muted t-small" style={{ width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.title || `卷 #${v.id}`}
                    </span>
                    <div style={{ flex: 1, height: 16, background: 'var(--bg)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(v.words / maxWords) * 100}%`, background: 'var(--accent)', opacity: 0.85 }} />
                    </div>
                    <span className="muted t-small" style={{ width: 110, textAlign: 'right' }}>
                      {fmtW(v.words)} · {v.count} 章
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="row" style={{ gap: 14, marginTop: 14, alignItems: 'stretch' }}>
            {/* 状态分布 */}
            <div className="panel" style={{ padding: 14, flex: 1 }}>
              <strong className="t3">章节状态</strong>
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {data.byStatus.map((s) => (
                  <span key={s.status} className="badge" style={{ color: STATUS_COLOR[s.status] ?? 'var(--text)' }}>
                    {STATUS_LABEL[s.status] ?? s.status} ×{s.count}（{fmtW(s.words)} 字）
                  </span>
                ))}
                {data.byStatus.length === 0 && <p className="muted t-small">暂无章节。</p>}
              </div>
            </div>
            {/* 审核分布 */}
            <div className="panel" style={{ padding: 14, flex: 1.6 }}>
              <strong className="t3">审核分布（每点 = 一章，hover 看题）</strong>
              {data.reviewScores.length === 0 ? (
                <p className="muted t-small" style={{ marginTop: 10 }}>尚无审核数据。</p>
              ) : (
                <div className="row" style={{ gap: 3, marginTop: 12, alignItems: 'flex-end', minHeight: 120, flexWrap: 'wrap' }}>
                  {data.reviewScores.map((r) => (
                    <div
                      key={r.chapterId}
                      title={`${r.title}：${r.score} 分`}
                      style={{
                        width: 7,
                        height: Math.max(6, (r.score / 100) * 110),
                        borderRadius: 2,
                        background: r.score < 60 ? 'var(--danger)' : r.score < 75 ? 'var(--warn)' : 'var(--ok)',
                        cursor: 'pointer'
                      }}
                      onClick={() => navigate(`/novels/${id}/chapters`)}
                    />
                  ))}
                </div>
              )}
              <p className="muted t-small" style={{ marginTop: 8 }}>
                <span style={{ color: 'var(--ok)' }}>■</span> ≥75 达标 ·{' '}
                <span style={{ color: 'var(--warn)' }}>■</span> 60-74（有 high 才自动修）·{' '}
                <span style={{ color: 'var(--danger)' }}>■</span> &lt;60 必修
              </p>
            </div>
          </div>

          {/* v0.24.4（B5）：伏笔看板——状态分组，点击跳转章节 */}
          <div className="panel" style={{ marginTop: 14, padding: 14 }}>
            <strong className="t3 row gap-2"><Pin size={13} />伏笔账本（{fs?.foreshadows.length ?? '…'} 条 · 未回收 {fs?.foreshadows.filter((f) => f.status === 'laid').length ?? '…'}）</strong>
            {fs === undefined && <p className="muted t-small" style={{ marginTop: 8 }}>加载中…</p>}
            {fs && fs.foreshadows.length === 0 && <p className="muted t-small" style={{ marginTop: 8 }}>暂无伏笔（回灌自动记录；章节页「记忆面」可手动增删）。</p>}
            {fs && fs.foreshadows.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginTop: 10 }}>
                {fs.foreshadows.map((f) => (
                  <div
                    key={f.id}
                    className="panel"
                    style={{
                      padding: '8px 10px',
                      background: f.status === 'paid' ? 'color-mix(in srgb, var(--ok) 8%, var(--bg-panel))' : 'var(--bg-panel)',
                      cursor: f.chapterId ? 'pointer' : 'default'
                    }}
                    title={f.chapterId ? `跳转至《${f.chapterTitle ?? '第' + f.chapterId + ' 章'}》` : undefined}
                    onClick={() => { if (f.chapterId) navigate(`/novels/${id}/chapters`) }}
                  >
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <span className="badge" style={{ color: f.status === 'paid' ? 'var(--ok)' : 'var(--warn)' }}>
                        {f.status === 'paid' ? '已回收' : f.status === 'laid' ? '待回收' : f.status}
                      </span>
                      <span className="muted t-small">{f.chapterTitle ?? '（未关联章节）'}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>{f.content}</div>
                  </div>
                ))}
              </div>
            )}
            {fs && fs.facts.length > 0 && (
              <p className="muted t-small" style={{ marginTop: 10 }}>已确认事实 {fs.facts.length} 条（最新 {fs.facts[0]?.content?.slice(0, 40) ?? ''}…）</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
