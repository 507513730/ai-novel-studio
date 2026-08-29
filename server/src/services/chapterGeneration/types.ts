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
  note?: string // 版本快照注释（默认 'AI 生成' / 'AI 生成（中止）'；方案流水线用 'AI 生产（方案流水线）'）
  title?: string // 产出附标题（非空时覆盖章节标题；方案流水线 R4.3）
}
