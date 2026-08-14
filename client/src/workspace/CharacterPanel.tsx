import { useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { novelApi } from '../api'
import { useConfirm } from '../components/ConfirmDialog'

export function CharacterPanel({ novelId }: { novelId: number }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  // v0.22.0（审查 ALOW）：themed confirm 统一
  const [confirmFn, confirmDialog] = useConfirm()

  const chars = useQuery({
    queryKey: ['characters', novelId],
    queryFn: () => novelApi.characters(novelId)
  })
  const list = chars.data?.characters ?? []

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['characters', novelId] })

  const generate = useMutation({
    mutationFn: (guidance?: string) => novelApi.charactersGenerate(novelId, guidance),
    onSuccess: () => void invalidate(),
    onError: (err) => setError(err instanceof Error ? err.message : String(err))
  })

  const [charBusy, setCharBusy] = useState<number | null>(null)
  const [genGuidance, setGenGuidance] = useState('')

  const confirmCharacter = async (charId: number): Promise<void> => {
    if (charBusy !== null) return
    setCharBusy(charId)
    try {
      await novelApi.characterPatch(novelId, charId, { status: 'roster' })
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCharBusy(null)
    }
  }

  const removeCharacter = async (charId: number): Promise<void> => {
    if (charBusy !== null) return
    setCharBusy(charId)
    try {
      await novelApi.characterDelete(novelId, charId)
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCharBusy(null)
    }
  }

  const addCharacter = async (): Promise<void> => {
    if (!newName.trim() || busy) return
    setBusy(true)
    try {
      await novelApi.characterCreate(novelId, { name: newName.trim(), status: 'roster' })
      setNewName('')
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col">
      {error && <ErrorMsg error={error} />}
      <div className="panel">
        <div className="row justify-between">
          <h2>角色</h2>
          <div className="row gap-2">
            <input
              style={{ width: 220 }}
              placeholder="可选：本次生成要求（如：主角是腹黑医生、双女主）"
              value={genGuidance}
              onChange={(e) => setGenGuidance(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setError(null)
                void generate.mutateAsync(genGuidance.trim() || undefined).finally(() => setBusy(false))
              }}
            >
              {busy ? '生成中…' : 'AI 生成角色阵容'}
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          AI 生成的角色进入"待确认"区，确认后进入正式名册（防止未确认设定被写入正文）。
        </p>

        <div className="row" style={{ marginBottom: 12 }}>
          <input
            className="flex-1"
            placeholder="手动添加角色名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button onClick={() => void addCharacter()} disabled={busy || !newName.trim()}>{busy ? '添加中…' : '添加'}</button>
        </div>

        {chars.isLoading && <p className="muted t-small">加载中…</p>}
        {chars.isError && (
          <div style={{ color: 'var(--danger)', fontSize: 12 }}>
            加载失败：{String(chars.error)}
            <button className="ml-2" onClick={() => void chars.refetch()}>重试</button>
          </div>
        )}
        {!chars.isLoading && !chars.isError && list.length === 0 && <p className="muted t-small">还没有角色</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {list.map((c) => (
            <div key={c.id} className="panel" style={{ background: 'var(--bg-card)' }}>
              <div className="row justify-between">
                <strong>{c.name}</strong>
                <span className="badge" style={c.status === 'pending' ? { color: '#ffb86c', background: 'rgba(255,184,108,0.12)' } : {}}>
                  {c.status === 'pending' ? '待确认' : '正式'}
                </span>
              </div>
              {c.profile.role && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>定位：{c.profile.role}</div>}
              {c.profile.identity && <div style={{ fontSize: 12, marginTop: 4 }}>身份：{c.profile.identity}</div>}
              {c.profile.personality && <div style={{ fontSize: 12, marginTop: 4 }}>性格：{c.profile.personality}</div>}
              {c.profile.goal && <div style={{ fontSize: 12, marginTop: 4 }}>目标：{c.profile.goal}</div>}
              {c.profile.weakness && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>弱点：{c.profile.weakness}</div>}
              <div className="row mt-2">
                {c.status === 'pending' && (
                  <button className="primary" disabled={charBusy !== null} onClick={() => void confirmCharacter(c.id)}>
                    {charBusy === c.id ? '确认中…' : '确认入册'}
                  </button>
                )}
                <button
                  className="danger"
                  disabled={charBusy !== null}
                  onClick={() => {
                    confirmFn({ title: '删除角色', message: `确定删除角色「${c.name || '未命名'}」？该操作不可恢复。`, confirmText: '删除', danger: true, action: () => void removeCharacter(c.id) })
                  }}
                >
                  {charBusy === c.id ? '删除中…' : '删除'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}
