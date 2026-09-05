import { useState, useRef } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { novelApi, waitForJob } from '../api'
import { useActionRun } from '../hooks/useActionRun'
import { usePrompt } from '../components/PromptDialog'
import { useConfirm } from '../components/useConfirm'
import type { ChapterSummary } from '../types'

export function VolumePanel({ novelId }: { novelId: number }): React.JSX.Element {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // v0.22.0（审查 ALOW）：themed confirm 统一
  const [confirmFn, confirmDialog] = useConfirm()
  const [error, setError] = useState<string | null>(null)
  const { prompt: askTitle, element: promptElement } = usePrompt()
  const [chaptersPerVolume, setChaptersPerVolume] = useState(20)
  const [expandedVol, setExpandedVol] = useState<number | null>(null)
  // P12 A4：批量细化范围
  const [rangeFrom, setRangeFrom] = useState(0)
  const [rangeTo, setRangeTo] = useState(0)
  // v0.20.0：故事板视图（卷章卡片化）
  const [view, setView] = useState<'list' | 'storyboard'>('list')
  // v0.23.1（批次 D2）：批量细化结果摘要（job 终态后展示）
  const [refineSummary, setRefineSummary] = useState<string | null>(null)

  const volumes = useQuery({
    queryKey: ['volumes', novelId],
    queryFn: () => novelApi.volumes(novelId)
  })
  const chapters = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => novelApi.chapters(novelId)
  })

  const allChapters = chapters.data?.chapters ?? []
  const inval = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['volumes', novelId] })
    await queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
  }

  // v0.23.1（批次 E3）：共享 useActionRun（ref 守卫防同帧双击——此前 state-only 实现可双跑）
  const { busy, run } = useActionRun({
    onStart: () => setError(null),
    onError: (msg) => setError(msg),
    onDone: () => inval()
  })

  const genVolumes = useMutation({
    mutationFn: () => novelApi.volumesGenerate(novelId, Math.min(40, Math.max(5, Number(chaptersPerVolume) || 20))),
    onSuccess: async () => inval(),
    onError: (err) => setError(err instanceof Error ? err.message : String(err))
  })

  const refineChapter = async (chapterId: number): Promise<void> => {
    await run(`refine-${chapterId}`, () => novelApi.chapterRefine(novelId, chapterId))
  }

  const patchChapter = async (chapterId: number, patch: Record<string, unknown>): Promise<void> => {
    // v0.17.0（审查 A10）：try/catch——此前失败为未处理 rejection（ChapterRow onPatch 无兜底）
    try {
      await novelApi.chapterPatch(novelId, chapterId, patch)
      await inval()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      {promptElement}
      <div className="col">
      {error && <ErrorMsg error={error} />}

      <div className="panel">
        <div className="row justify-between">
          <h2>整本卷规划</h2>
          <div className="row">
            <input
              type="number"
              style={{ width: 90 }}
              min={5}
              max={40}
              value={chaptersPerVolume}
              onChange={(e) => setChaptersPerVolume(e.target.value === '' ? 0 : Number(e.target.value))}
              title="每卷章数（可改）"
            />
            <span className="muted t-small">每卷章数</span>
            <button
              className="primary"
              disabled={busy !== null}
              onClick={() => {
                void run('volumes', () => genVolumes.mutateAsync())
              }}
            >
              {busy === 'volumes' ? '生成中…' : 'AI 生成卷规划'}
            </button>
            {/* P23（N3）+ P27 0b：手动新建卷（应用内对话框） */}
            <button
              className="sm"
              disabled={busy !== null}
              onClick={() => {
                void askTitle({ title: '新卷标题', placeholder: '输入卷标题后确定' }).then((t) => {
                  if (!t?.trim()) return
                  void run('volume-create', () => novelApi.volumeCreate(novelId, t.trim()))
                })
              }}
            >
              + 手动建卷
            </button>
          </div>
        </div>
        <p className="muted t-small">先生成卷规划，再逐卷生成节奏板和章节清单（章节名 AI 生成多样约束，可手动修改）。</p>

        {volumes.data?.volumes.map((v) => (
          <div key={v.id} className="panel" style={{ marginTop: 12, background: 'var(--bg-card)' }}>
            <div className="row justify-between">
              <div>
                <strong>第 {v.orderIndex + 1} 卷 · {v.title}</strong>
                {Boolean(v.strategy.theme) && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>主题：{String(v.strategy.theme)}</div>
                )}
                {Boolean(v.strategy.critique) && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    <span className="badge" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                      评审 {(v.strategy.critique as { score?: number }).score ?? '—'} 分
                    </span>
                    {(v.strategy.critique as { risks?: string[] }).risks?.slice(0, 2).map((r, i) => (
                      <span key={i} className="muted" style={{ fontSize: 11, marginLeft: 8 }}>⚠ {r}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="row">
                <button onClick={() => setExpandedVol(expandedVol === v.id ? null : v.id)}>
                  {expandedVol === v.id ? '收起' : '展开'}
                </button>
                {/* v0.17.0（审查 A10）：每卷操作按钮加 busy 门控——此前可连点并发 */}
                <button disabled={busy !== null} onClick={() => void run(`genbeats-${v.id}`, () => novelApi.beatsGenerate(novelId, v.id))}>
                  {busy === `genbeats-${v.id}` ? '生成中…' : '生成节奏板'}
                </button>
                <button disabled={busy !== null} onClick={() => void run(`critique-${v.id}`, () => novelApi.volumeCritique(novelId, v.id))}>
                  {busy === `critique-${v.id}` ? '评审中…' : '评审卷战略'}
                </button>
                <button disabled={busy !== null} onClick={() => void run(`genchapters-${v.id}`, () => novelApi.chaptersGenerate(novelId, v.id))}>
                  {busy === `genchapters-${v.id}` ? '生成中…' : '生成章节清单'}
                </button>
                <button
                  className="danger"
                  disabled={busy !== null}
                  onClick={() => {
                    confirmFn({ title: '删除卷', message: `确定删除卷「${v.title || `第 ${v.id} 卷`}」？卷下章节与节奏板将被移除，该操作不可恢复。`, confirmText: '删除', danger: true, action: () => void run(`delvol-${v.id}`, () => novelApi.volumeDelete(novelId, v.id)) })
                  }}
                >
                  删除
                </button>
              </div>
            </div>

            {expandedVol === v.id && <VolumeDetail novelId={novelId} volId={v.id} />}
          </div>
        ))}
      </div>

      {/* 全书章节一览（v0.20.0：列表 / 故事板卡片视图切换） */}
      <div className="panel">
        <div className="row justify-between flex-wrap gap-2">
          <h2>全书章节（{allChapters.length}）</h2>
          <div className="row flex-wrap">
            <button
              className="sm"
              onClick={() => setView(view === 'storyboard' ? 'list' : 'storyboard')}
              title="故事板：卷章卡片化可视化脉络"
            >
              {view === 'storyboard' ? '列表视图' : '故事板视图'}
            </button>
            <input
              type="number"
              min={1}
              style={{ width: 70 }}
              placeholder="起"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value === '' ? 0 : Number(e.target.value))}
            />
            <span className="muted">—</span>
            <input
              type="number"
              min={1}
              style={{ width: 70 }}
              placeholder="止"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value === '' ? 0 : Number(e.target.value))}
            />
            <button
              className="sm"
              disabled={busy !== null || rangeFrom <= 0 || rangeTo <= 0 || rangeFrom > rangeTo}
              onClick={() => {
                const from = Math.max(1, Math.min(rangeFrom, allChapters.length))
                const to = Math.max(from, Math.min(rangeTo, allChapters.length))
                // v0.23.1（批次 D2）：批量细化迁 job 队列——入队后轮询至终态（可到任务中心取消）
                void run(`refine-range`, async () => {
                  const { jobId } = await novelApi.refineRange(novelId, from, to)
                  const job = await waitForJob(jobId)
                  if (job.status === 'failed') throw new Error(job.error ?? '批量细化失败')
                  if (job.status === 'cancelled') throw new Error('批量细化已取消（已细化部分保留，可重跑续接）')
                  const r = (job.result ?? {}) as { done?: number[]; skipped?: number[] }
                  setRefineSummary(`批量细化完成：新细化 ${r.done?.length ?? 0} 章、跳过（已有任务单）${r.skipped?.length ?? 0} 章`)
                })
              }}
            >
              {busy === 'refine-range' ? '批量细化中…' : '批量细化'}
            </button>
            <button onClick={() => navigate(`/novels/${novelId}/chapters`)}>
              进入章节执行 →
            </button>
          </div>
        </div>
        {busy === 'refine-range' && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            批量细化中（已细化的章节自动跳过，中断后可重跑续接；可在任务中心取消）…
          </p>
        )}
        {refineSummary && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {refineSummary}
          </p>
        )}
        {view === 'storyboard' ? (
          // v0.20.0（NovelClaw 学习组）：故事板——按卷分组的章节卡片网格
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {(volumes.data?.volumes ?? []).map((v) => {
              const chapters = allChapters.filter((c) => c.volumeId === v.id)
              if (chapters.length === 0) return null
              return (
                <div key={v.id}>
                  <div className="t3" style={{ marginBottom: 6 }}>
                    第 {v.orderIndex + 1} 卷 · {v.title}（{chapters.length} 章）
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                    {chapters.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-m)',
                          background: 'var(--bg-card)',
                          border: `1px solid ${c.status === 'written' || c.status === 'reviewed' || c.status === 'done' ? 'color-mix(in srgb, var(--ok) 35%, transparent)' : c.status === 'failed' ? 'color-mix(in srgb, var(--danger) 35%, transparent)' : 'var(--border)'}`
                        }}
                      >
                        <div className="muted t-small">{c.id}</div>
                        <div style={{ fontSize: 12, lineHeight: 1.5, fontWeight: 600 }}>{c.title}</div>
                        <div className="t-small" style={{ marginTop: 4 }}>
                          <span className="badge">
                            {statusLabelOf(c.status)}
                          </span>
                          <span className="muted" style={{ fontSize: 'var(--fs-11)', marginLeft: 6 }}>
                            {c.wordCount ? `${c.wordCount} 字` : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {allChapters.length === 0 && <p className="muted t-small">暂无章节——先生成卷规划与章节清单。</p>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {allChapters.map((c) => (
              <ChapterRow
                key={c.id}
                chapter={c}
                busy={busy === `refine-${c.id}`}
                onRefine={() => void refineChapter(c.id)}
                onPatch={(patch) => void patchChapter(c.id, patch)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    {confirmDialog}
    </>
  )
}

// v0.20.0：故事板卡片状态文案（与 ChapterRow 一致）
const STORY_STATUS: Record<string, string> = {
  planned: '已规划',
  refined: '已细化',
  generating: '生成中',
  written: '已写正文',
  reviewed: '已审核',
  failed: '失败',
  done: '完成'
}
function statusLabelOf(s: string): string {
  return STORY_STATUS[s] ?? s
}

function VolumeDetail({ novelId, volId }: { novelId: number; volId: number }): React.JSX.Element {
  const beats = useQuery({
    queryKey: ['beats', novelId, volId],
    queryFn: () => novelApi.beats(novelId, volId)
  })
  return (
    <div style={{ marginTop: 10 }}>
      {beats.data && beats.data.beats.length > 0 && (
        <div className="col gap-2">
          <strong className="t3">节奏板</strong>
          {beats.data.beats.map((b) => (
            <div key={b.id} style={{ fontSize: 12, padding: '6px 10px', background: 'var(--bg-panel)', borderRadius: 6 }}>
              <strong>{b.orderIndex + 1}. {b.title}</strong>
              <span className="muted"> — {b.summary}</span>
            </div>
          ))}
        </div>
      )}
      {beats.data && beats.data.beats.length === 0 && (
        <p className="muted t-small">本卷还没有节奏板，点击"生成节奏板"。</p>
      )}
    </div>
  )
}

function ChapterRow({
  chapter,
  busy,
  onRefine,
  onPatch
}: {
  chapter: ChapterSummary
  busy: boolean
  onRefine: () => void
  onPatch: (patch: Record<string, unknown>) => void
}): React.JSX.Element {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(chapter.title)
  // v0.17.0（审查 A10）：Enter 提交后 blur 双发去重（参考 ChapterExecutionPage titleSubmittedRef 模式）
  const titleSubmittedRef = useRef(false)
  const statusLabel: Record<string, string> = {
    planned: '已规划',
    refined: '已细化',
    generating: '生成中',
    written: '已写正文',
    reviewed: '已审核',
    failed: '失败',
    done: '完成'
  }
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span className="badge">{statusLabel[chapter.status] ?? chapter.status}</span>
        {editingTitle ? (
          <input
            style={{ width: 220 }}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              // v0.17.0（审查 A10）：Enter 已提交则跳过 blur 双发
              if (titleSubmittedRef.current) {
                titleSubmittedRef.current = false
                return
              }
              onPatch({ title: titleDraft })
              setEditingTitle(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // v0.17.0（审查 A10）：先置位再 blur——blur 同步触发 onBlur 时靠标记跳过双发
                titleSubmittedRef.current = true
                e.currentTarget.blur()
                onPatch({ title: titleDraft })
                setEditingTitle(false)
              }
            }}
          />
        ) : (
          <strong
            style={{ cursor: 'pointer' }}
            onClick={() => {
              setTitleDraft(chapter.title)
              setEditingTitle(true)
            }}
            title="点击改名"
          >
            {chapter.title || `（第 ${chapter.id} 章，点击命名）`}
          </strong>
        )}
        {chapter.volumeTitle && <span className="muted t-small">{chapter.volumeTitle}</span>}
        {chapter.beatTitle && <span className="muted t-small">{chapter.beatTitle}</span>}
        {chapter.wordCount > 0 && <span className="muted t-small">{chapter.wordCount} 字</span>}
      </div>
      <button disabled={busy} onClick={onRefine} title="AI 细化本章任务单">
        {busy ? '细化中…' : '细化'}
      </button>
    </div>
  )
}
