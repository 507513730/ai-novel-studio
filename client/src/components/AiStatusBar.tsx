import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clapperboard } from 'lucide-react'
import { automationApi } from '../api'
import type { DirectorStatus } from '../../../shared/src/types'

// P11-5：AI 状态条（学习参考项目"AI 接管状态"轻量投影：阶段 + 阻塞原因 + 下一步）
// 有运行中导演任务时显示，3s 轮询；连续失败静默隐藏

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
  const [status, setStatus] = useState<DirectorStatus | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let failCount = 0
    let alive = true
    let inFlight = false
    let timer: ReturnType<typeof setInterval> | null = null
    let wasRunning = true // 初始按"可能运行中"快速轮询
    // v0.9.0（审查 M3）：任务进行中 3s 轮询；任务结束后降频 30s 巡检（此前空转轮询无谓开销）
    const restartTimer = (ms: number): void => {
      if (timer) clearInterval(timer)
      timer = setInterval(tick, ms)
    }
    const tick = (): void => {
      if (inFlight || !alive) return
      inFlight = true
      void automationApi
        .directorStatus(novelId)
        .then((s) => {
          failCount = 0
          const st = s as unknown as DirectorStatus
          setStatus(st)
          const running = RUNNING.includes(st.status)
          setVisible(running)
          if (running !== wasRunning) {
            wasRunning = running
            restartTimer(running ? 3000 : 30_000)
          }
        })
        .catch(() => {
          failCount += 1
          if (failCount >= 3) setVisible(false)
        })
        .finally(() => {
          inFlight = false
        })
    }
    tick()
    timer = setInterval(tick, 3000)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [novelId])

  if (!visible || !status) return null

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
