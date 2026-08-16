import { useEffect, useRef, useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { novelApi } from '../api'
import { useActionRun } from '../hooks/useActionRun'

export function SetupPanel({ novelId, onDirtyChange }: { novelId: number; onDirtyChange?: (dirty: boolean) => void }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [selectedDirection, setSelectedDirection] = useState<string | null>(null)
  const [titles, setTitles] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const dirtyRef = useRef(false)
  const notifyDirty = (v: boolean): void => { dirtyRef.current = v; onDirtyChange?.(v) }
  const titleInitRef = useRef(false)
  const [notes, setNotes] = useState('')
  // P11-3：流派自定义
  const [addingGenre, setAddingGenre] = useState(false)
  const [newGenre, setNewGenre] = useState('')
  // v0.23.1（批次 E3）：addGenre 防重（ref 守卫——输入框 Enter 与保存按钮可在 disabled 生效前双发）
  const addGenreBusyRef = useRef(false)

  const detail = useQuery({
    queryKey: ['novel', novelId],
    queryFn: () => novelApi.detail(novelId)
  })
  const novel = detail.data?.novel

  // P9 D24：书名初始同步一次（novel 加载后）
  useEffect(() => {
    if (!titleInitRef.current && novel) {
      titleInitRef.current = true
      setTitle(novel.title !== '未命名小说' ? novel.title : '')
    }
  }, [novel])
  const directions = novel?.direction ?? []
  const framing = (novel?.framing ?? {}) as Record<string, unknown>
  const macro = (framing.macro ?? {}) as Record<string, unknown>

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['novel', novelId] })

  // P11-3：流派列表（全局预设 + 该书自定义）
  const genres = useQuery({
    queryKey: ['genres', novelId],
    queryFn: () => novelApi.genres(novelId)
  })

  const addGenre = async (): Promise<void> => {
    const name = newGenre.trim()
    if (!name) return
    // v0.23.1（批次 E3）：ref 守卫防双发（Enter + 按钮/连点）
    if (addGenreBusyRef.current) return
    addGenreBusyRef.current = true
    setError(null)
    try {
      await novelApi.genreCreate(name, novelId)
      setNewGenre('')
      setAddingGenre(false)
      await genres.refetch()
      await novelApi.patch(novelId, { genre: name })
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      addGenreBusyRef.current = false
    }
  }

  // v0.23.1（批次 E3）：共享 useActionRun（ref 守卫防同帧双击——此前 state-only 实现可双跑）
  const { busy, run } = useActionRun({
    onStart: () => setError(null),
    onError: (msg) => setError(msg),
    onDone: () => invalidate()
  })

  const genTitles = async (direction: unknown): Promise<void> => {
    // v0.17.0（审查 A14）：已有任务进行中则跳过——run 的 ref 守卫同语义
    await run('titles', async () => {
      const r = await novelApi.titles(novelId, direction)
      setTitles(r.titles)
    })
  }

  return (
    <div className="col">
      {error && <ErrorMsg error={error} />}

      {/* 方向候选 */}
      <div className="panel">
        <div className="row justify-between">
          <h2>整本方向</h2>
          <button className="primary" disabled={busy !== null} onClick={() => void run('directions', () => novelApi.directions(novelId))}>
            {busy === 'directions' ? '生成中…' : directions.length > 0 ? '重新生成方向' : 'AI 生成方向方案'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          灵感：{novel?.inspiration}
        </p>
        {directions.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {directions.map((d) => (
              <div
                key={d.id}
                className="panel"
                style={{
                  background: 'var(--bg-card)',
                  borderColor: selectedDirection === d.id ? 'var(--accent)' : 'var(--border)',
                  cursor: 'pointer',
                  // v0.17.0（审查 A14）：进行中禁点方向卡（防并发 titles 覆盖 busy）
                  opacity: busy !== null ? 0.6 : 1,
                  pointerEvents: busy !== null ? 'none' : 'auto'
                }}
                onClick={() => {
                  setSelectedDirection(d.id)
                  void genTitles(d.scheme)
                }}
              >
                <strong style={{ fontSize: 15 }}>{d.scheme.title}</strong>
                <span className="badge ml-2">{d.scheme.genre}</span>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  卖点：{d.scheme.sellingPoint}
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  核心设定：{d.scheme.coreSetting}
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }} className="muted">
                  前30章：{d.scheme.first30}
                </div>
                <div className="mt-2">
                  {/* P13 G6：定向重做单套方向 */}
                  <button
                    className="sm"
                    disabled={busy !== null}
                    onClick={(e) => {
                      e.stopPropagation()
                      void run('redir-' + d.id, () => novelApi.directions(novelId, d.id))
                    }}
                  >
                    {busy === `redir-${d.id}` ? '重做中…' : '✎ 重做此方案'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {titles.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <label>候选书名（点击选用）</label>
            <div className="row flex-wrap">
              {titles.map((t) => (
                <button
                  key={t}
                  onClick={() => setTitle(t)}
                  style={title === t ? { borderColor: 'var(--accent)' } : {}}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 项目设定 */}
      <div className="panel">
        <div className="row justify-between">
          <h2>项目设定（framing）</h2>
          <button
            className="primary"
            disabled={busy !== null}
            onClick={() =>
              void run('framing', () =>
                novelApi.framing(novelId, {
                  title: title || undefined,
                  direction: directions.find((d) => d.id === selectedDirection)?.scheme,
                  notes
                })
              )
            }
          >
            {busy === 'framing' ? '生成中…' : 'AI 生成项目设定'}
          </button>
        </div>
        <div className="col">
          <div>
            <label>书名</label>
            <input
              style={{ width: '100%' }}
              value={title ?? ''}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                // P9 D24：书名失焦保存（与流派即时保存行为一致），允许清空
                if (title !== undefined && title !== (novel?.title !== '未命名小说' ? novel?.title : '')) {
                  novelApi
                    .patch(novelId, { title })
                    .then(() => queryClient.invalidateQueries({ queryKey: ['novel', novelId] }))
                    .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                }
              }}
              placeholder="确认书名"
            />
          </div>
          <div>
            <label>流派（绑定爽点/节奏模板，注入章节生成）</label>
            <div className="row gap-2">
              <select
                className="flex-1"
                value={novel?.genre || ''}
                onChange={(e) => {
                  setError(null)
                  novelApi
                    .patch(novelId, { genre: e.target.value })
                    .then(() => queryClient.invalidateQueries({ queryKey: ['novel', novelId] }))
                    .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                }}
              >
                <option value="">（未选择）</option>
                {genres.data?.genres.map((g) => (
                  <option key={g.id} value={g.name}>
                    {g.name}{g.custom ? '（自定义）' : ''}
                  </option>
                ))}
              </select>
              <button
                className="sm"
                onClick={() => { setAddingGenre((v) => !v); setNewGenre('') }}
                title="创建自定义流派"
              >
                + 自定义
              </button>
            </div>
            {addingGenre && (
              <div className="row" style={{ marginTop: 6, gap: 6 }}>
                <input
                  className="flex-1"
                  placeholder="流派名（如：克苏鲁）"
                  value={newGenre}
                  onChange={(e) => setNewGenre(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addGenre()
                  }}
                />
                <button className="primary sm" onClick={() => void addGenre()} disabled={!newGenre.trim()}>
                  保存
                </button>
              </div>
            )}
            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              选择流派后，章节生成会注入对应流派模板（黄金三章/断章钩子/爽点兑现方式）。自定义流派创建后即选中。
            </p>
          </div>
          <div>
            <label>补充说明（可选）</label>
            <textarea
              style={{ width: '100%', minHeight: 60, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontFamily: 'inherit' }}
              value={notes}
              onChange={(e) => { setNotes(e.target.value); notifyDirty(true) }}
              placeholder="对方向的额外要求…"
            />
          </div>
          {Boolean(framing.summary) && (
            <div className="panel" style={{ background: 'var(--bg-card)' }}>
              <div><strong>故事梗概：</strong>
                <button className="sm ml-2" disabled={busy !== null} onClick={() => void run('field-summary', () => novelApi.framingField(novelId, 'summary'))}>
                  {busy === 'field-summary' ? '重写中…' : '✎ AI 重写'}
                </button>
                {String(framing.summary)}</div>
              <div className="mt-2"><strong>卖点：</strong>
                <button className="sm ml-2" disabled={busy !== null} onClick={() => void run('field-sellingPoint', () => novelApi.framingField(novelId, 'sellingPoint'))}>
                  {busy === 'field-sellingPoint' ? '重写中…' : '✎ AI 重写'}
                </button>
                {String(framing.sellingPoint)}</div>
              <div className="mt-2"><strong>读者感受：</strong>
                <button className="sm ml-2" disabled={busy !== null} onClick={() => void run('field-readerFeeling', () => novelApi.framingField(novelId, 'readerFeeling'))}>
                  {busy === 'field-readerFeeling' ? '重写中…' : '✎ AI 重写'}
                </button>
                {String(framing.readerFeeling)}</div>
              <div className="mt-2"><strong>前30章承诺：</strong>
                <button className="sm ml-2" disabled={busy !== null} onClick={() => void run('field-first30Promise', () => novelApi.framingField(novelId, 'first30Promise'))}>
                  {busy === 'field-first30Promise' ? '重写中…' : '✎ AI 重写'}
                </button>
                {String(framing.first30Promise)}</div>
            </div>
          )}
        </div>
      </div>

      {/* 故事宏观 */}
      <div className="panel">
        <div className="row justify-between">
          <h2>故事宏观规划</h2>
          <button disabled={busy !== null} onClick={() => void run('macro', () => novelApi.macro(novelId))}>
            {busy === 'macro' ? '生成中…' : 'AI 生成宏观规划'}
          </button>
        </div>
        {Boolean(macro.storyEngine) && (
          <div className="panel" style={{ background: 'var(--bg-card)' }}>
            <div><strong>故事引擎：</strong>{String(macro.storyEngine)}</div>
            <div className="mt-2"><strong>长期对立：</strong>{String(macro.longConflict)}</div>
            <div className="mt-2"><strong>推进与兑现：</strong>{String(macro.payoffSummary)}</div>
            <div className="mt-2"><strong>主题：</strong>{String(macro.theme)}</div>
          </div>
        )}
        {!macro.storyEngine && <p className="muted t-small">先生成项目设定，再生成宏观规划。</p>}
      </div>
    </div>
  )
}
