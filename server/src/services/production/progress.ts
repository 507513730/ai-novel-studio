// 整本生产进度投影（重构计划 R4.3 / spec §3.4）：对 UI 友好的进度结构。
export interface ProductionProgress {
  novelId: number
  total: number
  done: number
  currentChapter: string
  currentAction: string
  failed: number
  qualityDebts: number
}

export function createProgress(novelId: number, total: number): ProductionProgress {
  return {
    novelId,
    total,
    done: 0,
    currentChapter: '',
    currentAction: '准备',
    failed: 0,
    qualityDebts: 0
  }
}
