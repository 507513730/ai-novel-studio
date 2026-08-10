import { describe, it, expect } from 'vitest'
import { applyPatches } from '../server/src/services/context'

describe('applyPatches（P2.1 局部补丁）', () => {
  const content = '他推开门，走进昏暗的房间。桌子上的灯闪烁了一下。他深吸一口气，开始调查。'

  it('唯一匹配 → 替换成功', () => {
    const r = applyPatches(content, [
      { target: '桌子上的灯闪烁了一下', replacement: '桌角的台灯忽明忽暗，发出滋滋声' }
    ])
    expect(r).not.toBeNull()
    expect(r).toContain('滋滋声')
    expect(r).toContain('他推开门')
  })

  it('target 不存在 → null（触发降级整章）', () => {
    const r = applyPatches(content, [{ target: '不存在的句子', replacement: 'x' }])
    expect(r).toBeNull()
  })

  it('target 出现多次 → null（非唯一）', () => {
    const dup = '他说：好的。她又说：好的。'
    const r = applyPatches(dup, [{ target: '好的', replacement: '嗯' }])
    expect(r).toBeNull()
  })

  it('空 patches → null', () => {
    expect(applyPatches(content, [])).toBeNull()
  })

  it('多 patch 顺序应用', () => {
    const r = applyPatches(content, [
      { target: '走进昏暗的房间', replacement: '迈入黑暗的仓库' },
      { target: '开始调查', replacement: '翻起卷宗' }
    ])
    expect(r).not.toBeNull()
    expect(r).toContain('黑暗的仓库')
    expect(r).toContain('翻起卷宗')
  })
})
