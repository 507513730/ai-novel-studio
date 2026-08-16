import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { automationApi } from '../../api'
import { useToast } from '../../components/Toast'

// v0.23.1（批次 E1）：自 ChapterExecutionPage 提取
// v0.10.0（批B/I2）：质量债待修复徽标——整本生产后自动修复队列的显性入口
// 用户必须"看得明白"：徽标显示待修复章节数，点击后任务入队（任务中心可见），修复上限由服务端保证
export function DebtFixBadge({ novelId }: { novelId: number }): React.JSX.Element | null {
  const { toast } = useToast()
  const [fixing, setFixing] = useState(false)
  const debts = useQuery<{ pendingDebts: number }>({
    queryKey: ['debts', novelId],
    queryFn: () => automationApi.debts(novelId),
    // v0.23.1（批次 E6）：无待修复债时停止轮询（此前 pending=0 后仍每 30s 空转——对齐 AiStatusBar 巡检降频设计）
    refetchInterval: (query) => (Number(query.state.data?.pendingDebts ?? 0) > 0 ? 30_000 : false)
  })
  const pending = debts.data?.pendingDebts ?? 0
  if (pending === 0) return null
  return (
    <div
      className="row"
      style={{
        gap: 8,
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 'var(--radius)',
        background: 'var(--warn-soft)',
        border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
        fontSize: 12
      }}
    >
      <span style={{ color: 'var(--warn)' }}>⚙ 待自动修复 {pending} 章（评分低于 75 的章节）</span>
      <button
        className="sm"
        disabled={fixing}
        onClick={() => {
          setFixing(true)
          void automationApi
            .debtsFix(novelId)
            .then(() => {
              toast('ok', '自动修复任务已入队（任务中心可查看进度）')
              void debts.refetch()
            })
            .catch((err) => toast('error', err instanceof Error ? err.message : String(err)))
            .finally(() => setFixing(false))
        }}
      >
        {fixing ? '排队中…' : '立即修复'}
      </button>
    </div>
  )
}
