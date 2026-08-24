// v0.24.4（审核基线校准，2026-08-24 实测）：评分/阈值策略统一——LLM 返回的 needsFix 恒 true 不可用，
// 自动修复触发与 needsFix 一律以服务端推导为准（D107：实测基线：高质量 85 / 中等 45-55 / 低质量 30；
// 中等档全量触发修复链 = 成本≈2× 的根源；severity=high 是比原始分数更可靠的质量信号）

export interface ReviewIssueLike {
  severity?: string
}

/**
 * 自动修复触发条件（D107 校准值）：
 * - score < 60：硬分线——明显不达标，必修
 * - 60 ≤ score < 75 且存在 high 问题：有实质硬伤，修
 * - 60 ≤ score < 75 仅 medium/low：登记质量债（软债），不自动修（省 2-3 次 LLM/章）
 * - score ≥ 75：达标，不修
 */
export function isFixWarranted(score: number, issues: Array<ReviewIssueLike>): boolean {
  if (score < 60) return true
  if (score < 75) return issues.some((i) => i.severity === 'high')
  return false
}

/** needsFix 服务端推导（替代 LLM 字段——展示与自动修复行为一致） */
export function deriveNeedsFix(score: number, issues: Array<ReviewIssueLike>): boolean {
  return isFixWarranted(score, issues)
}
