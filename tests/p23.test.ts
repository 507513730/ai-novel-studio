import { describe, it, expect } from 'vitest'
import { splitChapters } from '../server/src/services/assetExtractor'

describe('P23 资产库（分章解析）', () => {
  it('按章节标题分章（第X章/楔子）', () => {
    const text = [
      '楔子',
      '远古时代，天地初开。',
      '',
      '第一章 命运的齿轮',
      '主角在雨夜醒来。',
      '',
      '第二章 重逢',
      '她出现在门口。'
    ].join('\n')
    const chapters = splitChapters(text)
    expect(chapters.length).toBe(3)
    expect(chapters[0].title).toContain('楔子')
    expect(chapters[1].title).toContain('第一章')
    expect(chapters[2].title).toContain('第二章')
    expect(chapters[1].content).toContain('雨夜')
  })

  it('无标题时按空行分段', () => {
    const text = ['第一段内容。', '', '第二段内容。', '', '第三段内容。'].join('\n')
    const chapters = splitChapters(text)
    expect(chapters.length).toBe(3)
    expect(chapters[0].title).toBe('片段 1')
  })

  it('章节上限 300', () => {
    const lines: string[] = []
    for (let i = 1; i <= 400; i++) lines.push(`第${i}章\n内容${i}\n`)
    const chapters = splitChapters(lines.join('\n'))
    expect(chapters.length).toBeLessThanOrEqual(300)
  })
})
