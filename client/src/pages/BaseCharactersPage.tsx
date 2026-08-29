import { EmptyState } from '../components/EmptyState'
import { Loading } from '../components/Loading'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UsersRound, Star, Trash2 } from 'lucide-react'
import { novelApi, resourcesApi, assetsApi } from '../api'
import { useToast } from '../components/Toast'
import { AssetCreator } from '../components/AssetCreator'
import { useConfirm } from '../components/ConfirmDialog'

// P18 D1：基础角色库（跨书角色模板：从书角色存模板 / 应用模板到书）
export function BaseCharactersPage(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  // v0.21.0（审查 P3-6：themed confirm 统一）——替代 window.confirm 的主题化确认
  const [confirmDelete, deleteDialog] = useConfirm()

  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({ queryKey: ['novels'], queryFn: novelApi.list })
  const templates = useQuery({ queryKey: ['base-characters'], queryFn: resourcesApi.baseCharacters })
  const [charsByNovel, setCharsByNovel] = useState<Record<number, Array<{ id: number; name: string; status: string; profile: Record<string, unknown> }>>>({})

  const saveTemplate = async (novelId: number, characterId: number, name: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await resourcesApi.baseCharacterFromCharacter(novelId, characterId)
      toast('ok', `「${name}」已存为模板`)
      void queryClient.invalidateQueries({ queryKey: ['base-characters'] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const applyTemplate = async (templateId: number, novelId: number, name: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await resourcesApi.baseCharacterApply(templateId, novelId)
      toast('ok', `「${name}」已应用到该书名册`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const deleteTemplate = async (templateId: number): Promise<void> => {
    // v0.17.0（审查 A37）：确认后加 busy——此前无门控可连点并发删除
    if (busy) return
    setBusy(true)
    try {
      await resourcesApi.baseCharacterDelete(templateId)
      void queryClient.invalidateQueries({ queryKey: ['base-characters'] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <div className="row mb-4">
        <UsersRound size={20} />
        <h1 className="ml-2">基础角色库</h1>
      </div>
      {/* P23（N5）：上传/粘贴/手动 → AI 生成角色模板 */}
      <AssetCreator
        type="base-character"
        typeLabel="角色模板"
        placeholder="粘贴角色描写片段或人设思路…（AI 提炼身份/性格/目标/弱点/关系）"
        maxLen={6000}
        onSave={async (draft) => {
          const profile: Record<string, string> = {}
          for (const k of ['role', 'identity', 'personality', 'goal', 'weakness', 'relation']) {
            const v = draft[k]
            if (v !== undefined && v !== null && String(v).trim()) profile[k] = String(v)
          }
          await assetsApi.baseCharacterCreate({ name: String(draft.name ?? '新角色模板').slice(0, 40), profile })
        }}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['base-characters'] })}
      />

      {/* 模板区 */}
      <div className="panel mb-4">
        <h2 className="mb-2">跨书模板（{templates.data?.templates.length ?? 0}）</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          从任意书的角色「⭐ 存为模板」沉淀；模板可应用到任意书名册。
        </p>
        <div className="col gap-2">
          {templates.data?.templates.map((t) => (
            <div key={t.id} className="panel" style={{ background: 'var(--bg-card)', padding: 12 }}>
              <div className="row justify-between flex-wrap gap-2">
                <div>
                  <strong>{t.name}</strong>
                  <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                    来源：{t.sourceTitle || `#${t.sourceNovelId ?? '?'}`}
                  </span>
                </div>
                <div className="row">
                  <select
                    style={{ width: 170, padding: '4px 8px', fontSize: 12 }}
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) void applyTemplate(t.id, Number(e.target.value), t.name)
                      e.target.value = ''
                    }}
                  >
                    <option value="" disabled>应用到…</option>
                    {novels.data?.novels.map((n) => <option key={n.id} value={n.id}>{n.title || `#${n.id}`}</option>)}
                  </select>
                  <button
                    className="sm danger"
                    disabled={busy}
                    onClick={() =>
                      confirmDelete({
                        title: '删除模板',
                        message: `删除模板「${t.name}」？`,
                        confirmText: '删除',
                        danger: true,
                        action: () => void deleteTemplate(t.id)
                      })
                    }
                  ><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          ))}
          {!templates.isLoading && templates.data?.templates.length === 0 && (
            <EmptyState
              icon={Star}
              title="还没有基础角色"
              desc="把常见角色类型存为模板（从书中角色「存为模板」或直接创建），新书一键复用。"
            />
          )}
        </div>
      </div>

      {/* 各书角色 */}
      <div className="col" style={{ gap: 12 }}>
        {novels.data?.novels.map((n) => (
          <NovelChars
            key={n.id}
            novelId={n.id}
            title={n.title}
            chars={charsByNovel[n.id]}
            busy={busy}
            onLoad={(list) => setCharsByNovel((m) => ({ ...m, [n.id]: list }))}
            onOpen={() => navigate(`/novels/${n.id}/?tab=characters`)}
            onSaveTemplate={(cid, name) => void saveTemplate(n.id, cid, name)}
          />
        ))}
        {novels.data?.novels.length === 0 && (
          <div className="panel">
            <EmptyState
              icon={UsersRound}
              title="还没有小说"
              desc="创建一本小说后，可以在各书角色页维护角色并「存为模板」复用。"
              action={<button className="primary" onClick={() => navigate('/novels')}>去创建小说</button>}
            />
          </div>
        )}
      </div>
      {deleteDialog}
    </div>
  )
}

function NovelChars({ novelId, title, chars, busy, onLoad, onOpen, onSaveTemplate }: {
  novelId: number
  title: string
  chars: Array<{ id: number; name: string; status: string; profile: Record<string, unknown> }> | undefined
  busy: boolean
  onLoad: (list: Array<{ id: number; name: string; status: string; profile: Record<string, unknown> }>) => void
  onOpen: () => void
  onSaveTemplate: (characterId: number, name: string) => void
}): React.JSX.Element {
  const q = useQuery({
    queryKey: ['chars', novelId],
    queryFn: () => novelApi.characters(novelId),
    enabled: chars === undefined
  })
  // v0.17.0（审查 A18）：渲染期调用 onLoad 设父组件 state 会触发"setState during render"告警并产生重复渲染；
  // 移入 useEffect——数据就绪后再回传父组件缓存
  useEffect(() => {
    if (chars === undefined && q.data) onLoad(q.data.characters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, chars === undefined])
  const list = chars ?? q.data?.characters
  return (
    <div className="panel">
      <div className="row justify-between">
        <strong>{title} <span className="muted t-small">#{novelId}</span></strong>
        <button className="sm" onClick={onOpen}>进入角色工作台</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {(list ?? []).map((c) => (
          <span key={c.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {c.name}
            <span className="muted" style={{ marginLeft: 2, fontSize: 11 }}>{c.status === 'pending' ? '待确认' : '名册'}</span>
            <button
              className="ghost sm"
              style={{ padding: 0, fontSize: 11, color: 'var(--accent-bright)' }}
              disabled={busy}
              title="存为跨书模板"
              onClick={() => onSaveTemplate(c.id, c.name)}
            >
              <Star size={11} />
            </button>
          </span>
        ))}
        {list === undefined && <Loading label="模板加载中…" lines={2} />}
      </div>
    </div>
  )
}
