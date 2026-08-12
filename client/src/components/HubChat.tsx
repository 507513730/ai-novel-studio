import { useEffect, useRef, useState } from 'react'
import { hub } from '../api'

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: string[]
}

interface HubChatProps {
  novelId: number
  height?: string
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
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${err instanceof Error ? err.message : String(err)}` }])
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height, minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: 8 }}>
            试试说：<br />• 「这本书什么进度？」<br />• 「帮我跑一遍自动导演」<br />• 「写第 1 章」
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '95%' }}>
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: m.role === 'user' ? 'var(--accent-soft)' : 'var(--bg-card)',
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere'
              }}
            >
              {m.content}
            </div>
            {m.toolCalls && m.toolCalls.length > 0 && (
              <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>工具：{m.toolCalls.join(' → ')}</div>
            )}
          </div>
        ))}
        {busy && <div className="muted t-small">AI 思考中…</div>}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderTop: '1px solid var(--border)' }}>
        <input
          style={{ flex: 1, fontSize: 13, padding: '5px 8px' }}
          placeholder="对话即创作…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) void send()
          }}
        />
        <button style={{ fontSize: 12, padding: '4px 10px' }} disabled={busy || !input.trim()} onClick={() => void send()}>
          发送
        </button>
      </div>
    </div>
  )
}
