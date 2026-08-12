import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { WandSparkles, Play, Save, Download, Upload, Pencil, Trash2, Layers } from 'lucide-react'
import { novelApi, studioApi, agentsApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/Toast'
import { usePrompt } from '../components/PromptDialog'

// ============================================================
// P21-2：创造工坊——对话引导生成创作方案（agent 流水线）
// 列表 → 生成/编辑 → 试运行 → 保存/导入导出
// ============================================================

interface StepView {
  agentId: number
  role: string
  stage: string
  maxTokens?: number
  include?: string[]
  if?: unknown
  // P30：章节生产模式字段
  production?: { output: string; reviewRounds?: number }
}

interface SolutionView {
  id: number
  name: string
  description: string
  primaryAgentId: number | null
  steps: StepView[]
  version: number
  enabled: number
}

const STAGE_LABEL: Record<string, string> = {
  post_generate: '正文后',
  review: '审核',
  whole_book: '整本'
}

const STAGE_ORDER: Array<{ key: string; label: string; desc: string }> = [
  { key: 'post_generate', label: '正文后增强', desc: '在正文生成后跑（复核/补写/检查）' },
  { key: 'review', label: '审核增强', desc: '审核类步骤（问题清单/一致性核对）' },
  { key: 'whole_book', label: '整本模式（预留）', desc: '整本流水线（执行器未实现）' }
]

export function StudioPage(): React.JSX.Element {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { prompt: askName, element: promptElement } = usePrompt()

  const solutions = useQuery({ queryKey: ['studio-solutions'], queryFn: studioApi.solutions })
  const skills = useQuery({ queryKey: ['studio-skills'], queryFn: studioApi.skills })
  const agents = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list })
  const novels = useQuery({ queryKey: ['novels-mini'], queryFn: novelApi.list })

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState<SolutionView | null>(null)
  const [isNew, setIsNew] = useState(false)
  // P22-C5：拖拽中的步骤索引
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  // P21-5h：AI 生成方案
  const [genPrompt, setGenPrompt] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const generateSolution = async (): Promise<void> => {
    if (!genPrompt.trim()) return
    setGenBusy(true)
    setError(null)
    try {
      const r = await studioApi.solutionGenerate({ description: genPrompt.trim() })
      setDraft({
        id: 0,
        name: r.name,
        description: r.description,
        primaryAgentId: null,
        steps: r.steps as unknown as StepView[],
        version: 1,
        enabled: 1
      })
      setIsNew(true)
      setSelectedId(null)
      toast('ok', `已生成方案骨架「${r.name}」（${r.steps.length} 步），可调整后保存`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenBusy(false)
    }
  }

  const open = (sol: SolutionView): void => {
    setSelectedId(sol.id)
    setDraft(JSON.parse(JSON.stringify(sol)) as SolutionView)
    setIsNew(false)
  }

  const createBlank = (): void => {
    setSelectedId(null)
    setDraft({ id: 0, name: '新方案', description: '', primaryAgentId: null, steps: [], version: 1, enabled: 1 })
    setIsNew(true)
  }

  const agentOptions = (agents.data?.agents ?? []) as Array<{ id: number; name: string; role: string; description?: string }>
  const agentName = (id: number): string => agentOptions.find((a) => a.id === id)?.name ?? `#${id}`

  const patchDraft = (p: Partial<SolutionView>): void => {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev))
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft) return
    setBusy('save')
    setError(null)
    try {
      if (isNew) {
        const r = await studioApi.solutionCreate({
          name: draft.name,
          description: draft.description,
          primaryAgentId: draft.primaryAgentId,
          steps: draft.steps as unknown as Array<Record<string, unknown>>
        })
        toast('ok', `方案「${draft.name}」已创建`)
        setIsNew(false)
        setSelectedId(r.id)
      } else {
        await studioApi.solutionPatch(draft.id, {
          name: draft.name,
          description: draft.description,
          primaryAgentId: draft.primaryAgentId,
          steps: draft.steps as unknown as Array<Record<string, unknown>>
        })
        toast('ok', `方案已保存（v${draft.version + 1}）`)
      }
      await queryClient.invalidateQueries({ queryKey: ['studio-solutions'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // 试运行
  const [runTarget, setRunTarget] = useState<{ novelId: number; chapterId: number } | null>(null)
  const [runResult, setRunResult] = useState<{ run: Record<string, unknown>; summary: string } | null>(null)
  const [running, setRunning] = useState(false)
  const novelsList = (novels.data?.novels ?? []) as Array<{ id: number; title: string }>

  const runDraft = async (): Promise<void> => {
    if (!draft || !runTarget) return
    setRunning(true)
    setError(null)
    setRunResult(null)
    try {
      let id = draft.id
      if (isNew) {
        const r = await studioApi.solutionCreate({
          name: draft.name,
          description: draft.description,
          primaryAgentId: draft.primaryAgentId,
          steps: draft.steps as unknown as Array<Record<string, unknown>>
        })
        id = r.id
        setIsNew(false)
        setSelectedId(id)
        await queryClient.invalidateQueries({ queryKey: ['studio-solutions'] })
      }
      const r = await studioApi.solutionRun(id, runTarget.novelId, runTarget.chapterId)
      setRunResult(r)
      toast('ok', r.run.degraded ? '试运行完成（部分步骤降级）' : '试运行完成')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  // 导出/导入
  const exportCurrent = async (): Promise<void> => {
    if (!draft || isNew) return
    setBusy('export')
    try {
      const link = `${window.location.origin.replace(/\/$/, '')}#/studio` // 占位
      void link
      // 直接触发下载
      const url = `${window.location.origin}/api/solutions/${draft.id}/export`
      const a = document.createElement('a')
      a.href = url
      a.download = `${draft.name.replace(/[\\/:*?"<>|]/g, '_')}.solution.json`
      a.click()
      toast('ok', '已导出方案文件')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const importFile = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (): void => {
      const file = input.files?.[0]
      if (!file) return
      void (async () => {
        setBusy('import')
        try {
          const text = await file.text()
          const r = await studioApi.solutionImport(text)
          toast('ok', `已导入方案「${r.name}」`)
          await queryClient.invalidateQueries({ queryKey: ['studio-solutions'] })
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(null)
        }
      })()
    }
    input.click()
  }

  // Feelfish 格式导入
  const importFeelfish = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.json'
    input.multiple = true
    input.onchange = (): void => {
      const files = Array.from(input.files ?? [])
      if (files.length === 0) return
      void (async () => {
        setBusy('ffimport')
        setError(null)
        try {
          const agentsText: Array<string | { filename: string; content: string }> = []
          let solutionMeta: { name: string; description?: string; agents: Array<{ id: string }>; primaryAgentId?: string | null } | undefined
          for (const f of files) {
            const text = await f.text()
            if (f.name.endsWith('.md')) {
              agentsText.push({ filename: f.name, content: text })
            } else if (f.name.toLowerCase().includes('solution')) {
              try {
                const j = JSON.parse(text) as { primaryAgentId?: string | null; agents?: Array<{ id: string }>; description?: string }
                solutionMeta = { name: f.name.replace(/\.json$/i, ''), description: j.description ?? '', agents: j.agents ?? [], primaryAgentId: j.primaryAgentId ?? null }
              } catch {
                /* 忽略非 JSON */
              }
            }
          }
          if (agentsText.length === 0) {
            setError('未找到 agent 定义（.md 文件）。请选择 Feelfish 的 .feelfish/agents/*.md（可附带 solution.json）')
            return
          }
          const r = await studioApi.feelfishImport({ agents: agentsText, solution: solutionMeta })
          toast('ok', `已导入 Feelfish 方案「${r.name}」（${r.agentCount} 个智能体）`)
          await queryClient.invalidateQueries({ queryKey: ['studio-solutions'] })
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(null)
        }
      })()
    }
    input.click()
  }

  return (
    <>
      {promptElement}
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div className="row gap-2">
          <WandSparkles size={20} />
          <h1>创造工坊</h1>
          <span className="muted t-small">打造你的创作方案（智能体流水线）· P21</span>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="sm" onClick={createBlank}><Pencil size={13} className="icon-gap" />新建方案</button>
          <button className="sm" onClick={importFile} disabled={busy !== null}><Upload size={13} className="icon-gap" />导入方案</button>
          <button className="sm" onClick={importFeelfish} disabled={busy !== null} title="导入 Feelfish 的 .feelfish/agents/*.md + solution.json"><Layers size={13} className="icon-gap" />导入 Feelfish</button>
        </div>
      </div>

      {/* P21-5h：AI 生成方案 */}
      <div className="panel" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <WandSparkles size={15} style={{ color: 'var(--accent-bright)' }} />
        <input
          style={{ flex: '1 1 320px' }}
          placeholder="描述你想要的创作流程，AI 生成方案骨架。例如：写侦探文时先核对时间线漏洞，再查伏笔回收，最后统一文风…"
          value={genPrompt}
          onChange={(e) => setGenPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void generateSolution() }}
        />
        <button className="sm primary" disabled={genBusy || !genPrompt.trim()} onClick={() => void generateSolution()}>
          {genBusy ? '生成中…' : 'AI 生成方案'}
        </button>
      </div>

      {error && <ErrorMsg error={error} />}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>
        {/* 左：方案列表 */}
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>方案列表</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(solutions.data?.solutions ?? []).map((s) => {
              const sol = s as unknown as SolutionView
              return (
                <button
                  key={sol.id}
                  onClick={() => open(sol)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid transparent',
                    background: selectedId === sol.id ? 'var(--accent-soft)' : 'transparent',
                    color: 'var(--text)'
                  }}
                >
                  <div className="row justify-between">
                    <strong className="t3">{sol.name}</strong>
                    <span className="badge">v{sol.version}</span>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 2 }}>
                    <span className="muted t-small">{sol.steps.length} 步{sol.enabled ? '' : ' · 已停用'}</span>
                    {/* P23（N7）：方案删除 */}
                    <button
                      className="sm"
                      style={{ color: 'var(--danger)', borderColor: 'var(--danger)', padding: '0 6px', fontSize: 10 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!window.confirm(`删除方案「${sol.name}」？`)) return
                        setBusy('solution-del')
                        void studioApi
                          .solutionDelete(sol.id)
                          .then(() => {
                            toast('ok', '已删除')
                            if (selectedId === sol.id) { setSelectedId(null); setDraft(null) }
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                          .finally(() => { setBusy(null); void queryClient.invalidateQueries({ queryKey: ['studio-solutions'] }) })
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </button>
              )
            })}
            {(solutions.data?.solutions ?? []).length === 0 && (
              <p className="muted t-small">暂无方案。点「新建方案」开始，或「导入」已有方案。</p>
            )}
          </div>

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>技能库（{skills.data?.skills?.length ?? 0}）</div>
              {/* P23（N7）+ P27 0b：技能创建（应用内对话框，Electron 兼容） */}
              <button
                className="sm"
                onClick={() => {
                  void askName({ title: '技能名称' }).then(async (name) => {
                    if (!name?.trim()) return
                    const desc = (await askName({ title: '技能说明（可选）' })) ?? ''
                    const body = (await askName({ title: '技能内容（正文，可粘贴 Feelfish 技能 md）' })) ?? ''
                    setBusy('skill-create')
                    try {
                      await studioApi.skillCreate({ name: name.trim(), description: desc, body_md: body })
                      toast('ok', `技能「${name.trim()}」已创建`)
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    } finally {
                      setBusy(null)
                      void queryClient.invalidateQueries({ queryKey: ['studio-skills'] })
                    }
                  })
                }}
                disabled={busy !== null}
                title="手动创建技能（agent 可挂载）"
              >
                + 新建
              </button>
            </div>
            <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {(skills.data?.skills ?? []).map((sk) => (
                <div key={Number(sk.id)} className="row justify-between">
                  <span className="muted t-small">
                    {String(sk.name)} <span style={{ opacity: 0.6 }}>· {String(sk.description).slice(0, 30)}</span>
                  </span>
                  <button
                    className="sm"
                    style={{ color: 'var(--danger)', borderColor: 'var(--danger)', padding: '0 6px', fontSize: 10 }}
                    onClick={() => {
                      if (!window.confirm(`删除技能「${String(sk.name)}」？`)) return
                      void studioApi.skillDelete(Number(sk.id)).then(() => {
                        toast('ok', '已删除')
                        void queryClient.invalidateQueries({ queryKey: ['studio-skills'] })
                      })
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {(skills.data?.skills ?? []).length === 0 && <span className="muted t-small">空（可手动新建或导入 Feelfish agent 自动建）</span>}
            </div>
          </div>
        </div>

        {/* 右：编辑区 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {draft ? (
            <>
              <div className="panel" style={{ padding: 14 }}>
                <div className="row justify-between flex-wrap gap-2">
                  <input
                    style={{ fontSize: 16, fontWeight: 600, flex: '1 1 240px' }}
                    value={draft.name}
                    onChange={(e) => patchDraft({ name: e.target.value })}
                  />
                  <div className="row gap-2">
                    <button className="sm" onClick={exportCurrent} disabled={isNew || busy !== null}><Download size={13} className="icon-gap" />导出</button>
                    <button className="sm primary" onClick={() => void saveDraft()} disabled={busy !== null}>
                      <Save size={13} className="icon-gap" />{busy === 'save' ? '保存中…' : '保存'}
                    </button>
                  </div>
                </div>
                <textarea
                  style={{ width: '100%', minHeight: 44, marginTop: 8, fontSize: 12 }}
                  placeholder="方案描述（将注入每步提示，说明本方案的用途与边界）"
                  value={draft.description}
                  onChange={(e) => patchDraft({ description: e.target.value })}
                />
              </div>

              {/* 步骤编辑 */}
              <div className="panel" style={{ padding: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong className="t3">步骤（按顺序执行）</strong>
                  <button
                    className="sm"
                    onClick={() => {
                      const first = agentOptions[0]
                      if (!first) {
                        setError('无可用智能体（先配置内置或自定义 agent）')
                        return
                      }
                      patchDraft({
                        steps: [...draft.steps, { agentId: first.id, role: `步骤 ${draft.steps.length + 1}`, stage: 'post_generate' }]
                      })
                    }}
                  >
                    + 添加步骤
                  </button>
                </div>
                {draft.steps.length === 0 && (
                  <p className="muted t-small">还没有步骤。添加步骤选择智能体，或用「AI 生成方案」自动创建。</p>
                )}
                {draft.steps.map((step, i) => (
                  // P22-C5：拖拽排序（draggable + drop 交换）
                  <div
                    key={i}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', String(i))
                      e.dataTransfer.effectAllowed = 'move'
                      setDragIdx(i)
                    }}
                    onDragEnd={() => setDragIdx(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      const from = Number(e.dataTransfer.getData('text/plain'))
                      if (Number.isInteger(from) && from >= 0 && from < draft.steps.length && from !== i) {
                        const next = [...draft.steps]
                        const [moved] = next.splice(from, 1)
                        next.splice(i, 0, moved)
                        patchDraft({ steps: next })
                      }
                    }}
                    style={{
                      borderTop: '1px solid var(--border)',
                      padding: '8px 0',
                      cursor: 'grab',
                      opacity: dragIdx === i ? 0.4 : 1,
                      transition: 'opacity 150ms'
                    }}
                  >
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className="badge">{i + 1}</span>
                      <select
                        style={{ flex: '1 1 160px' }}
                        value={step.agentId}
                        onChange={(e) => {
                          const next = [...draft.steps]
                          next[i] = { ...step, agentId: Number(e.target.value) }
                          patchDraft({ steps: next })
                        }}
                      >
                        {agentOptions.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}（{a.role}）</option>
                        ))}
                      </select>
                      <input
                        style={{ flex: '1 1 140px' }}
                        placeholder="步骤职责（如：时间线核对）"
                        value={step.role}
                        onChange={(e) => {
                          const next = [...draft.steps]
                          next[i] = { ...step, role: e.target.value }
                          patchDraft({ steps: next })
                        }}
                      />
                      <select
                        value={step.stage}
                        onChange={(e) => {
                          const next = [...draft.steps]
                          next[i] = { ...step, stage: e.target.value }
                          patchDraft({ steps: next })
                        }}
                      >
                        {STAGE_ORDER.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                      {step.stage === 'whole_book' && (
                        <select
                          value={step.production?.output ?? 'draft'}
                          onChange={(e) => {
                            const next = [...draft.steps]
                            next[i] = { ...step, production: { output: e.target.value as never, reviewRounds: 1 } }
                            patchDraft({ steps: next })
                          }}
                        >
                          <option value="outline">???????</option>
                          <option value="draft">???????</option>
                          <option value="dialogue">?????</option>
                          <option value="scene">?????</option>
                          <option value="review">???????</option>
                          <option value="final">???????</option>
                        </select>
                      )}
                      <button
                        className="sm"
                        style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        onClick={() => patchDraft({ steps: draft.steps.filter((_, j) => j !== i) })}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      智能体：{agentName(step.agentId)} · {STAGE_LABEL[step.stage] ?? step.stage}
                      {step.maxTokens ? ` · max ${step.maxTokens} tokens` : ''}
                    </div>
                  </div>
                ))}
              </div>

              {/* 试运行 */}
              <div className="panel" style={{ padding: 14 }}>
                <strong className="t3">试运行</strong>
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <select
                    style={{ flex: '1 1 180px' }}
                    value={runTarget?.novelId ?? ''}
                    onChange={(e) => setRunTarget((prev) => ({ novelId: Number(e.target.value), chapterId: prev?.chapterId ?? 0 }))}
                  >
                    <option value="">选择小说…</option>
                    {novelsList.map((n) => (
                      <option key={n.id} value={n.id}>{n.title || `#${n.id}`}</option>
                    ))}
                  </select>
                  <ChapterPicker novelId={runTarget?.novelId ?? 0} chapterId={runTarget?.chapterId ?? 0} onPick={(cid) => setRunTarget((prev) => ({ novelId: prev?.novelId ?? 0, chapterId: cid }))} />
                  <button className="sm primary" disabled={running || !runTarget || runTarget.chapterId <= 0} onClick={() => void runDraft()}>
                    <Play size={13} className="icon-gap" />{running ? '运行中…' : '跑一遍'}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  在所选章节上执行完整方案（每步真实调用模型）。整本模式步骤会报错（预留）。
                </p>
                {runResult && (
                  <div style={{ marginTop: 10 }}>
                    <div className="row gap-2">
                      <span className="badge">{runResult.run.degraded ? '部分降级' : '完成'}</span>
                      {(runResult.run.outputs as Array<{ role: string; ok: boolean; error?: string; ms: number }>).map((o, i) => (
                        <span key={i} className="badge" style={{ color: o.ok ? 'var(--ok)' : 'var(--danger)' }}>
                          {i + 1}.{o.role}{o.ok ? '' : ' ✗'}
                        </span>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, background: 'var(--bg-panel)', borderRadius: 8, padding: 10, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
                      {runResult.summary || '（无输出）'}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
              <WandSparkles size={28} style={{ opacity: 0.5 }} />
              <p className="muted mt-2">
                从左侧选择一个方案编辑，或新建/导入。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  )
}

function ChapterPicker({ novelId, chapterId, onPick }: { novelId: number; chapterId: number; onPick: (id: number) => void }): React.JSX.Element {
  const chapters = useQuery({
    queryKey: ['studio-run-targets', novelId],
    queryFn: () => studioApi.runTargets(novelId),
    enabled: novelId > 0
  })
  const list = (chapters.data?.chapters ?? []) as Array<{ id: number; title: string; status: string }>
  return (
    <select
      style={{ flex: '1 1 180px' }}
      value={chapterId || ''}
      disabled={novelId <= 0}
      onChange={(e) => onPick(Number(e.target.value))}
    >
      <option value="">{novelId > 0 ? '选择有正文的章节…' : '先选小说'}</option>
      {list.map((c) => (
        <option key={c.id} value={c.id}>{c.title || `第 ${c.id} 章`}（{c.status}）</option>
      ))}
    </select>
  )
}
