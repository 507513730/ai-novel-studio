import { useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BookOpen, TriangleAlert } from 'lucide-react'
import type { NovelSummary } from '../types'
import { novelApi, apiFetch } from '../api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
// v0.23.1（批次 B6）：主角名提取统一 utils（此前双实现且正则漂移）
import { extractProtagonistName } from '../utils/protagonist'

// 批次 B：相对时间（书卡「最近打开」展示——书架扫读时的关键上下文）
function relativeTime(value: string): string {
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return ''
  const min = Math.floor((Date.now() - t) / 60_000)
  if (min < 1) return '刚刚打开'
  if (min < 60) return `${min} 分钟前打开`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前打开`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前打开`
  return `${new Date(t).toLocaleDateString()} 打开`
}

export function NovelListPage(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [inspiration, setInspiration] = useState('')
  // v0.15.0：建书时可选硬性要求（每行一条→自动转 must 约束）
  const [hardReqs, setHardReqs] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  // v0.24.4（A6）：演示书载入
  const [demoBusy, setDemoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // P13 F1：主题化确认框
  const [confirmDelete, deleteDialog] = useConfirm()

  const novels = useQuery<{ novels: NovelSummary[] }>({
    queryKey: ['novels'],
    queryFn: novelApi.list
  })

  // P12 A2：失败任务徽章（有 failed job 的书显示"需恢复"）
  // v0.23.1（批次 E5）：统一共享 ['jobs'] 缓存（与 AppLayout/TasksPage/跟随页同源，轮询合并）
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: novelApi.jobs,
    refetchInterval: 6000
  })
  const failedNovelIds = new Set(
    (jobs.data?.jobs ?? []).filter((j) => j.status === 'failed').map((j) => Number(j.payload.novelId ?? 0)).filter(Boolean)
  )

  const createNovel = useMutation({
    mutationFn: novelApi.create,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['novels'] })
      navigate(`/novels/${data.id}`)
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err))
  })

  const submitCreate = (): void => {
    const insp = inspiration.trim()
    if (!insp || creating || createNovel.isPending) return
    setCreating(true)
    setError(null)
    void createNovel
      .mutateAsync(insp)
      .then(async (data) => {
        // v0.15.0：硬性要求（每行一条）→ 创建后立即设为 must 约束
        const reqs = hardReqs
          .split('\n')
          .map((r) => r.trim())
          .filter(Boolean)
        if (reqs.length > 0) {
          await novelApi.patch(data.id, {
            constraints: reqs.map((r) => {
              const canon = extractProtagonistName(r)
              return {
                id: `c${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                text: r,
                level: 'must' as const,
                enabled: true,
                createdAt: new Date().toISOString(),
                ...(canon ? { keyword: canon, replaceWith: canon } : {})
              }
            })
          })
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCreating(false))
  }

  return (
    <div className="page">
      {/* v0.26.0（审查 P1-7）：应用名由 titlebar 承载，页面直接从建书入口开始 */}

      <div className="panel" style={{ marginBottom: 20 }}>
        <h2 className="mb-3">开始新书：输入一句灵感</h2>
        <div className="row">
          <input
            className="flex-1"
            placeholder="例：一个失业程序员获得能读取他人欲望的异能，进入金融暗战……"
            value={inspiration}
            onChange={(e) => setInspiration(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate()
            }}
          />
          <button
            className="primary"
            disabled={creating || createNovel.isPending || !inspiration.trim()}
            onClick={submitCreate}
          >
            {creating || createNovel.isPending ? '创建中…' : '创建'}
          </button>
        </div>
        {/* v0.15.0：硬性要求（每行一条，建书即设为硬约束——全链强制，产出自动校验） */}
        <textarea
          rows={2}
          placeholder="硬性要求（可选，每行一条）：主角必须叫 Jing / 不许虐主 / 系统金手指克制……"
          value={hardReqs}
          onChange={(e) => setHardReqs(e.target.value)}
          style={{ width: '100%', marginTop: 8, resize: 'vertical' }}
        />
        <div className="muted t-small" style={{ marginTop: 4 }}>
          硬性要求会注入导演 / 方案 / 章节生成全链路并在产出后自动校验——可在书工作区「创作约束」随时增改。
        </div>
        {error && <ErrorMsg error={error} />}
      </div>

      <div className="panel">
        <h2 className="mb-3">我的小说</h2>
        {novels.isLoading && (
          <div className="col gap-2" aria-label="加载中">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton skeleton-text" style={{ width: `${88 - i * 18}%` }} />
            ))}
          </div>
        )}
        {novels.isError && <ErrorMsg error={`加载失败：${String(novels.error)}`} onRetry={() => void novels.refetch()} />}
        {novels.data?.novels.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title="还没有小说"
            desc="在上方输入一句灵感，AI 自动导演会帮你完成开书、设定与第一卷规划；或先载入演示书看看成品管线。"
            action={
              /* v0.24.4（A6）：演示书——零 LLM 的成品样例（1 卷 3 章 + 角色 + 世界观 + 伏笔） */
              <button
                className="primary"
                disabled={demoBusy}
                onClick={() => void (async () => {
                  setDemoBusy(true)
                  try {
                    await apiFetch('/novels/import-demo', { method: 'POST' })
                    toast('ok', '演示书已载入，可在「章节执行」浏览')
                    await queryClient.invalidateQueries({ queryKey: ['novels'] })
                  } catch (e) {
                    toast('error', e instanceof Error ? e.message : String(e))
                  } finally {
                    setDemoBusy(false)
                  }
                })()}
              >
                {demoBusy ? '载入中…' : '载入演示书'}
              </button>
            }
          />
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {/* P27 1-3：最近使用排序（lastOpenedAt 降序，无记录排后） */}
          {(novels.data?.novels ?? []).slice().sort((a, b) => {
            const ta = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0
            const tb = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0
            return tb - ta
          }).map((n) => {
            const pct = n.chaptersTotal > 0 ? Math.round((n.chaptersDone / n.chaptersTotal) * 100) : 0
            return (
            <div
              key={n.id}
              className="panel hoverable hover-lift"
              style={{ background: 'var(--bg-card)', cursor: 'pointer', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
              onClick={() => navigate(`/novels/${n.id}`)}
            >
              <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                {/* 封面色块（流派占位；批次 B：加大 + 内描边提升质感） */}
                <div
                  style={{
                    width: 50,
                    height: 64,
                    borderRadius: 8,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    fontWeight: 700,
                    color: 'var(--bg)',
                    background: 'linear-gradient(150deg, var(--accent-bright), var(--accent))',
                    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.14)'
                  }}
                >
                  {(n.title || '未').slice(0, 1)}
                </div>
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 'var(--fs-16)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.title || '未命名小说'}
                  </strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.inspiration.length > 60 ? n.inspiration.slice(0, 60) + '…' : n.inspiration}
                  </div>
                  {/* 进度条 + 百分比（批次 B：同行右对齐，数字层级提升） */}
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <div className="progress flex-1">
                      <div style={{ width: `${pct}%` }} />
                    </div>
                    <span className="muted" style={{ fontSize: 'var(--fs-11)', flexShrink: 0 }}>{pct}%</span>
                  </div>
                  <div className="muted" style={{ fontSize: 'var(--fs-11)', marginTop: 4 }}>
                    章节 {n.chaptersDone}/{n.chaptersTotal}
                    {n.lastOpenedAt ? ` · ${relativeTime(n.lastOpenedAt)}` : ''}
                  </div>
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 'auto' }}>
                <div className="row">
                  <span className="badge">角色 {n.characters}</span>
                  {failedNovelIds.has(n.id) && (
                    <button
                      className="sm"
                      style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/novels/${n.id}/director`)
                      }}
                    >
                      <TriangleAlert size={12} className="icon-gap" />
                      需恢复
                    </button>
                  )}
                </div>
                <div className="row">
                  {/* v0.17.0（审查 A16）：外层 role="button" div 内嵌 button 属无效 ARIA——外层改无 role，
                      键盘进入靠内层「进入」按钮（内层按钮均已 stopPropagation） */}
                  <button className="sm" onClick={(e) => { e.stopPropagation(); navigate(`/novels/${n.id}`) }}>进入</button>
                  <button
                    className="danger sm"
                    disabled={deleting !== null}
                    onClick={(e) => {
                      e.stopPropagation()
                      confirmDelete({
                        title: '删除小说',
                        message: `确定删除《${n.title || '未命名小说'}》？该操作不可恢复。`,
                        confirmText: '删除',
                        danger: true,
                        action: () => {
                          setDeleting(n.id)
                          void novelApi
                            .remove(n.id)
                            .then(() => {
                              toast('ok', '已删除')
                              void queryClient.invalidateQueries({ queryKey: ['novels'] })
                            })
                            .catch((err) => {
                              const msg = err instanceof Error ? err.message : String(err)
                              setError(msg)
                              toast('error', msg)
                            })
                            .finally(() => setDeleting(null))
                        }
                      })
                    }}
                  >
                    {deleting === n.id ? '删除中…' : '删除'}
                  </button>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      </div>
      {deleteDialog}
    </div>
  )
}
