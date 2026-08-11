import { useRef, useState } from 'react'
import { ErrorMsg } from '../components/ErrorMsg'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { novelApi } from '../api'
import { flattenWorldValue } from './worldRender'

export function WorldPanel({ novelId, onDirtyChange }: { novelId: number; onDirtyChange?: (dirty: boolean) => void }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingManual, setEditingManual] = useState(false)
  const [manualText, setManualText] = useState('')
  const savedManualRef = useRef('')
  const notifyDirty = (v: boolean): void => onDirtyChange?.(v)

  const world = useQuery({
    queryKey: ['world', novelId],
    queryFn: () => novelApi.world(novelId)
  })
  const data = world.data?.world

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['world', novelId] })

  const generate = useMutation({
    mutationFn: (guidance?: string) => novelApi.worldGenerate(novelId, guidance),
    onSuccess: () => void invalidate(),
    onError: (err) => setError(err instanceof Error ? err.message : String(err))
  })
  // P23（N4）：生成引导输入
  const [genGuidance, setGenGuidance] = useState('')

  const saveManual = async (): Promise<void> => {
    try {
      const manual = JSON.parse(manualText) as Record<string, string>
      await novelApi.worldPatch(novelId, { manual })
      setEditingManual(false)
      notifyDirty(false)
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="col">
      {error && <ErrorMsg error={error} />}
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>世界观</h2>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input
              style={{ width: 220 }}
              placeholder="可选：本次生成要求（如：蒸汽朋克背景、三足鼎立势力）"
              value={genGuidance}
              onChange={(e) => setGenGuidance(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setError(null)
                void generate.mutateAsync(genGuidance.trim() || undefined).finally(() => setBusy(false))
              }}
            >
              {busy ? '生成中（分 3 步，约 1 分钟）…' : data?.manual && Object.keys(data.manual).length > 0 ? '重新生成' : 'AI 生成世界观'}
            </button>
          </div>
        </div>

        {/* 手册（P11-1.1：递归渲染对象/数组值，防 React #31） */}
        <h3 style={{ margin: '14px 0 8px', fontSize: 14 }}>世界手册</h3>
        {!editingManual && data?.manual && Object.keys(data.manual).length > 0 && (
          <div className="panel" style={{ background: 'var(--bg-card)' }}>
            {Object.entries(data.manual).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6 }}>
                <strong>{k}：</strong>
                {flattenWorldValue(v).map((row, i) => (
                  <span key={i} className="muted" style={{ display: 'block', paddingLeft: 12 }}>
                    {row.label ? `${row.label}：` : ''}{row.text}
                  </span>
                ))}
              </div>
            ))}
            <button style={{ marginTop: 8 }} onClick={() => { savedManualRef.current = JSON.stringify(data.manual, null, 2); setManualText(savedManualRef.current); setEditingManual(true) }}>
              编辑
            </button>
          </div>
        )}
        {editingManual && (
          <div className="col">
            <textarea
              style={{ width: '100%', minHeight: 200, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontFamily: 'monospace', fontSize: 12 }}
              value={manualText}
              onChange={(e) => { setManualText(e.target.value); notifyDirty(e.target.value !== savedManualRef.current) }}
            />
            <div className="row">
              <button className="primary" onClick={() => void saveManual()}>保存</button>
              {/* P14 B3：编辑中取消需确认（有改动时） */}
              <button
                onClick={() => {
                  if (manualText !== savedManualRef.current) {
                    if (!window.confirm('世界手册有未保存的改动，取消将丢弃。继续？')) return
                  }
                  setEditingManual(false)
                  notifyDirty(false)
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 势力 */}
        {data && data.factions.length > 0 && (
          <>
            <h3 style={{ margin: '14px 0 8px', fontSize: 14 }}>势力</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {data.factions.map((f, i) => (
                <div key={i} className="panel" style={{ background: 'var(--bg-card)' }}>
                  <strong>{f.name}</strong>
                  {f.stance && <span className="badge" style={{ marginLeft: 8 }}>{f.stance}</span>}
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 关键地点（P11-1.1：keyLocations 等值为对象 → 递归渲染） */}
        {data && Object.keys(data.map).length > 0 && (
          <>
            <h3 style={{ margin: '14px 0 8px', fontSize: 14 }}>关键地点</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {Object.entries(data.map).map(([k, v]) => (
                <div key={k} className="panel" style={{ background: 'var(--bg-card)' }}>
                  <strong>{k}</strong>
                  {flattenWorldValue(v).map((row, i) => (
                    <div key={i} className="muted" style={{ fontSize: 12, marginTop: 4, paddingLeft: 8 }}>
                      {row.label ? `${row.label}：` : ''}{row.text}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
        {(!data || Object.keys(data.manual ?? {}).length === 0) && (
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            点击"AI 生成世界观"自动构建手册 / 势力 / 地图（分步生成，防止长 JSON 截断）。
          </p>
        )}
      </div>
    </div>
  )
}
