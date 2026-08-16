import { useState } from 'react'

// v0.23.1（批次 E1）：自 ChapterExecutionPage 提取（记忆面小组件）
// v0.20.0：记忆面小组件——角色状态追加（Enter 提交）
export function CharStateAdd({ name, disabled, onAdd }: { name: string; disabled: boolean; onAdd: (s: string) => void }): React.JSX.Element {
  const [draft, setDraft] = useState('')
  return (
    <input
      style={{ width: 140, fontSize: 11, padding: '2px 6px' }}
      placeholder={`给 ${name} 加状态…`}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && draft.trim()) {
          onAdd(draft.trim())
          setDraft('')
        }
      }}
    />
  )
}

// v0.20.0：记忆面小组件——势力当前状态修正（Enter 保存）
export function FactionStateEdit({
  current,
  disabled,
  onSave
}: {
  current: string
  disabled: boolean
  onSave: (s: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  return (
    <input
      style={{ width: 160, fontSize: 11, padding: '2px 6px' }}
      placeholder={current ? `当前：${current}` : '设置势力状态…'}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && draft.trim()) {
          onSave(draft.trim())
          setDraft('')
        }
      }}
    />
  )
}
