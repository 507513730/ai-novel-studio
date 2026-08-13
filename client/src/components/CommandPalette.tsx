import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { novelApi } from '../api'

// ============================================================
// P27 2-7：Ctrl+K 命令面板——搜小说 + 跳页面
// ============================================================

const PAGES: Array<{ label: string; to: string; group: string }> = [
  { label: '小说列表', to: '/', group: '导航' },
  { label: '创造工坊', to: '/studio', group: '导航' },
  { label: '创作中枢', to: '/hub', group: '导航' },
  { label: '自动导演', to: '/director', group: '导航' },
  { label: '章节执行', to: '/chapters', group: '导航' },
  { label: '任务中心', to: '/tasks', group: '导航' },
  { label: '知识库', to: '/knowledge', group: '资产' },
  { label: '写法引擎', to: '/style-engine', group: '资产' },
  { label: '世界样本库', to: '/worlds', group: '资产' },
  { label: '推进模式库', to: '/story-modes', group: '资产' },
  { label: '流派管理', to: '/genres', group: '资产' },
  { label: '反 AI 规则', to: '/anti-ai', group: '资产' },
  { label: '标题工坊', to: '/titles', group: '资产' },
  { label: '基础角色库', to: '/base-characters', group: '资产' },
  { label: '拆书', to: '/book-analysis', group: '资产' },
  { label: '提示词工作台', to: '/prompt-workbench', group: '资产' },
  { label: '设置', to: '/settings', group: '系统' },
  { label: '帮助', to: '/help', group: '系统' }
]

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({
    queryKey: ['novels'],
    queryFn: novelApi.list,
    enabled: open
  })

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const pages = PAGES.filter((p) => p.label.toLowerCase().includes(q)).map((p) => ({
      key: 'page:' + p.to,
      label: p.label,
      desc: '页面 · ' + p.group,
      to: p.to
    }))
    const books = (novels.data?.novels ?? [])
      .filter((n) => n.title.toLowerCase().includes(q))
      .map((n) => ({ key: 'novel:' + n.id, label: n.title || `#${n.id}`, desc: '小说', to: `/novels/${n.id}` }))
    return [...pages, ...books]
  }, [query, novels.data])

  if (!open) return null

  const go = (to: string): void => {
    onClose()
    navigate(to)
  }

  return (
    <div
      // v0.17.0（审查 C35）：补 dialog 语义——读屏器识别模态并聚焦
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '15vh', zIndex: 9999 }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 480, background: 'var(--bg-elevated)', padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          style={{ width: '100%', boxSizing: 'border-box', border: 'none', background: 'transparent', padding: '14px 16px', fontSize: 15, outline: 'none' }}
          placeholder="搜索小说或页面…（Esc 关闭）"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSel(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, results.length - 1))
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
            else if (e.key === 'Enter' && results[sel]) go(results[sel].to)
          }}
        />
        <div style={{ maxHeight: 320, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
          {results.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center' }} className="muted t-small">
              {query ? '无匹配结果' : '输入关键字搜索'}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={r.key}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 16px',
                background: i === sel ? 'var(--accent-soft)' : 'transparent',
                border: 'none',
                cursor: 'pointer'
              }}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(r.to)}
            >
              <div style={{ fontSize: 14 }}>{r.label}</div>
              <div className="muted t-small">{r.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
