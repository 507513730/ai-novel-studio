// v0.15.0：创作约束面板——用户强调的事项（主角名/叙事红线/禁写内容）分级维护。
// 硬约束（MUST）：全链强制注入 + 产出自动校验；软偏好（SHOULD）：注入但不校验。
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { novelApi } from '../api'
import type { NovelConstraint } from '@shared/types'
import { Plus, Trash2, ShieldCheck, Feather, AlertTriangle } from 'lucide-react'

interface Props {
  novelId: number
}

const LEVEL_HINT: Record<string, string> = {
  must: '不可违反（主角名、叙事红线、禁写内容）——全链强制注入，产出自动校验，违反自动修正',
  should: '倾向性偏好（文风、节奏、爽点密度）——注入但不强制校验'
}

export function ConstraintPanel({ novelId }: Props): React.JSX.Element {
  const qc = useQueryClient()
  const { data: novel } = useQuery({ queryKey: ['novel', novelId], queryFn: () => novelApi.detail(novelId) })
  const [text, setText] = useState('')
  const [level, setLevel] = useState<'must' | 'should'>('must')
  const [canonName, setCanonName] = useState('')

  const save = useMutation({
    mutationFn: (list: NovelConstraint[]) => novelApi.patch(novelId, { constraints: list }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['novel', novelId] })
    }
  })

  const list: NovelConstraint[] = novel?.novel?.constraints ?? []
  const pending = save.isPending

  const add = (): void => {
    const t = text.trim()
    if (!t || pending) return
    const item: NovelConstraint = {
      id: `c${Date.now()}`,
      text: t,
      level,
      enabled: true,
      createdAt: new Date().toISOString(),
      // 主角名类：文本含「主角」且填了规范名 → 全链自动对齐（角色表/正文替换）
      ...(t.includes('主角') && canonName.trim() ? { keyword: canonName.trim(), replaceWith: canonName.trim() } : {})
    }
    void save.mutateAsync([...list, item]).then(() => {
      setText('')
      setCanonName('')
    })
  }

  const update = (c: NovelConstraint, patch: Partial<NovelConstraint>): void => {
    void save.mutateAsync(list.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))
  }

  const remove = (id: string): void => {
    void save.mutateAsync(list.filter((x) => x.id !== id))
  }

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <ShieldCheck size={15} color="var(--accent-bright)" />
        <h3 style={{ margin: 0 }}>创作约束</h3>
      </div>
      <p className="muted t-small" style={{ margin: '4px 0 12px' }}>
        这里维护你强调的创作事项——主角名、叙事红线、禁写内容等。硬约束会注入导演 / 方案 / 章节生成 / 自动修复全链路，
        并在产出后自动校验修正（吸取教训：主角名曾漂移成 3 个名字）。
      </p>

      {/* 新增 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="如：主角必须叫 Jing / 不许虐主 / 系统金手指保持克制"
          style={{ flex: 1, minWidth: 260 }}
        />
        <select value={level} onChange={(e) => setLevel(e.target.value as 'must' | 'should')} title="级别">
          <option value="must">硬约束</option>
          <option value="should">软偏好</option>
        </select>
        <button className="primary" onClick={add} disabled={pending}>
          <Plus size={13} /> 添加
        </button>
      </div>
      {text.includes('主角') && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <AlertTriangle size={13} color="var(--warn)" />
          <span className="muted t-small">检测到「主角」——填规范名后角色表与正文将自动对齐（如：Jing）：</span>
          <input value={canonName} onChange={(e) => setCanonName(e.target.value)} placeholder="主角规范名" style={{ width: 140 }} />
        </div>
      )}

      {/* 列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.length === 0 && <p className="muted t-small" style={{ margin: 0 }}>暂无约束——添加一条试试（示例：主角必须叫 Jing）。</p>}
        {list.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 'var(--radius-m)',
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              opacity: c.enabled ? 1 : 0.5
            }}
          >
            {c.level === 'must' ? <ShieldCheck size={14} color="var(--accent-bright)" /> : <Feather size={14} color="var(--text-dim)" />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5 }}>{c.text}</div>
              <div className="muted t-small" style={{ marginTop: 2 }}>
                {c.level === 'must' ? '硬约束' : '软偏好'} · {c.enabled ? '生效中' : '已停用'}
                {c.keyword ? ` · 规范名：${c.keyword}（正文自动对齐）` : ''}
              </div>
            </div>
            <span className="t-small muted" title={LEVEL_HINT[c.level]} style={{ cursor: 'help' }}>
              {c.level === 'must' ? '不可违反' : '倾向性'}
            </span>
            <button className="sm" onClick={() => update(c, { level: c.level === 'must' ? 'should' : 'must' })} disabled={pending}>
              {c.level === 'must' ? '改偏好' : '改硬性'}
            </button>
            <button className="sm" onClick={() => update(c, { enabled: !c.enabled })} disabled={pending}>
              {c.enabled ? '停用' : '启用'}
            </button>
            <button className="sm" onClick={() => remove(c.id)} disabled={pending} style={{ color: 'var(--danger)' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
