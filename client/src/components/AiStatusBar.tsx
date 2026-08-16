import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clapperboard } from 'lucide-react'
import { automationApi } from '../api'
import type { DirectorStatus } from '../../../shared/src/types'

// P11-5：AI 状态条（学习参考项目"AI 接管状态"轻量投影：阶段 + 阻塞原因 + 下一步）
// 有运行中导演任务时显示；v0.23.1（批次 E5）：收编 react-query 共享缓存
// （运行中 3s / 空闲 30s 巡检降频——替代手写 setInterval 轮询）

const STAGE_LABELS: Record<string, string> = {
  inspiration: '灵感理解',
  directions: '方向生成',
  framing: '项目设定',
  macro: '宏观规划',
  world: '世界观',
  characters: '角色',
  volumes: '卷战略',
  beats: '节奏板',
  chapters: '章节清单',
  refine: '章节细化',
  ready: '可开写'
}

const RUNNING = ['queued', 'running']

export function AiStatusBar({ novelId }: { novelId: number }): React.JSX.Element | null {
  const navigate = useNavigate()
  const statusQuery = useQuery({
    queryKey: ['director-status', novelId],
    queryFn: async () => (await automationApi.directorStatus(novelId)) as unknown as DirectorStatus,
    refetchInterval: (query) => {
      // v0.9.0（审查 M3）：任务进行中 3s；结束后降频 30s 巡检
      const st = query.state.data as DirectorStatus | undefined
      return RUNNING.includes(st?.status ?? 'queued') ? 3000 : 30_000
    },
    retry: 1
  })
  const status = statusQuery.data ?? null
  const visible = status !== null && RUNNING.includes(status.status)
  if (!visible) return null

  const stageLabel = STAGE_LABELS[status.stage ?? ''] ?? status.stage ?? ''
  const progressKeys = Object.keys(status.progress ?? {})
  const doneCount = Object.values(status.progress ?? {}).filter(Boolean).length
  const totalCount = progressKeys.length

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        marginBottom: 12,
        borderRadius: 'var(--radius)',
        background: 'var(--accent-soft)',
        border: '1px solid var(--accent)',
        fontSize: 13,
        flexWrap: 'wrap'
      }}
    >
      <Clapperboard size={15} style={{ color: 'var(--accent)' }} />
      <strong>自动导演</strong>
      <span className="muted">状态：{status.displayStatus ?? status.status}</span>
      {stageLabel && <span className="muted">阶段：{stageLabel}</span>}
      {totalCount > 0 && (
        <span className="muted">
          步骤：{doneCount}/{totalCount}
        </span>
      )}
      {status.blockingReason && (
        <span style={{ color: 'var(--warn)' }}>阻塞：{status.blockingReason}</span>
      )}
      <button className="sm" style={{ marginLeft: 'auto' }} onClick={() => navigate(`/novels/${novelId}/director`)}>
        前往导演页
      </button>
    </div>
  )
}
