// 章节生成域共享类型（spec §3.1）：state.ts 与 persistence.ts 的域内契约
export interface ClaimedChapter {
  id: number
  novelId: number
  previousStatus: string
}

export interface PersistedGeneration {
  content: string
  aborted: boolean
}
