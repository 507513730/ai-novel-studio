import { useId, useRef } from 'react'

export type WorkspaceTab = 'write' | 'check' | 'versions'
const tabs: Array<[WorkspaceTab, string]> = [['write', '写作'], ['check', '检查'], ['versions', '版本']]

export function WorkspaceTabs({ value, onChange, children }: {
  value: WorkspaceTab
  onChange: (tab: WorkspaceTab) => void
  children: React.ReactNode
}): React.JSX.Element {
  const id = useId()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  return <>
    <div className="workspace-tabs" role="tablist" aria-label="写作助手">
      {tabs.map(([tab, label], index) => <button key={tab} ref={el => { buttons.current[index] = el }}
        id={`${id}-${tab}`} role="tab" aria-selected={value === tab} aria-controls={`${id}-panel`}
        tabIndex={value === tab ? 0 : -1} onClick={() => onChange(tab)}
        onKeyDown={event => {
          let next = index
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
          else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = tabs.length - 1
          else return
          event.preventDefault()
          onChange(tabs[next][0])
          buttons.current[next]?.focus()
        }}>{label}</button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${value}`} tabIndex={0} className="workspace-tab-body">
      {children}
    </div>
  </>
}
