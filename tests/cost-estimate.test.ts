import { describe, it, expect } from 'vitest'
import { estimateTokens, estimateCost, fmtCost } from '../client/src/utils/costEstimate'

// P12 C2/D1：token/成本估算
describe('costEstimate（P12 C2/D1）', () => {
  it('空文本 → 0 token', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('中文文本 token 估算为正数', () => {
    const t = estimateTokens('他推开门，走进昏暗的房间。')
    expect(t).toBeGreaterThan(0)
    expect(Number.isFinite(t)).toBe(true)
  })

  it('成本估算为有限正数（默认单价）', () => {
    const { tokens, cost } = estimateCost('你好世界', 1000)
    expect(tokens).toBeGreaterThan(0)
    expect(Number.isFinite(cost)).toBe(true)
    expect(cost).toBeGreaterThan(0)
  })

  it('fmtCost 三档格式化', () => {
    expect(fmtCost(1.5)).toBe('约 ¥1.50')
    expect(fmtCost(0.05)).toBe('约 ¥0.050')
    expect(fmtCost(0.001)).toBe('不足 ¥0.01')
  })
})
