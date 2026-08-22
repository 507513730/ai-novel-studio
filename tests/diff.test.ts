// v0.24.2（F3 版本 diff）：行级 Myers 纯逻辑单测——全等/纯增/纯删/混合/退化保护
import { describe, expect, it } from 'vitest'
import { diffLines } from '../server/src/services/diff'

function compact(lines: Array<{ type: string; text: string }>): string[] {
  return lines.map((l) => `${l.type}:${l.text}`)
}

describe('diffLines（F3）', () => {
  it('全等：全 same，0 增 0 删', () => {
    const r = diffLines('第一段\n第二段', '第一段\n第二段')
    expect(compact(r.lines)).toEqual(['same:第一段', 'same:第二段'])
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
    expect(r.degraded).toBe(false)
  })

  it('纯增：新行插入中间', () => {
    const r = diffLines('第一段\n第三段', '第一段\n第二段\n第三段')
    expect(compact(r.lines)).toEqual(['same:第一段', 'add:第二段', 'same:第三段'])
    expect(r.added).toBe(1)
    expect(r.removed).toBe(0)
  })

  it('纯删：行删除', () => {
    const r = diffLines('第一段\n第二段\n第三段', '第一段\n第三段')
    expect(compact(r.lines)).toEqual(['same:第一段', 'del:第二段', 'same:第三段'])
    expect(r.added).toBe(0)
    expect(r.removed).toBe(1)
  })

  it('混合：删一行增一行', () => {
    const r = diffLines('a\nb\nc', 'a\nx\nc')
    expect(compact(r.lines)).toEqual(['same:a', 'del:b', 'add:x', 'same:c'])
    expect(r.added).toBe(1)
    expect(r.removed).toBe(1)
  })

  it('退化保护：中间段超限时 degraded 且不做细粒度对比', () => {
    // 前 100 行全部改写（无公共前缀可修剪）+ 后 150 行相同（后缀修剪到 0）→ 中间段 200 行超限
    const big = Array.from({ length: 250 }, (_, i) => `第${i}行`)
    const changed = Array.from({ length: 250 }, (_, i) => (i < 100 ? `改${i}行` : `第${i}行`))
    const r = diffLines(big.join('\n'), changed.join('\n'), { maxMiddleLines: 50 })
    expect(r.degraded).toBe(true)
    // 退化时：中间全 del+add 对照 + 相同后缀保留（前 100 行全改 → 无公共前缀）
    expect(r.lines.some((l) => l.type === 'del')).toBe(true)
    expect(r.lines.some((l) => l.type === 'add')).toBe(true)
    expect(r.lines[r.lines.length - 1].type).toBe('same')
  })

  it('空内容：旧有正文删光（恢复场景：版本内容 vs 当前空）', () => {
    const r = diffLines('第一段\n第二段', '')
    expect(r.added).toBe(0)
    expect(r.removed).toBe(2)
    expect(r.lines.every((l) => l.type === 'del')).toBe(true)
  })

  it('大文本不超限时工作正常（500 行近似）', () => {
    const a = Array.from({ length: 500 }, (_, i) => `行${i}`)
    const b = [...a].slice()
    b.splice(250, 1, '行250改')
    const r = diffLines(a.join('\n'), b.join('\n'))
    expect(r.degraded).toBe(false)
    expect(r.added).toBe(1)
    expect(r.removed).toBe(1)
  })
})
