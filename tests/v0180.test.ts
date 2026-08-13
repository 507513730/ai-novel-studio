// v0.18.0：联网查找（零 key Wikipedia；开关门控 + 搜索降级）
import { describe, expect, it, afterEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { isWebSearchEnabled, setWebSearchEnabled, searchWeb, buildWebContextBlock } from '../server/src/services/webSearch'

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db)
  return db
}

const PREFIX = 'v0.18.0 联网查找'

describe(`${PREFIX} · 开关`, () => {
  it('v19 迁移默认关闭；可开启/关闭', () => {
    const db = openDb()
    expect(isWebSearchEnabled(db)).toBe(false)
    setWebSearchEnabled(db, true)
    expect(isWebSearchEnabled(db)).toBe(true)
    setWebSearchEnabled(db, false)
    expect(isWebSearchEnabled(db)).toBe(false)
  })
})

describe(`${PREFIX} · 搜索（mock Wikipedia）`, () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('关闭时直接返回空（不联网）', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const db = openDb()
    const r = await searchWeb(db, '石昊 完美世界')
    expect(r.results).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('开启后：中文命中 → 返回结果 + top1 摘要（excerpt 注入正文）', async () => {
    const db = openDb()
    setWebSearchEnabled(db, true)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('list=search')) {
        return new Response(
          JSON.stringify({
            query: { search: [{ title: '完美世界（辰东小说）', snippet: '<span>石昊</span>是主角' }] }
          }),
          { status: 200 }
        )
      }
      // extracts 摘要
      return new Response(JSON.stringify({ query: { pages: { '1': { extract: '《完美世界》是辰东创作的网络小说……' } } } }), {
        status: 200
      })
    }))
    const r = await searchWeb(db, '石昊 完美世界')
    expect(r.results).toHaveLength(1)
    expect(r.results[0].title).toContain('完美世界')
    expect(r.excerpt).toContain('辰东')
    expect(r.results[0].excerpt).toContain('辰东')
  })

  it('中文无结果 → 英文兜底', async () => {
    const db = openDb()
    setWebSearchEnabled(db, true)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('zh.wikipedia')) {
        return new Response(JSON.stringify({ query: { search: [] } }), { status: 200 })
      }
      if (String(url).includes('list=search')) {
        return new Response(JSON.stringify({ query: { search: [{ title: 'Perfect World', snippet: 'a novel' }] } }), {
          status: 200
        })
      }
      return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 })
    }))
    const r = await searchWeb(db, 'perfect world novel')
    expect(r.results).toHaveLength(1)
    expect(r.results[0].title).toBe('Perfect World')
  })

  it('网络失败 → 静默返回空（不抛）', async () => {
    const db = openDb()
    setWebSearchEnabled(db, true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND') }))
    const r = await searchWeb(db, '任何词')
    expect(r.results).toEqual([])
    expect(r.excerpt).toBe('')
  })

  it('buildWebContextBlock：关闭时返回空串（生成注入不引入噪音）', async () => {
    const db = openDb()
    const block = await buildWebContextBlock(db, '测试')
    expect(block).toBe('')
  })
})
