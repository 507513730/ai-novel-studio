// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  BackfillResultPanel,
  ContextPanel,
  EmptyStateGuide,
  PendingPanel,
  ProgressMatrix,
  ProofreadPanel,
  ResourceDetailPanel,
  SuggestionOverlay
} from '../client/src/pages/chapter/ChapterPanels'
import { MemoryPanel, ReviewResultPanel } from '../client/src/pages/chapter/ReviewPanel'
import { VersionHistoryPanel } from '../client/src/pages/chapter/VersionHistoryPanel'
import { countCjk } from '../client/src/pages/chapter/types'

// v0.25.0（审查 M1）：ChapterExecutionPage 拆分出的面板组件测试。
// 这些组件承载了章节页绝大部分展示逻辑，此前完全无测试覆盖。

afterEach(() => cleanup())

describe('ProgressMatrix（本章进度矩阵）', () => {
  it('渲染完成计数与全部段标签', () => {
    render(<ProgressMatrix segments={[['任务单', true], ['草稿', false], ['审核', false]]} />)
    expect(screen.getByText('1/3')).toBeTruthy()
    for (const label of ['任务单', '草稿', '审核']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('已完成段的 title 带 ✓ 标记', () => {
    render(<ProgressMatrix segments={[['任务单', true], ['草稿', false]]} />)
    expect(screen.getByTitle('任务单 ✓')).toBeTruthy()
    expect(screen.getByTitle('草稿')).toBeTruthy()
  })
})

describe('ResourceDetailPanel（资源详情）', () => {
  it('渲染标题与正文', () => {
    render(<ResourceDetailPanel detail={{ title: '张三', body: '身份：主角' }} onClose={() => undefined} />)
    expect(screen.getByText('张三')).toBeTruthy()
    expect(screen.getByText('身份：主角')).toBeTruthy()
  })

  it('正文为空时显示占位文案', () => {
    render(<ResourceDetailPanel detail={{ title: '空', body: '' }} onClose={() => undefined} />)
    expect(screen.getByText('（无内容）')).toBeTruthy()
  })

  it('点击 ✕ 触发关闭回调', () => {
    const onClose = vi.fn()
    render(<ResourceDetailPanel detail={{ title: 'x', body: 'y' }} onClose={onClose} />)
    fireEvent.click(screen.getByText('✕'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('PendingPanel（待确认区）', () => {
  it('渲染未确认事实与待确认角色', () => {
    render(
      <PendingPanel
        pending={{
          pendingFacts: [{ id: 1, content: '主角受伤' }],
          pendingCharacters: [{ id: 2, name: '李四', profile: {} }]
        }}
        onClose={() => undefined}
      />
    )
    expect(screen.getByText('• 主角受伤')).toBeTruthy()
    expect(screen.getByText('• 李四')).toBeTruthy()
  })

  it('两项均为空时显示「暂无待确认项」', () => {
    render(<PendingPanel pending={{ pendingFacts: [], pendingCharacters: [] }} onClose={() => undefined} />)
    expect(screen.getByText('暂无待确认项')).toBeTruthy()
  })

  it('pending 为 null 时不渲染空态文案', () => {
    render(<PendingPanel pending={null} onClose={() => undefined} />)
    expect(screen.queryByText('暂无待确认项')).toBeNull()
  })
})

describe('BackfillResultPanel（回灌结果）', () => {
  it('渲染角色状态 / 新事实 / 新伏笔', () => {
    render(
      <BackfillResultPanel
        result={{
          characterStates: [{ name: '张三', state: '受伤' }],
          newFacts: [{ content: '城门已关' }],
          foreshadows: [{ content: '玉佩来历' }]
        }}
        busy={false}
        onConfirm={() => undefined}
      />
    )
    expect(screen.getByText('• 张三：受伤')).toBeTruthy()
    expect(screen.getByText('• 城门已关')).toBeTruthy()
    expect(screen.getByText('• 玉佩来历')).toBeTruthy()
  })

  it('点击确认入账触发回调', () => {
    const onConfirm = vi.fn()
    render(<BackfillResultPanel result={{}} busy={false} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByText('确认角色状态入账'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('busy 时确认按钮禁用', () => {
    const onConfirm = vi.fn()
    render(<BackfillResultPanel result={{}} busy onConfirm={onConfirm} />)
    const btn = screen.getByText('确认角色状态入账') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('ProofreadPanel（本地校对结果）', () => {
  it('无问题时显示通过文案', () => {
    render(<ProofreadPanel issues={[]} onClose={() => undefined} />)
    expect(screen.getByText(/未发现明显问题/)).toBeTruthy()
    expect(screen.getByText('校对结果（0 条）')).toBeTruthy()
  })

  it('渲染问题条数与类型徽标（错别字/乱码）', () => {
    render(
      <ProofreadPanel
        issues={[
          // problem 文案刻意不与徽标文案（错别字/乱码）重名，避免 getByText 匹配到多个节点
          { type: 'typo', location: '第一句', problem: '用词不当', suggestion: '修正' },
          { type: 'mojibake', location: '第二句', problem: '出现乱码字符', suggestion: '删除' }
        ]}
        onClose={() => undefined}
      />
    )
    expect(screen.getByText('校对结果（2 条）')).toBeTruthy()
    expect(screen.getByText('错别字')).toBeTruthy()
    expect(screen.getByText('乱码')).toBeTruthy()
  })

  it('点击关闭触发回调', () => {
    const onClose = vi.fn()
    render(<ProofreadPanel issues={[]} onClose={onClose} />)
    fireEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ContextPanel（写作上下文）', () => {
  const sections = [
    { key: 'world', label: '世界', chars: 100, tokens: 42.4 },
    { key: 'characters', label: '角色', chars: 200, tokens: 80 }
  ]

  it('渲染分区名与 token 数（四舍五入）', () => {
    render(<ContextPanel sections={sections} toggles={{}} onToggle={() => undefined} onClose={() => undefined} />)
    expect(screen.getByText('42 tokens')).toBeTruthy()
    expect(screen.getByText('80 tokens')).toBeTruthy()
  })

  it('未显式配置时默认勾选', () => {
    render(<ContextPanel sections={sections} toggles={{}} onToggle={() => undefined} onClose={() => undefined} />)
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.every((b) => b.checked)).toBe(true)
  })

  it('切换勾选回调传出分区 key', () => {
    const onToggle = vi.fn()
    render(<ContextPanel sections={sections} toggles={{ world: false }} onToggle={onToggle} onClose={() => undefined} />)
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes[0].checked).toBe(false)
    fireEvent.click(boxes[0])
    expect(onToggle).toHaveBeenCalledWith('world')
  })
})

describe('SuggestionOverlay（续写建议浮层）', () => {
  it('生成中且无建议时显示等待态', () => {
    render(
      <SuggestionOverlay
        suggestion={null}
        busy
        onAccept={() => undefined}
        onRegenerate={() => undefined}
        onClose={() => undefined}
      />
    )
    expect(screen.getByText(/正在生成续写建议/)).toBeTruthy()
  })

  it('渲染建议文本与中文字数', () => {
    render(
      <SuggestionOverlay
        suggestion={{ text: '测试内容', pos: 0 }}
        busy={false}
        onAccept={() => undefined}
        onRegenerate={() => undefined}
        onClose={() => undefined}
      />
    )
    expect(screen.getByText('测试内容')).toBeTruthy()
    expect(screen.getByText(`（${countCjk('测试内容')} 字）`)).toBeTruthy()
  })

  it('Tab 插入 / 再生成 / 关闭 三个回调各自触发', () => {
    const onAccept = vi.fn()
    const onRegenerate = vi.fn()
    const onClose = vi.fn()
    render(
      <SuggestionOverlay
        suggestion={{ text: 'x', pos: 0 }}
        busy={false}
        onAccept={onAccept}
        onRegenerate={onRegenerate}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByText('Tab 插入'))
    fireEvent.click(screen.getByText('↻ 再生成'))
    fireEvent.click(screen.getByText('Esc 关闭'))
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('EmptyStateGuide（空章节引导）', () => {
  it('渲染本章概要', () => {
    render(<EmptyStateGuide summary="初入江湖" busy={false} onGenerate={() => undefined} />)
    expect(screen.getByText(/初入江湖/)).toBeTruthy()
  })

  it('点击生成触发回调；busy 时按钮禁用', () => {
    const onGenerate = vi.fn()
    const { unmount } = render(<EmptyStateGuide busy={false} onGenerate={onGenerate} />)
    fireEvent.click(screen.getByText('✍️ 生成正文'))
    expect(onGenerate).toHaveBeenCalledTimes(1)
    unmount()

    render(<EmptyStateGuide busy onGenerate={onGenerate} />)
    const btn = screen.getByText('✍️ 生成正文') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})

describe('ReviewResultPanel（审核结果）', () => {
  // 排序后：high(a) → medium(b) → low(c) → low(d)；
  // 稳定排序下 top3 取 a/b/c，d（第四条）被截断，仅出现在下方「全部问题」列表
  const review = {
    score: 72,
    issues: [
      { severity: 'high', location: 'a', problem: '高优先问题', suggestion: 's1' },
      { severity: 'medium', location: 'b', problem: '中优先问题', suggestion: 's2' },
      { severity: 'low', location: 'c', problem: '低优先问题', suggestion: 's3' },
      { severity: 'low', location: 'd', problem: '第四条', suggestion: 's4' }
    ]
  }

  it('渲染评分', () => {
    render(<ReviewResultPanel review={review} streaming={false} busy={false} onAdopt={() => undefined} />)
    expect(screen.getByText('评分 72')).toBeTruthy()
  })

  it('优先建议按 severity 排序且只取前 3 条', () => {
    render(<ReviewResultPanel review={review} streaming={false} busy={false} onAdopt={() => undefined} />)
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(items).toHaveLength(3)
    expect(items[0]).toContain('高优先问题')
    expect(items[1]).toContain('中优先问题')
    expect(items[2]).toContain('低优先问题')
    // 同为 low 的「第四条」因排序靠后而被截断
    expect(items.join('')).not.toContain('第四条')
  })

  it('全部问题列表渲染 4 条（含被优先建议截断的第四条）', () => {
    render(<ReviewResultPanel review={review} streaming={false} busy={false} onAdopt={() => undefined} />)
    expect(screen.getByText('第四条')).toBeTruthy()
  })

  it('采纳建议传出拼装好的建议文本', () => {
    const onAdopt = vi.fn()
    render(<ReviewResultPanel review={review} streaming={false} busy={false} onAdopt={onAdopt} />)
    fireEvent.click(screen.getByText('采纳建议并重写'))
    const advice = onAdopt.mock.calls[0][0] as string
    expect(advice).toContain('a：高优先问题（建议：s1）')
    expect(advice).toContain('b：中优先问题（建议：s2）')
    expect(advice).toContain('c：低优先问题（建议：s3）')
    expect(advice).not.toContain('第四条')
  })

  it('无 issues 时不渲染建议区块', () => {
    render(
      <ReviewResultPanel review={{ score: 90 }} streaming={false} busy={false} onAdopt={() => undefined} />
    )
    expect(screen.queryByText('采纳建议并重写')).toBeNull()
  })
})

describe('MemoryPanel（记忆面）', () => {
  const memory = {
    characters: [
      { name: '张三', states: ['受伤', '愤怒'] },
      { name: '无名', states: [] }
    ],
    factions: [{ name: '青云宗', currentState: '戒备' }],
    pendingFacts: [{ id: 1, content: '城门已关' }]
  }

  it('只渲染有状态的角色，跳过空状态角色', () => {
    render(
      <MemoryPanel
        memory={memory}
        patchBusy={false}
        onPatchCharState={() => undefined}
        onPatchFactionState={() => undefined}
        onClose={() => undefined}
      />
    )
    expect(screen.getByText('张三')).toBeTruthy()
    expect(screen.queryByText('无名')).toBeNull()
  })

  it('渲染角色状态、势力状态与待确认事实计数', () => {
    render(
      <MemoryPanel
        memory={memory}
        patchBusy={false}
        onPatchCharState={() => undefined}
        onPatchFactionState={() => undefined}
        onClose={() => undefined}
      />
    )
    expect(screen.getByText(/受伤/)).toBeTruthy()
    expect(screen.getByText('青云宗')).toBeTruthy()
    expect(screen.getByText('待确认事实（1）：')).toBeTruthy()
  })

  it('删除角色状态传出 (name, state, remove=true)', () => {
    const onPatchCharState = vi.fn()
    render(
      <MemoryPanel
        memory={memory}
        patchBusy={false}
        onPatchCharState={onPatchCharState}
        onPatchFactionState={() => undefined}
        onClose={() => undefined}
      />
    )
    const removeBtns = screen.getAllByTitle('删除此状态')
    fireEvent.click(removeBtns[0])
    expect(onPatchCharState).toHaveBeenCalledWith('张三', '受伤', true)
  })

  it('patchBusy 时删除按钮禁用', () => {
    render(
      <MemoryPanel
        memory={memory}
        patchBusy
        onPatchCharState={() => undefined}
        onPatchFactionState={() => undefined}
        onClose={() => undefined}
      />
    )
    const removeBtns = screen.getAllByTitle('删除此状态') as HTMLButtonElement[]
    expect(removeBtns.every((b) => b.disabled)).toBe(true)
  })
})

describe('VersionHistoryPanel（版本历史）', () => {
  const versions = [
    { id: 3, note: '手动快照', createdAt: '2026-08-20 10:00', wordCount: 1200, preview: '前文…' },
    { id: 2, note: '生成前', createdAt: '2026-08-19 09:00', wordCount: 800, preview: '旧文…' }
  ]

  it('渲染版本条目（编号/备注/时间/字数/预览）', () => {
    render(
      <VersionHistoryPanel
        versions={versions}
        versionDiff={null}
        busy={false}
        streaming={false}
        actions={{ view: () => undefined, restore: () => undefined, diff: () => undefined }}
        onClose={() => undefined}
      />
    )
    expect(screen.getByText('#3')).toBeTruthy()
    expect(screen.getByText('手动快照 · 2026-08-20 10:00 · 1200 字')).toBeTruthy()
    expect(screen.getByText('前文…')).toBeTruthy()
  })

  it('空版本列表显示引导文案', () => {
    render(
      <VersionHistoryPanel
        versions={[]}
        versionDiff={null}
        busy={false}
        streaming={false}
        actions={{ view: () => undefined, restore: () => undefined, diff: () => undefined }}
        onClose={() => undefined}
      />
    )
    expect(screen.getByText(/暂无版本/)).toBeTruthy()
  })

  it('查看/恢复/对比 动作传出完整版本对象', () => {
    const actions = { view: vi.fn(), restore: vi.fn(), diff: vi.fn() }
    render(
      <VersionHistoryPanel
        versions={versions}
        versionDiff={null}
        busy={false}
        streaming={false}
        actions={actions}
        onClose={() => undefined}
      />
    )
    fireEvent.click(screen.getAllByText('查看')[0])
    fireEvent.click(screen.getAllByText('恢复')[0])
    fireEvent.click(screen.getAllByText('对比当前')[0])
    expect(actions.view).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }))
    expect(actions.restore).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }))
    expect(actions.diff).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }))
  })

  it('仅当前对比版本下渲染 diff 行（+/- 前缀）', () => {
    const diff = {
      versionId: 3,
      added: 2,
      removed: 1,
      degraded: false,
      lines: [
        { type: 'same' as const, text: '相同行' },
        { type: 'add' as const, text: '新增行' },
        { type: 'del' as const, text: '删除行' }
      ]
    }
    render(
      <VersionHistoryPanel
        versions={versions}
        versionDiff={diff}
        busy={false}
        streaming={false}
        actions={{ view: () => undefined, restore: () => undefined, diff: () => undefined }}
        onClose={() => undefined}
      />
    )
    expect(screen.getByText('v3 vs 当前：+2 / -1')).toBeTruthy()
    expect(screen.getByText(/\+ 新增行/)).toBeTruthy()
    expect(screen.getByText(/- 删除行/)).toBeTruthy()
  })

  it('busy 时三个动作按钮禁用', () => {
    render(
      <VersionHistoryPanel
        versions={versions}
        versionDiff={null}
        busy
        streaming={false}
        actions={{ view: () => undefined, restore: () => undefined, diff: () => undefined }}
        onClose={() => undefined}
      />
    )
    expect((screen.getAllByText('查看')[0] as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getAllByText('恢复')[0] as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getAllByText('对比当前')[0] as HTMLButtonElement).disabled).toBe(true)
  })
})
