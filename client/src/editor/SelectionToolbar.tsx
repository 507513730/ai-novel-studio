import { useState } from 'react'
export function SelectionToolbar({ hasSelection, busy, disabled, onRequest }: {
  hasSelection: boolean; busy: boolean; disabled: boolean
  onRequest: (action: string, instruction?: string) => Promise<void>
}): React.JSX.Element | null {
  const [instruction, setInstruction] = useState('')
  if (!hasSelection) return null
  return <div className="selection-actions" aria-label="选区 AI 工具">
    <span className="muted t-small">选中文字</span>
    {[['polish', '润色'], ['emotion', '加强情感'], ['concise', '精简']].map(([action, label]) =>
      <button key={action} disabled={busy || disabled} onClick={() => void onRequest(action)}>{label}</button>)}
    <input aria-label="自定义改写要求" placeholder="自定义要求…" value={instruction} onChange={event => setInstruction(event.target.value)} disabled={busy || disabled} />
    <button disabled={busy || disabled || !instruction.trim()} onClick={() => void onRequest('polish', instruction)}>按要求改写</button>
    <span className="muted t-small">{busy ? '处理中…' : '结果将在右侧预览'}</span>
  </div>
}
