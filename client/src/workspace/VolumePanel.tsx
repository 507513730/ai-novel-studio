import { useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { novelApi } from '../api'
import { usePrompt } from '../components/PromptDialog'
import type { ChapterSummary } from '../types'

export function VolumePanel({ novelId }: { novelId: number }): React.JSX.Element {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { prompt: askTitle, element: promptElement } = usePrompt()
  const [chaptersPerVolume, setChaptersPerVolume] = useState(20)
  const [expandedVol, setExpandedVol] = useState<number | null>(null)
  // P12 A4：批量细化范围
  const [rangeFrom, setRangeFrom] = useState(0)
  const [rangeTo, setRangeTo] = useState(0)

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

  const run = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await inval()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const genVolumes = useMutation({
    mutationFn: () => novelApi.volumesGenerate(novelId, Math.min(40, Math.max(5, Number(chaptersPerVolume) || 20))),
    onSuccess: async () => inval(),
    onError: (err) => setError(err instanceof Error ? err.message : String(err))
  })

  const refineChapter = async (chapterId: number): Promise<void> => {
    await run(`refine-${chapterId}`, () => novelApi.chapterRefine(novelId, chapterId))
  }

  const patchChapter = async (chapterId: number, patch: Record<string, unknown>): Promise<void> => {
    await novelApi.chapterPatch(novelId, chapterId, patch)
    await inval()
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
                setBusy('volumes')
                setError(null)
                void genVolumes.mutateAsync().finally(() => setBusy(null))
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
                  setBusy('volume-create')
                  setError(null)
                  void novelApi
                    .volumeCreate(novelId, t.trim())
                    .then(() => inval())
                    .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                    .finally(() => setBusy(null))
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
                <button onClick={() => void run(`genbeats-${v.id}`, () => novelApi.beatsGenerate(novelId, v.id))}>
                  {busy === `genbeats-${v.id}` ? '生成中…' : '生成节奏板'}
                </button>
                <button onClick={() => void run(`critique-${v.id}`, () => novelApi.volumeCritique(novelId, v.id))}>
                  {busy === `critique-${v.id}` ? '评审中…' : '评审卷战略'}
                </button>
                <button onClick={() => void run(`genchapters-${v.id}`, () => novelApi.chaptersGenerate(novelId, v.id))}>
                  {busy === `genchapters-${v.id}` ? '生成中…' : '生成章节清单'}
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (window.confirm(`确定删除卷「${v.title || `第 ${v.id} 卷`}」？卷下章节与节奏板将被移除，该操作不可恢复。`)) {
                      void run(`delvol-${v.id}`, () => novelApi.volumeDelete(novelId, v.id))
                    }
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

      {/* 全书章节一览 */}
      <div className="panel">
        <div className="row justify-between flex-wrap gap-2">
          <h2>全书章节（{allChapters.length}）</h2>
          <div className="row flex-wrap">
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
              className="primary"
              disabled={busy !== null || rangeFrom <= 0 || rangeTo < rangeFrom}
              onClick={() => {
                const from = Math.max(1, Math.min(rangeFrom, allChapters.length))
                const to = Math.max(from, Math.min(rangeTo, allChapters.length))
                void run(`refine-range`, () => novelApi.refineRange(novelId, from, to))
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
            批量细化中（已细化的章节自动跳过，中断后可重跑续接）…
          </p>
        )}
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
      </div>
    </div>
    </>
  )
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
              onPatch({ title: titleDraft })
              setEditingTitle(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
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
