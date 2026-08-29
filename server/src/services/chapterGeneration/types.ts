// 章节生成域共享类型（spec §3.1）：state.ts 与 persistence.ts 的域内契约。
// generationToken 是章节级生成身份（R4.1）：与 job claim token 不同源、生命周期不同；
// 新一轮抢占覆盖后，旧协程的落库/失败处理被拒。
export interface ClaimedChapter {
  id: number
  novelId: number
  previousStatus: string
  generationToken: string
}

export interface PersistedGeneration {
  content: string
  aborted: boolean
}
