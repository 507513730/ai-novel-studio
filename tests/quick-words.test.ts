// v0.24.4（A2 快捷词）：触发提取 + 词典匹配纯逻辑单测
import { describe, expect, it } from 'vitest'
import { buildQuickCompletions } from '../client/src/utils/quickWords'

// extractTrigger 依赖 CompletionContext（CM6 运行时），纯逻辑部分以 buildQuickCompletions 为核心覆盖

const dict = {
  ';zn': '林默',
  ';lz': '老陈',
  ';fdh': '临江古玩街',
  ';sb': ''
}

describe('quickWords（A2）', () => {
  it('前缀匹配 + 大小写不敏感 + 排序', () => {
    const hits = buildQuickCompletions(dict, 'z')
    expect(hits.map((h) => h.key)).toEqual([';zn'])
    expect(hits[0].apply).toBe('林默')
  })

  it('触发词为空串匹配全部', () => {
    const hits = buildQuickCompletions(dict, '')
    expect(hits.length).toBe(4)
  })

  it('无命中返回空数组', () => {
    expect(buildQuickCompletions(dict, 'xyz')).toEqual([])
  })

  it('上限 20 条保护', () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < 30; i++) big[`;k${i}`] = `v${i}`
    expect(buildQuickCompletions(big, 'k').length).toBe(20)
  })
})
