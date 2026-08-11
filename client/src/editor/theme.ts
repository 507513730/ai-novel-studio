import { EditorView } from '@codemirror/view'

// P8-1：CodeMirror 主题（颜色随 CSS 变量）；P22-A/B：字体与排版走 --font-editor / --prose-* 变量（设置页即时生效）
export const novelEditorTheme = EditorView.theme(
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
  { dark: false }
)
