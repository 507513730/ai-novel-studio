import { countTokens } from 'gpt-tokenizer'

// P12 C2/D1：token 与成本估算（cl100k_base 近似 DeepSeek；单价可被 usage_log 历史校准）

// 默认单价（元/千 token，保守值；deepseek-v4-flash 级别）
const DEFAULT_PRICE_IN = 0.002
const DEFAULT_PRICE_OUT = 0.008

let cachedAvg: { in: number; out: number } | null = null

// 从 usage_log 统计真实均价（每千 token 成本估算值），失败时用默认
export function setPriceCache(p: { in: number; out: number }): void {
  cachedAvg = p
}

export function getPriceCache(): { in: number; out: number } {
  return cachedAvg ?? { in: DEFAULT_PRICE_IN, out: DEFAULT_PRICE_OUT }
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  try {
    return countTokens(text)
  } catch {
    // 中文按 1 字 ≈ 1 token 兜底
    return text.length
  }
}

export function estimateCost(text: string, outTokens: number): { tokens: number; cost: number } {
  const inTokens = estimateTokens(text)
  const { in: pi, out: po } = getPriceCache()
  const cost = (inTokens / 1000) * pi + (outTokens / 1000) * po
  return { tokens: inTokens, cost }
}

export function fmtCost(cost: number): string {
  if (cost >= 1) return `约 ¥${cost.toFixed(2)}`
  if (cost >= 0.01) return `约 ¥${cost.toFixed(3)}`
  return '不足 ¥0.01'
}
