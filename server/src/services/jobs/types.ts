// job 域共享类型（重构计划 R2 / spec §3.2）：repository 对上层的 camelCase 契约。
// 禁止把 snake_case 行类型（payload_json 等）散布到本目录之外。
export type JobType = 'director' | 'production' | 'debt-fix' | 'refine-range' | 'solution-chapter'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export const JOB_TYPES: readonly JobType[] = ['director', 'production', 'debt-fix', 'refine-range', 'solution-chapter']

export function isKnownJobType(type: string): type is JobType {
  return (JOB_TYPES as readonly string[]).includes(type)
}

export interface JobRecord {
  id: number
  type: string
  status: JobStatus | string
  progress: number
  payloadJson: string
  resultJson: string
  error: string
  createdAt: string
  updatedAt: string
  startedAt: string | null
  claimToken: string | null
}

// claimNextJob 的返回：claimToken 每次 claim 唯一，迟到协程凭旧 token 的写入一律被拒
export interface ClaimedJob {
  job: JobRecord
  claimToken: string
}

export interface JobPatch {
  progress?: number
  resultJson?: string
  error?: string
  status?: JobStatus
}
