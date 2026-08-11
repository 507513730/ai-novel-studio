import { EmptyState } from '../components/EmptyState'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UsersRound, Star, Trash2 } from 'lucide-react'
import { novelApi, resourcesApi } from '../api'
import { useToast } from '../components/Toast'

// P18 D1：基础角色库（跨书角色模板：从书角色存模板 / 应用模板到书）
export function BaseCharactersPage(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

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

  const deleteTemplate = async (templateId: number, name: string): Promise<void> => {
    if (!window.confirm(`删除模板「${name}」？`)) return
    try {
      await resourcesApi.baseCharacterDelete(templateId)
      void queryClient.invalidateQueries({ queryKey: ['base-characters'] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <UsersRound size={20} />
        <h1 style={{ marginLeft: 8 }}>基础角色库</h1>
      </div>

      {/* 模板区 */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 8 }}>跨书模板（{templates.data?.templates.length ?? 0}）</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          从任意书的角色「⭐ 存为模板」沉淀；模板可应用到任意书名册。
        </p>
        <div className="col" style={{ gap: 8 }}>
          {templates.data?.templates.map((t) => (
            <div key={t.id} className="panel" style={{ background: 'var(--bg-card)', padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
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
                  <button className="sm danger" onClick={() => void deleteTemplate(t.id, t.name)}><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          ))}
          {!templates.isLoading && templates.data?.templates.length === 0 && (
            <EmptyState icon="?" title="????????" desc="???????????????????" />
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
        {novels.data?.novels.length === 0 && <p className="muted">还没有小说。</p>}
      </div>
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
  if (chars === undefined && q.data) onLoad(q.data.characters)
  const list = chars ?? q.data?.characters
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{title} <span className="muted" style={{ fontSize: 12 }}>#{novelId}</span></strong>
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
        {list === undefined && <span className="muted" style={{ fontSize: 12 }}>加载中…</span>}
      </div>
    </div>
  )
}
