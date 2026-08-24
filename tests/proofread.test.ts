// v0.24.4（A4 轻量校对）：确定性检查纯逻辑单测（重复词/叠词豁免/乱码）
import { describe, expect, it } from 'vitest'
import { detectLocalIssues, detectRepeatWords } from '../server/src/services/proofread'

describe('proofread（A4）', () => {
  it('重复词：多字连续重复被检出', () => {
    const issues = detectRepeatWords('他不断不断追问。')
    expect(issues.some((i) => i.type === 'repeat')).toBe(true)
    expect(issues[0].location).toContain('不断')
  })

  it('AA 型叠词豁免（慢慢/轻轻）——不算错误', () => {
    expect(detectRepeatWords('他慢慢地走过去，轻轻放下。')).toEqual([])
  })

  it('单字三连（哈哈哈）检出', () => {
    const issues = detectRepeatWords('哈哈哈哈')
    expect(issues.length).toBeGreaterThan(0)
  })

  it('乱码：4+ 连续 ? 与替换字符检出', () => {
    const issues = detectLocalIssues('这是正文？？？？然后继续')
    expect(issues.some((i) => i.type === 'mojibake')).toBe(true)
  })

  it('干净文本零问题', () => {
    expect(detectLocalIssues('雨停了，他推门出去。')).toEqual([])
  })
})
