import { useState } from 'react'
import { novelApi } from '../api'

interface SelectionToolbarProps {
  novelId: number
  chapterId: number
  hasSelection: boolean
  selectionText: string
  cursorPos: number
  editorText: string
  onApplySelection: (replacement: string) => void
  onInsertAt: (text: string, pos: number) => void
  onSave: () => Promise<void>
}

const MODIFY_ACTIONS = [
  { key: 'polish', label: '润色' },
  { key: 'emotion', label: '加强情感' },
  { key: 'conflict', label: '强化冲突' },
  { key: 'concise', label: '简洁化' },
  { key: 'style', label: '文风对齐' }
]

const INSERT_ACTIONS = [
  { key: 'continue', label: '续写' },
  { key: 'dialogue', label: '插对话' },
  { key: 'description', label: '插环境' }
]

export function SelectionToolbar(props: SelectionToolbarProps): React.JSX.Element {
  const { novelId, chapterId, hasSelection, selectionText, cursorPos, editorText } = props
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runAction = async (action: string): Promise<void> => {
    setBusyAction(action)
    setError(null)
    try {
      // P20（U2）：AI 操作前先存当前内容快照（误覆盖可恢复）
      try {
        await novelApi.createVersion(novelId, chapterId, 'AI 操作前快照')
      } catch {
        /* 快照失败不阻塞操作 */
      }
      if (hasSelection) {
        const r = await novelApi.aiAction(novelId, chapterId, {
          action,
          selection: selectionText
        })
        props.onApplySelection(r.content)
      } else {
        // 插入类：光标处或文末
        const r = await novelApi.aiAction(novelId, chapterId, {
          action,
          cursorPosition: cursorPos >= 0 ? cursorPos : editorText.length
        })
        props.onInsertAt(r.content, r.appliedAt ?? editorText.length)
      }
      await props.onSave()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyAction(null)
    }
  }

  if (error) {
    return (
      <div style={{ padding: '4px 10px', color: 'var(--danger)', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
        {error}
        <button style={{ fontSize: 11, marginLeft: 8, padding: '0 6px' }} onClick={() => setError(null)}>✕</button>
      </div>
    )
  }

  return (
    <div
      style={{
        padding: '4px 10px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        flexWrap: 'wrap'
      }}
    >
      <span className="muted t-small">
        {hasSelection ? 'AI 改写选中文字：' : 'AI 插入：'}
      </span>
      {(hasSelection ? MODIFY_ACTIONS : INSERT_ACTIONS).map((a) => (
        <button
          key={a.key}
          disabled={busyAction !== null}
          onClick={() => void runAction(a.key)}
          style={{ fontSize: 12, padding: '2px 10px' }}
        >
          {busyAction === a.key ? '…' : a.label}
        </button>
      ))}
    </div>
  )
}
