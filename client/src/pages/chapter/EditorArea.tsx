import { useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion } from '@codemirror/autocomplete'
import { Pin } from 'lucide-react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { useEditorTheme } from '../../editor/theme'
import { makeQuickWordSource } from '../../utils/quickWords'
import { EmptyStateGuide, SuggestionOverlay } from './ChapterPanels'

// v0.25.0（审查 S1）：从 ChapterExecutionPage 拆出的中区编辑器（工具条 + 编辑器本体）。
// 标题内联编辑的 editingTitle / titleDraft 两个状态收归工具条内部，主页面不再感知。

export type ExportFormat = 'txt' | 'md' | 'epub' | 'docx'
export type ViewMode = 'edit' | 'read'

export interface ChapterToolbarProps {
  title: string
  summary?: string
  hanCount: number
  humanWords: number
  aiWords: number
  stats: { total: number; written: number; failed: number; remaining: number }
  saving: boolean
  streaming: boolean
  contentLoading: boolean
  hasChapter: boolean
  guidance: string
  onGuidanceChange: (v: string) => void
  onSave: () => void
  onGenerate: () => void
  viewMode: ViewMode
  onToggleViewMode: () => void
  onPinGuidance: () => void
  exportBusy: string | null
  onExport: (format: ExportFormat) => void
  onSaveTitle: (title: string) => Promise<void>
}

export function ChapterToolbar({
  title,
  summary,
  hanCount,
  humanWords,
  aiWords,
  stats,
  saving,
  streaming,
  contentLoading,
  hasChapter,
  guidance,
  onGuidanceChange,
  onSave,
  onGenerate,
  viewMode,
  onToggleViewMode,
  onPinGuidance,
  exportBusy,
  onExport,
  onSaveTitle
}: ChapterToolbarProps): React.JSX.Element {
  // A2：标题内联编辑（Enter/blur 去重提交）
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleSubmittedRef = useRef(false)

  const saveTitle = (): void => {
    const t = titleDraft.trim()
    if (!t || t === title) {
      setEditingTitle(false)
      return
    }
    void onSaveTitle(t).finally(() => setEditingTitle(false))
  }

  return (
    // v0.26.0（审查 P0-1）：允许换行 + 左组收缩保护——此前窄宽下标题/字数被压成一字一行竖排
    <div
      className="row flex-wrap"
      style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', justifyContent: 'space-between', rowGap: 8 }}
    >
      <div className="row" style={{ minWidth: 0, flexShrink: 1 }}>
        {editingTitle ? (
          <input
            style={{ width: 240 }}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              // P9 B8：Enter 已提交则跳过 blur 双发
              if (titleSubmittedRef.current) {
                titleSubmittedRef.current = false
                return
              }
              saveTitle()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
                titleSubmittedRef.current = true
                saveTitle()
              } else if (e.key === 'Escape') {
                setEditingTitle(false)
              }
            }}
            autoFocus
          />
        ) : (
          <strong
            style={{ cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280, minWidth: 0 }}
            title="点击编辑标题"
            onClick={() => {
              setTitleDraft(title)
              setEditingTitle(true)
            }}
          >
            {title}
          </strong>
        )}
        {summary && (
          <span className="muted t-small ellipsis" style={{ maxWidth: 200 }} title={summary}>
            {summary}
          </span>
        )}
        <span className="muted t-small" style={{ flexShrink: 0 }}>｜{hanCount} 字</span>
        {/* v0.19.0：人类/AI 字数分离 */}
        <span
          className="muted t-small"
          style={{ color: 'var(--ok)', cursor: 'help', flexShrink: 0 }}
          title="AI 字数：当前内容中 AI 来源（整章生成/重生/修复按本次覆盖，不超当前字数）。我的字数：人工输入累计（增量累加，删除不降）。"
        >
          ｜我的 {humanWords.toLocaleString()} · AI {aiWords.toLocaleString()}
        </span>
      </div>
      <div className="row flex-wrap">
        <button onClick={onSave} disabled={saving || contentLoading || streaming}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button onClick={onGenerate} disabled={streaming || contentLoading || !hasChapter}>
          {streaming ? '生成中…' : 'AI 生成正文'}
        </button>
        {/* v0.24.2（F1）：阅读/复盘模式切换 */}
        <button
          title={viewMode === 'read' ? '返回编辑模式' : '阅读模式：干净排版预览（抽读/复盘）'}
          disabled={streaming || contentLoading}
          onClick={onToggleViewMode}
        >
          {viewMode === 'read' ? '编辑' : '阅读'}
        </button>
        {/* v0.22.2：正文进度轻提示 */}
        {stats.total > 0 && (stats.remaining > 0 || stats.failed > 0) && (
          <span className="muted t-small" style={{ alignSelf: 'center' }}>
            进度 {stats.written}/{stats.total} 章
            {stats.remaining > 0 ? ` · 剩 ${stats.remaining} 章待生产` : ''}
            {stats.failed > 0 ? ` · ⚠ ${stats.failed} 章失败可重试` : ''}
          </span>
        )}
        <input
          style={{ flex: '1 1 200px', minWidth: 180 }}
          placeholder="可选：对本次生成的额外要求（如：本章要引入新反派伏笔、节奏放慢写细节）…"
          value={guidance}
          disabled={streaming}
          onChange={(e) => onGuidanceChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !streaming) onGenerate()
          }}
        />
        {/* v0.15.0：反馈沉淀——把这句要求固定为硬约束（全链生效） */}
        <button
          className="sm"
          title="把这句话设为书级硬约束（导演/方案/生成/修复全链强制生效）"
          disabled={streaming || !guidance.trim()}
          onClick={onPinGuidance}
        >
          <Pin size={12} className="icon-gap" /> 固定为约束
        </button>
        <span style={{ margin: '0 8px', color: 'var(--border)' }}>|</span>
        {(['txt', 'md', 'epub', 'docx'] as ExportFormat[]).map((f) => (
          <button
            key={f}
            className="sm"
            style={{ color: 'var(--accent)', background: 'transparent', border: 'none' }}
            disabled={exportBusy !== null}
            onClick={() => onExport(f)}
          >
            {exportBusy === f ? '导出中…' : f.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
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
    <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
      <CodeMirror
        value={content}
        editable={!streaming}
        onChange={onContentChange}
        onUpdate={(u) => onEditorUpdate(u)}
        height="100%"
        theme={editorTheme}
        // v0.24.4（A2）：快捷词补全（";触发词" → 展开文本，设置页维护词典）
        extensions={[markdown(), autocompletion({ override: [makeQuickWordSource(quickWords)] })]}
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
