import { describe, it, expect } from 'vitest'
import { eventToCombo, formatCombo, SHORTCUT_ACTIONS } from '../client/src/utils/shortcuts'

describe('P27 快捷键系统', () => {
  it('eventToCombo 标准化组合键', () => {
    const ev = (init: { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }): KeyboardEvent =>
      ({ key: init.key, ctrlKey: init.ctrlKey ?? false, shiftKey: init.shiftKey ?? false, altKey: init.altKey ?? false, metaKey: init.metaKey ?? false }) as unknown as KeyboardEvent
    expect(eventToCombo(ev({ key: 'k', ctrlKey: true }))).toBe('ctrl+k')
    expect(eventToCombo(ev({ key: 'r', ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+r')
    expect(eventToCombo(ev({ key: 'Enter', ctrlKey: true }))).toBe('ctrl+enter')
    expect(eventToCombo(ev({ key: 'b', metaKey: true }))).toBe('ctrl+b')
    expect(eventToCombo(ev({ key: 'F5' }))).toBeNull()
  })

  it('formatCombo 友好显示', () => {
    expect(formatCombo('ctrl+shift+r')).toBe('Ctrl+Shift+R')
    expect(formatCombo('ctrl+enter')).toBe('Ctrl+Enter')
    expect(formatCombo('alt+space')).toBe('Alt+space')
  })

  it('默认注册表完整（6 动作 + command-palette 默认 Ctrl+K）', () => {
    expect(Object.keys(SHORTCUT_ACTIONS).length).toBe(6)
    expect(SHORTCUT_ACTIONS['command-palette'].combo).toBe('ctrl+k')
    expect(SHORTCUT_ACTIONS['focus-mode'].combo).toBe('ctrl+shift+f')
  })
})
