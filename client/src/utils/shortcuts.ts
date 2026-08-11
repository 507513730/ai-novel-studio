// ============================================================
// P27 1-9：快捷键自定义系统
// 动作注册表 + localStorage 持久化 + 全局 keydown 分发
// 默认值可被用户覆盖（设置页「外观 → 快捷键」录制）
// ============================================================

export type ShortcutAction =
  | 'command-palette'
  | 'save'
  | 'generate'
  | 'review'
  | 'backfill'
  | 'focus-mode'

export interface ShortcutBinding {
  combo: string
  label: string
}

export const SHORTCUT_ACTIONS: Record<ShortcutAction, ShortcutBinding> = {
  'command-palette': { combo: 'ctrl+k', label: '命令面板' },
  save: { combo: 'ctrl+s', label: '保存正文' },
  generate: { combo: 'ctrl+enter', label: '生成正文' },
  review: { combo: 'ctrl+shift+r', label: 'AI 审核' },
  backfill: { combo: 'ctrl+shift+b', label: '状态回灌' },
  'focus-mode': { combo: 'ctrl+shift+f', label: '专注模式' }
}

const STORAGE_KEY = 'ai-novel.shortcuts'

export function getStoredShortcuts(): Record<ShortcutAction, string> {
  const defaults = Object.fromEntries(
    Object.entries(SHORTCUT_ACTIONS).map(([k, v]) => [k, v.combo])
  ) as Record<ShortcutAction, string>
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<ShortcutAction, string>>
      return { ...defaults, ...parsed }
    }
  } catch {
    /* 损坏回退默认 */
  }
  return defaults
}

export function saveShortcut(action: ShortcutAction, combo: string): void {
  const current = getStoredShortcuts()
  current[action] = combo
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
}

export function resetShortcuts(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/** 事件 → 标准化 combo（mod=ctrl/cmd） */
export function eventToCombo(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase()
  if (key.length !== 1 && !['enter', 'escape', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    return null
  }
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  parts.push(key === ' ' ? 'space' : key)
  return parts.join('+')
}

export type ShortcutHandler = Partial<Record<ShortcutAction, () => void>>

/** 全局快捷键分发（App 层注册一次）；返回取消函数 */
export function initShortcuts(handlers: ShortcutHandler): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const combo = eventToCombo(e)
    if (!combo) return
    // 输入框/文本域聚焦时不触发（保存与命令面板除外）
    const t = e.target as HTMLElement | null
    const inInput = !!t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
    const shortcuts = getStoredShortcuts()
    for (const [action, binding] of Object.entries(shortcuts) as Array<[ShortcutAction, string]>) {
      if (binding === combo) {
        if (inInput && action !== 'save' && action !== 'command-palette') continue
        const fn = handlers[action]
        if (fn) {
          e.preventDefault()
          fn()
        } else {
          // 无直接 handler → 派发事件桥（页面监听）
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('app-shortcut', { detail: action }))
        }
        return
      }
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}

/** 页面监听快捷键动作（配合事件桥） */
export function onShortcut(action: ShortcutAction, fn: () => void): () => void {
  const listener = (e: Event): void => {
    if ((e as CustomEvent).detail === action) fn()
  }
  window.addEventListener('app-shortcut', listener)
  return () => window.removeEventListener('app-shortcut', listener)
}

/** 格式化显示（ctrl+shift+r → Ctrl+Shift+R） */
export function formatCombo(combo: string): string {
  return combo
    .split('+')
    .map((p) => (p === 'ctrl' ? 'Ctrl' : p === 'shift' ? 'Shift' : p === 'alt' ? 'Alt' : p === 'enter' ? 'Enter' : p.length === 1 ? p.toUpperCase() : p))
    .join('+')
}
