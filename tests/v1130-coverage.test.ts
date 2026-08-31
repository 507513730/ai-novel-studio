import { describe, expect, it } from 'vitest'
import { stripHtmlTags } from '../server/src/services/sanitize'
import { TfidfRetriever, createRetriever } from '../server/src/services/retrieval'
import { compileStyleRules, detectAntiAiHits, extractAntiAiWordsFromRules } from '../server/src/services/styleEngine'
import { computeStyleFingerprint, fingerprintDescription } from '../server/src/services/styleFingerprint'
import { isAllowedOrigin } from '../server/src/services/security'

describe('覆盖率补强：安全与文本边界', () => {
  it('逐字符清洗可处理嵌套、畸形标签并保留标签外文本', () => {
    expect(stripHtmlTags('前<b>中<i>间</b>后')).toBe('前中间后')
    expect(stripHtmlTags('a <broken tag')).toBe('a ')
    expect(stripHtmlTags('无标签文本')).toBe('无标签文本')
    expect(stripHtmlTags(null as unknown as string)).toBe('')
  })

  it('Origin 白名单允许本地来源，拒绝外站', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:4567')).toBe(true)
    expect(isAllowedOrigin('https://evil.example')).toBe(false)
  })
})

describe('覆盖率补强：TF-IDF 检索器', () => {
  it('按相关度排序、限制 topK，并截断超长正文', async () => {
    const r = new TfidfRetriever()
    await r.index([
      { id: 1, title: '楠木盒', content: '林默触碰楠木盒读取物忆。' },
      { id: 2, title: '无关', content: '机场与雨夜。' }
    ])
    expect(r.status()).toEqual({ backend: 'tfidf', indexed: 2 })
    const hits = await r.search('楠木盒 物忆', 1)
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe(1)
    expect(await r.search('   ', 5)).toEqual([])
    expect(await r.search('不存在词', 5)).toEqual([])
  })

  it('embedding 无 provider 时回退 TF-IDF，有 provider 时暴露预留实现', async () => {
    expect(createRetriever('embedding').status().backend).toBe('tfidf')
    const embedding = createRetriever('embedding', { embed: async () => [[1]] })
    expect(embedding.status()).toEqual({ backend: 'embedding', indexed: 0 })
    await expect(embedding.index([])).rejects.toThrow('预留实现位')
  })
})

describe('覆盖率补强：写法规则', () => {
  it('只编译启用特征，生成反 AI 规则并按命中次数排序', () => {
    const rules = compileStyleRules([
      { id: '1', name: '短句', description: '短句', enabled: true, category: 'rhythm' },
      { id: '2', name: '禁用', description: '忽略', enabled: false, category: 'other' }
    ], ['嗯', '套路'])
    expect(rules.enabledFeatures).toHaveLength(1)
    expect(rules.rules[0]).toContain('短句')
    expect(rules.antiAiRules[0]).toContain('嗯、套路')
    expect(detectAntiAiHits('嗯，套路。嗯。', ['嗯', '套路', ''])).toEqual([
      { word: '嗯', count: 2 },
      { word: '套路', count: 1 }
    ])
    expect(extractAntiAiWordsFromRules(rules.antiAiRules)).toEqual(['嗯', '套路'])
  })
})

describe('覆盖率补强：风格指纹边界', () => {
  it('样本不足返回 null，合格样本计算结构指标并生成描述', () => {
    expect(computeStyleFingerprint('短文本。')).toBeNull()
    const sentence = '这是一个用于测试风格统计的句子。'
    const sample = Array.from({ length: 12 }, (_, i) => `${sentence}${i % 3 === 0 ? '\n\n' : ''}`).join('')
    const fp = computeStyleFingerprint(sample.repeat(3))
    expect(fp).not.toBeNull()
    expect(fp!.sentenceCount).toBeGreaterThanOrEqual(10)
    expect(fp!.punctuationDensity).toBeGreaterThan(0)
    expect(fingerprintDescription(fp!)).toContain('模仿以下风格指纹写作')
  })
})
