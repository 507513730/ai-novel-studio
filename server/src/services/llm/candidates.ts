// LLM 域候选链（重构计划 R6.2）：override 优先 → 主模型（降级标记）→ fallback 链（降级标记）。
// P13 G1：活动模型覆盖（换模型重试）——scheduler 单例执行期间设置，串行安全。
export const RETRYABLE_STATUS = [429, 500, 502, 503, 504]

let activeModelOverride: string | null = null
export function setActiveModelOverride(model: string | null): void {
  activeModelOverride = model
}
export function getActiveModelOverride(): string | null {
  return activeModelOverride
}

// 纯函数：候选链构造（override 模型优先，失败仍可走 fallback）
export function buildCandidates(
  route: { model: string; providerId: number; fallback: Array<{ providerId: number; model: string }> },
  override: string | null
): Array<{ model: string; providerId: number; degraded: boolean }> {
  const head = override ? { model: override, providerId: route.providerId, degraded: false } : null
  return [
    ...(head ? [head] : []),
    { model: route.model, providerId: route.providerId, degraded: head !== null },
    ...route.fallback.map((f) => ({
      model: f.model,
      providerId: f.providerId,
      degraded: true
    }))
  ]
}
