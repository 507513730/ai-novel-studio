import { useMemo, useSyncExternalStore } from 'react'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

// P8-1：CodeMirror 主题（颜色随 CSS 变量）；P22-A/B：字体与排版走 --font-editor / --prose-* 变量（设置页即时生效）
// v0.26.0（审查 A-2）：dark 标记跟随 data-theme（此前硬编码 { dark: false }，深色主题下派生行为标记错误）
function createNovelEditorTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'var(--bg)',
        color: 'var(--text)',
        fontSize: 'var(--prose-font-size)'
      },
      '.cm-scroller': {
        backgroundColor: 'var(--bg)'
      },
      '&.cm-focused': {
        outline: 'none'
      },
      '.cm-content': {
        fontFamily: 'var(--font-editor)',
        lineHeight: 'var(--prose-line-height)',
        padding: '16px 20px',
        caretColor: 'var(--accent-bright)',
        maxWidth: 'var(--prose-max-width)',
        margin: '0 auto'
      },
      '.cm-line': {
        textIndent: 'var(--prose-indent)'
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--accent-bright)'
      },
      '.cm-selectionBackground': {
        backgroundColor: 'var(--accent-soft-strong) !important'
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--bg-elevated)'
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg)',
        color: 'var(--text-faint)',
        border: 'none'
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: 'var(--accent-soft-strong) !important'
      }
    },
    { dark }
  )
}

// 亮色主题清单（与 utils/theme.ts 的 system 偏好判定一致；新增亮色主题须两处同步）
const LIGHT_THEMES = new Set(['paper', 'sepia'])

export function isDarkTheme(): boolean {
  const t = document.documentElement.getAttribute('data-theme')
  return !t || !LIGHT_THEMES.has(t)
}

function subscribeThemeChange(callback: () => void): () => void {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/** 编辑器主题扩展：随 data-theme 切换重建（dark 标记同步） */
export function useEditorTheme(): Extension {
  const dark = useSyncExternalStore(subscribeThemeChange, isDarkTheme)
  return useMemo(() => createNovelEditorTheme(dark), [dark])
}
