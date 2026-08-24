// v0.24.4（审核基线校准，D107）：isFixWarranted / deriveNeedsFix 纯逻辑单测
// 实测基线（2026-08-24，官方直连 flash 6 次调用）：高质量 85/85 · 中等 45/55 · 低质量 30/30；
// 阈值语义：<60 必修；60-74 有 high 才修；≥75 不修
import { describe, expect, it } from 'vitest'
import { isFixWarranted, deriveNeedsFix } from '../server/src/services/reviewPolicy'

const issues = (severities: string[]): Array<{ severity: string }> => severities.map((severity) => ({ severity }))

describe('reviewPolicy（审核基线校准）', () => {
  it('<60 必修（无 issues 也修——低分本身就是硬信号）', () => {
    expect(isFixWarranted(30, issues(['high', 'high']))).toBe(true)
    expect(isFixWarranted(55, issues(['medium']))).toBe(true)
    expect(isFixWarranted(59, [])).toBe(true)
  })

  it('60-74 有 high 才修', () => {
    expect(isFixWarranted(65, issues(['high', 'medium']))).toBe(true)
    expect(isFixWarranted(64, issues(['high']))).toBe(true)
    expect(isFixWarranted(72, issues(['high']))).toBe(true)
  })

  it('60-74 仅 medium/low：不自动修（软债）', () => {
    expect(isFixWarranted(60, issues(['medium']))).toBe(false)
    expect(isFixWarranted(74, issues(['low', 'medium']))).toBe(false)
  })

  it('≥75 不修（高质量章 85 分场景）', () => {
    expect(isFixWarranted(75, issues(['high']))).toBe(false)
    expect(isFixWarranted(85, issues(['medium', 'low']))).toBe(false)
    expect(isFixWarranted(100, [])).toBe(false)
  })

  it('deriveNeedsFix 与 isFixWarranted 一致（展示=行为）', () => {
    expect(deriveNeedsFix(45, issues(['medium']))).toBe(true)
    expect(deriveNeedsFix(70, issues(['medium']))).toBe(false)
    expect(deriveNeedsFix(85, issues(['low']))).toBe(false)
  })
})
