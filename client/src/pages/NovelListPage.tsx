import { useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import type { NovelSummary } from '../types'
import { novelApi } from '../api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

export function NovelListPage(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [inspiration, setInspiration] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // P13 F1：主题化确认框
  const [confirmDelete, deleteDialog] = useConfirm()

  const novels = useQuery<{ novels: NovelSummary[] }>({
    queryKey: ['novels'],
    queryFn: novelApi.list
  })

  // P12 A2：失败任务徽章（有 failed job 的书显示"需恢复"）
  const jobs = useQuery({
    queryKey: ['jobs', 'list'],
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
      .catch(() => undefined)
      .finally(() => setCreating(false))
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
        <h1>AI 小说创作工作台</h1>
      </div>

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
        {error && <ErrorMsg error={error} />}
      </div>

      <div className="panel">
        <h2 className="mb-3">我的小说</h2>
        {novels.isLoading && <p className="muted">加载中…</p>}
        {novels.isError && (
          <div style={{ color: 'var(--danger)' }}>
            加载失败：{String(novels.error)}
            <button className="ml-2" onClick={() => void novels.refetch()}>重试</button>
          </div>
        )}
        {novels.data?.novels.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
            <div style={{ fontSize: 15, marginBottom: 6 }}>还没有小说</div>
            <div className="muted t-small">
              在上方输入一句灵感，AI 自动导演会帮你完成开书、设定与第一卷规划。
            </div>
          </div>
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
              role="button"
              tabIndex={0}
              className="panel"
              style={{ background: 'var(--bg-card)', cursor: 'pointer', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, transition: 'transform 150ms ease, border-color 150ms ease' }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'var(--border-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'var(--border)' }}
              onClick={() => navigate(`/novels/${n.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate(`/novels/${n.id}`)
                }
              }}
            >
              <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                {/* 封面色块（流派占位） */}
                <div
                  style={{
                    width: 46,
                    height: 58,
                    borderRadius: 8,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    fontWeight: 700,
                    color: 'var(--bg)',
                    background: `linear-gradient(135deg, var(--accent-bright), var(--accent))`
                  }}
                >
                  {(n.title || '未').slice(0, 1)}
                </div>
                <div className="flex-1">
                  <strong style={{ fontSize: 15, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.title || '未命名小说'}
                  </strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.inspiration.length > 60 ? n.inspiration.slice(0, 60) + '…' : n.inspiration}
                  </div>
                  {/* 进度条 */}
                  <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'var(--bg-input)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 300ms' }} />
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                    章节 {n.chaptersDone}/{n.chaptersTotal} · {pct}%
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
                      ⚠️ 需恢复
                    </button>
                  )}
                </div>
                <div className="row">
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
