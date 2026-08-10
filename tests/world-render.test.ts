import { describe, it, expect } from 'vitest'
import { flattenWorldValue, isPlainObject } from '../client/src/workspace/worldRender'

// P11-1.1：世界值递归展平（防 React #31 对象渲染）
describe('flattenWorldValue（P11-1.1）', () => {
  it('字符串值 → 单行', () => {
    expect(flattenWorldValue('描述文本', '地点')).toEqual([{ label: '地点', text: '描述文本', depth: 0 }])
  })

  it('对象值（如 keyLocations）→ 递归展开子键', () => {
    const v = { '苏晚修复工作室': '技艺圣地', '旧防空洞黑市': '地下交易' }
    const rows = flattenWorldValue(v, 'keyLocations')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ label: 'keyLocations', text: '', depth: 0 })
    expect(rows[1]).toEqual({ label: '苏晚修复工作室', text: '技艺圣地', depth: 1 })
    expect(rows[2]).toEqual({ label: '旧防空洞黑市', text: '地下交易', depth: 1 })
  })

  it('数组值 → 逐项展开', () => {
    const rows = flattenWorldValue(['a', 'b'], '列表')
    expect(rows[0]).toEqual({ label: '列表', text: '', depth: 0 })
    expect(rows[1]).toEqual({ label: '', text: 'a', depth: 1 })
    expect(rows[2]).toEqual({ label: '', text: 'b', depth: 1 })
  })

  it('数字/布尔/null → 安全字符串化', () => {
    expect(flattenWorldValue(42, 'n')).toEqual([{ label: 'n', text: '42', depth: 0 }])
    expect(flattenWorldValue(true, 'b')).toEqual([{ label: 'b', text: 'true', depth: 0 }])
    expect(flattenWorldValue(null, 'x')).toEqual([{ label: 'x', text: '—', depth: 0 }])
  })

  it('嵌套对象（对象内对象）→ 多级展开', () => {
    const v = { outer: { inner: 'deep' } }
    const rows = flattenWorldValue(v, 'root')
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2])
    expect(rows[2]).toEqual({ label: 'inner', text: 'deep', depth: 2 })
  })
})

describe('isPlainObject', () => {
  it('纯对象 true；数组/null/字符串 false', () => {
    expect(isPlainObject({ a: 1 })).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('x')).toBe(false)
  })
})
