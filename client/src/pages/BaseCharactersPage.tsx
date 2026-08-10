import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { UsersRound } from 'lucide-react'
import { novelApi } from '../api'

// P16 P1：基础角色库（跨书角色一览，作为模板沉淀入口）
export function BaseCharactersPage(): React.JSX.Element {
  const navigate = useNavigate()
  const novels = useQuery<{ novels: Array<{ id: number; title: string }> }>({
    queryKey: ['novels'],
    queryFn: novelApi.list
  })
  const [charsByNovel, setCharsByNovel] = useState<Record<number, Array<{ id: number; name: string; status: string; profile: Record<string, unknown> }>>>({})

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <UsersRound size={20} />
        <h1 style={{ marginLeft: 8 }}>基础角色库</h1>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        跨书查看所有角色（名册+待确认），点击进入对应书的角色工作台做精修。沉淀跨书模板的能力将在后续版本开放。
      </p>
      <div className="col" style={{ gap: 12 }}>
        {novels.data?.novels.map((n) => (
          <NovelChars key={n.id} novelId={n.id} title={n.title} chars={charsByNovel[n.id]} onLoad={(list) => setCharsByNovel((m) => ({ ...m, [n.id]: list }))} onOpen={() => navigate(`/novels/${n.id}/?tab=characters`)} />
        ))}
        {novels.data?.novels.length === 0 && <p className="muted">还没有小说。</p>}
      </div>
    </div>
  )
}

function NovelChars({ novelId, title, chars, onLoad, onOpen }: {
  novelId: number
  title: string
  chars: Array<{ id: number; name: string; status: string; profile: Record<string, unknown> }> | undefined
  onLoad: (list: Array<{ id: number; name: string; status: string; profile: Record<string, unknown> }>) => void
  onOpen: () => void
}): React.JSX.Element {
  const q = useQuery({
    queryKey: ['chars', novelId],
    queryFn: () => novelApi.characters(novelId),
    enabled: chars === undefined
  })
  if (chars === undefined && q.data) onLoad(q.data.characters)
  const list = chars ?? q.data?.characters
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{title} <span className="muted" style={{ fontSize: 12 }}>#{novelId}</span></strong>
        <button className="sm" onClick={onOpen}>进入角色工作台</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {(list ?? []).map((c) => (
          <span key={c.id} className="chip">
            {c.name}
            <span className="muted" style={{ marginLeft: 4 }}>{c.status === 'pending' ? '待确认' : '名册'}</span>
          </span>
        ))}
        {list === undefined && <span className="muted" style={{ fontSize: 12 }}>加载中…</span>}
      </div>
    </div>
  )
}
