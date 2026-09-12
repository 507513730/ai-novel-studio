import { useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { useEditorTheme } from '../../editor/theme'
import { makeQuickWordSource } from '../../utils/quickWords'
import { EmptyStateGuide, SuggestionOverlay } from './ChapterPanels'

export type ExportFormat = 'txt' | 'md' | 'epub' | 'docx'
export type ViewMode = 'edit' | 'read'
export interface ChapterToolbarProps {
  title: string
  hanCount: number
  saving: boolean
  dirty: boolean
  saveError: string | null
  hasConflict?: boolean
  resolvingConflict?: boolean
  onResolveConflict?: () => void
  streaming: boolean
  contentLoading: boolean
  hasChapter: boolean
  onSave: () => void
  viewMode: ViewMode
  onToggleViewMode: () => void
  focusMode: boolean
  onToggleFocus: () => void
  onTogglePanel: (panel: 'chapters' | 'assistant') => void
  exportBusy: string | null
  onExport: (format: ExportFormat) => void
  onSaveTitle: (title: string) => Promise<void>
}
export function ChapterToolbar(p: ChapterToolbarProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const [titleBusy, setTitleBusy] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const state = p.saveError ? 'error' : p.dirty ? 'dirty' : 'saved'
  const status = !p.hasChapter ? '请选择章节' : p.contentLoading ? '加载中…' : p.streaming ? '正在生成' : p.saving ? '保存中…' : p.saveError ? '保存失败' : p.dirty ? '未保存' : '已保存'
  return <header className="chapter-toolbar">
    <div className="chapter-toolbar-title">
      {draft === null ? <button disabled={!p.hasChapter || p.contentLoading} title="修改章节标题" onClick={() => setDraft(p.title)}>{p.title}</button> :
        <form onSubmit={event => {
          event.preventDefault()
          if (titleBusy || !draft.trim()) return
          setTitleBusy(true)
          void p.onSaveTitle(draft.trim()).then(() => { setDraft(null); setTitleError(null) }).catch(error => setTitleError(String(error))).finally(() => setTitleBusy(false))
        }}><input aria-label="章节标题" value={draft} disabled={titleBusy} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setDraft(null) }} autoFocus />
          <button disabled={titleBusy || !draft.trim()}>确定</button><button type="button" disabled={titleBusy} onClick={() => setDraft(null)}>取消</button></form>}
      {titleError && <span role="alert">{titleError}</span>}
      <div className="chapter-toolbar-meta">{p.hanCount.toLocaleString()} 字 · <span role="status" className="chapter-save-status" data-state={state} title={p.saveError ?? undefined}>{status}</span></div>
    </div>
    <div className="chapter-toolbar-actions">
      <button className="workspace-mobile-tools" onClick={() => p.onTogglePanel('chapters')}>章节</button>
      <button className="workspace-mobile-tools" onClick={() => p.onTogglePanel('assistant')}>助手</button>
      <button onClick={p.onSave} disabled={p.saving || p.contentLoading || p.streaming || !p.hasChapter}>{p.saveError ? '重试保存' : '保存'}</button>
      {p.hasConflict && <button disabled={p.resolvingConflict || p.streaming || p.contentLoading} onClick={p.onResolveConflict}>保存草稿副本并载入最新正文</button>}
      <button disabled={p.streaming || p.contentLoading} onClick={p.onToggleViewMode}>{p.viewMode === 'read' ? '编辑' : '阅读'}</button>
      <button aria-pressed={p.focusMode} onClick={p.onToggleFocus}>{p.focusMode ? '退出专注' : '专注'}</button>
      <details className="chapter-export"><summary>导出</summary><div className="chapter-export-menu">{(['txt', 'md', 'epub', 'docx'] as ExportFormat[]).map(f => <button key={f} disabled={p.exportBusy !== null} onClick={event => { p.onExport(f); event.currentTarget.closest('details')?.removeAttribute('open') }}>{f.toUpperCase()}</button>)}</div></details>
    </div>
  </header>
}

export interface EditorPaneProps {
  content: string
  onContentChange: (v: string) => void
  onEditorUpdate: (update: unknown) => void
  streaming: boolean
  contentLoading: boolean
  hasChapter: boolean
  summary?: string
  quickWords: Record<string, string>
  suggestion: { text: string; pos: number } | null
  sugBusy: boolean
  onAcceptSuggestion: () => void
  onRegenerateSuggestion: () => void
  onCloseSuggestion: () => void
  onGenerate: () => void
  busy: boolean
  editorRef: React.RefObject<ReactCodeMirrorRef | null>
}

export function EditorPane({
  content,
  onContentChange,
  onEditorUpdate,
  streaming,
  contentLoading,
  hasChapter,
  summary,
  quickWords,
  suggestion,
  sugBusy,
  onAcceptSuggestion,
  onRegenerateSuggestion,
  onCloseSuggestion,
  onGenerate,
  busy,
  editorRef
}: EditorPaneProps): React.JSX.Element {
  const editorTheme = useEditorTheme()
  return (
    <div className="chapter-editor-surface">
      <CodeMirror
        value={content}
        editable={!streaming && !contentLoading && hasChapter}
        onChange={onContentChange}
        onUpdate={(u) => onEditorUpdate(u)}
        height="100%"
        theme={editorTheme}
        // v0.24.4（A2）：快捷词补全（";触发词" → 展开文本，设置页维护词典）
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
        extensions={[EditorView.lineWrapping, markdown(), autocompletion({ override: [makeQuickWordSource(quickWords)] })]}
        style={{ height: '100%' }}
        ref={editorRef}
      />
      {/* v0.19.0：光标续写建议浮层（Cmd/Ctrl+J 生成 → Tab 插入 / Esc 关闭） */}
      {(suggestion || sugBusy) && !streaming && hasChapter && (
        <SuggestionOverlay
          suggestion={suggestion}
          busy={sugBusy}
          onAccept={onAcceptSuggestion}
          onRegenerate={onRegenerateSuggestion}
          onClose={onCloseSuggestion}
        />
      )}
      {/* P10：空状态引导 */}
      {!contentLoading && !streaming && !content && hasChapter && (
        <EmptyStateGuide summary={summary} busy={busy} onGenerate={onGenerate} />
      )}
    </div>
  )
}
