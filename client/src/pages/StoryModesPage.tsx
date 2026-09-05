import { EmptyState } from '../components/EmptyState'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Workflow, Plus, Trash2, Gauge } from 'lucide-react'
import { resourcesApi } from '../api'
import { ErrorMsg } from '../components/ErrorMsg'
import { useToast } from '../components/toastGlobal'
import { AssetCreator } from '../components/AssetCreator'
import { useConfirm } from '../components/useConfirm'

// P17-2：推进模式库（升级流/日常流等节奏模板管理）
export function StoryModesPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  // v0.17.0（审查 A20）：创建 busy 门控——防连点重复创建
  const [busy, setBusy] = useState(false)
  // v0.21.0（审查 P3-6：themed confirm 统一）——替代 window.confirm 的主题化确认
  const [confirmDelete, deleteDialog] = useConfirm()

  const modes = useQuery({ queryKey: ['story-modes'], queryFn: resourcesApi.storyModes })

  const create = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await resourcesApi.storyModeCreate(name.trim(), desc.trim(), {
        cadence: '（未配置——用「AI 生成」从内容提炼节奏）',
        density: '（未配置——用「AI 生成」从内容提炼爽点密度）'
      })
      setName('')
      setDesc('')
      toast('ok', '推进模式已创建')
      void queryClient.invalidateQueries({ queryKey: ['story-modes'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number): Promise<void> => {
    // v0.21.0（审查 P3-6）：确认逻辑上移到调用点（themed confirm），此处仅执行删除
    try {
      await resourcesApi.storyModeDelete(id)
      toast('ok', '已删除')
      void queryClient.invalidateQueries({ queryKey: ['story-modes'] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div className="row mb-4">
        <Workflow size={20} />
        <h1 className="ml-2">推进模式库</h1>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        推进节奏模板（升级流 / 日常流 / 群像流…），供章节生成时参考节奏与爽点密度。
      </p>
      {/* P23：上传/粘贴/手动 → AI 生成推进模式 */}
      <AssetCreator
        type="mode"
        typeLabel="推进模式"
        placeholder="粘贴小说片段或节奏描述（AI 提炼 cadence/density/beats）"
        maxLen={8000}
        onSave={async (draft) => {
          await resourcesApi.storyModeCreate(
            String(draft.name ?? '未命名模式').slice(0, 30),
            String(draft.description ?? '').slice(0, 300),
            (draft.pattern as Record<string, unknown>) ?? {}
          )
        }}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['story-modes'] })}
      />
      {error && <ErrorMsg error={error} />}
      <div className="panel mb-4">
        <div className="row">
          <input style={{ flex: 2 }} placeholder="模式名（如：无限升级流）" value={name} onChange={(e) => setName(e.target.value)} />
          <input style={{ flex: 3 }} placeholder="描述（可选）" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button className="primary" disabled={busy || !name.trim()} onClick={() => void create()}>
            <Plus size={14} className="icon-gap" />{busy ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
      <div className="col gap-2">
        {modes.data?.modes.map((m) => (
          <div key={m.id} className="panel" style={{ background: 'var(--bg-card)', padding: 12 }}>
            <div className="row justify-between">
              <div>
                <strong>{m.name}</strong>
                {m.description && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{m.description}</div>}
              </div>
              <button
                className="sm danger"
                onClick={() =>
                  confirmDelete({
                    title: '删除推进模式',
                    message: `删除推进模式「${m.name}」？`,
                    confirmText: '删除',
                    danger: true,
                    action: () => void remove(m.id)
                  })
                }
              >
                <Trash2 size={12} className="icon-gap" />删除
              </button>
            </div>
          </div>
        ))}
        {!modes.isLoading && modes.data?.modes.length === 0 && (
          <EmptyState
            icon={Gauge}
            title="还没有推进模式"
            desc="创建你的第一个节奏模板（升级流 / 日常流 / 群像流…），章节生成时参考节奏与爽点密度。"
          />
        )}
      </div>
      {deleteDialog}
    </div>
  )
}
