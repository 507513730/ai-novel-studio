import { useEffect, useRef, useState } from 'react'
import { Brain, CircleAlert, SendHorizontal } from 'lucide-react'
import { hub } from '../api'
import { EmptyState } from './EmptyState'

// v0.26.0（批次 B，审查 P2）：气泡三态（用户/助手/系统）——错误不再以「⚠️」拼进助手正文；
// 助手消息支持受限 markdown（粗体/行内码/代码块/列表/标题，纯 React 元素构造，无 HTML 注入）

interface ChatMsg {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: string[]
}

interface HubChatProps {
  novelId: number
  height?: string
}

/** 行内渲染：**粗体** 与 `行内码` */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`\n]+`)/g
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) parts.push(<strong key={`${keyBase}-${k}`}>{t.slice(2, -2)}</strong>)
    else
      parts.push(
        <code key={`${keyBase}-${k}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.92em', background: 'var(--bg-elevated)', borderRadius: 4, padding: '1px 4px' }}>
          {t.slice(1, -1)}
        </code>
      )
    last = m.index + t.length
    k++
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/** 受限块级渲染：```代码块```、# 标题、- 列表、普通段落 */
function renderMarkdown(text: string): React.ReactNode {
  const segments = text.split(/```(?:\w*)\n?([\s\S]*?)```/g)
  return segments.map((seg, i) => {
    if (i % 2 === 1) {
      return (
        <pre
          key={`cb-${i}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-elevated)', borderRadius: 6, padding: 8, overflowX: 'auto', margin: '4px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {seg.replace(/\n$/, '')}
        </pre>
      )
    }
    const lines = seg.split('\n')
    const out: React.ReactNode[] = []
    let listBuf: string[] = []
    const flushList = (key: string): void => {
      if (listBuf.length === 0) return
      out.push(
        <ul key={`ul-${key}`} style={{ margin: '2px 0', paddingLeft: 18 }}>
          {listBuf.map((item, j) => (
            <li key={j} style={{ margin: '1px 0' }}>{renderInline(item, `${key}-${j}`)}</li>
          ))}
        </ul>
      )
      listBuf = []
    }
    lines.forEach((line, j) => {
      const key = `${i}-${j}`
      if (/^[-*]\s+/.test(line)) {
        listBuf.push(line.replace(/^[-*]\s+/, ''))
        return
      }
      flushList(key)
      if (/^#{1,4}\s+/.test(line)) {
        out.push(
          <div key={`h-${key}`} style={{ fontWeight: 600, marginTop: 4 }}>{renderInline(line.replace(/^#+\s+/, ''), key)}</div>
        )
      } else if (line.trim() === '') {
        out.push(<div key={`sp-${key}`} style={{ height: 6 }} />)
      } else {
        out.push(<div key={`p-${key}`}>{renderInline(line, key)}</div>)
      }
    })
    flushList(`${i}-end`)
    return <div key={`seg-${i}`}>{out}</div>
  })
}

export function HubChat({ novelId, height = '100%' }: HubChatProps): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // v0.9.0（审查 #15）：切换书时重置对话 + 中止在途请求（此前组件复用，上一本书的对话
  // 与在途回复会泄漏到下一本书）
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setBusy(false)
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [novelId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text }])
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const r = await hub.chat(novelId, text, controller.signal)
      setMessages((m) => [...m, { role: 'assistant', content: r.reply, toolCalls: r.toolCalls }])
    } catch (err) {
      if (controller.signal.aborted) return
      // v0.26.0（批次 B）：错误以系统消息条呈现（此前拼「⚠️」伪装成助手回复）
      setMessages((m) => [...m, { role: 'system', content: err instanceof Error ? err.message : String(err) }])
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height, minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ padding: '16px 8px' }}>
            <EmptyState
              icon={Brain}
              title="对话即创作"
              desc="试试说：「这本书什么进度？」「帮我跑一遍自动导演」「写第 1 章」"
            />
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'system' ? (
            <div
              key={i}
              className="row"
              style={{
                alignSelf: 'stretch',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                fontSize: 12,
                alignItems: 'flex-start'
              }}
            >
              <CircleAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{m.content}</span>
            </div>
          ) : (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 12,
                  borderBottomRightRadius: m.role === 'user' ? 4 : 12,
                  borderBottomLeftRadius: m.role === 'user' ? 12 : 4,
                  background: m.role === 'user' ? 'var(--accent-soft)' : 'var(--bg-card)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere'
                }}
              >
                {m.role === 'assistant' ? renderMarkdown(m.content) : m.content}
              </div>
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="muted" style={{ fontSize: 'var(--fs-11)', marginTop: 2 }}>工具：{m.toolCalls.join(' → ')}</div>
              )}
            </div>
          )
        )}
        {busy && <div className="muted t-small">AI 思考中…</div>}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderTop: '1px solid var(--border)' }}>
        <input
          style={{ flex: 1, minWidth: 0, fontSize: 13, padding: '5px 8px' }}
          placeholder="对话即创作…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) void send()
          }}
        />
        <button style={{ fontSize: 12, padding: '4px 10px', flexShrink: 0 }} disabled={busy || !input.trim()} onClick={() => void send()}>
          <SendHorizontal size={12} className="icon-gap" />
          发送
        </button>
      </div>
    </div>
  )
}
