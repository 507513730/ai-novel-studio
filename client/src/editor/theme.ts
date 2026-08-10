import { EditorView } from '@codemirror/view'

// P8-1：CodeMirror 主题与应用令牌对齐；P13 F0：颜色走 CSS 变量（多主题联动）
export const novelEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--bg)',
      color: 'var(--text)',
      fontSize: '15px'
    },
    '.cm-scroller': {
      backgroundColor: 'var(--bg)'
    },
    '&.cm-focused': {
      outline: 'none'
    },
    '.cm-content': {
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
      lineHeight: '1.75',
      padding: '16px 20px',
      caretColor: 'var(--accent-bright)'
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
  { dark: false }
)
