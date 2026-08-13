// v0.16.0：汇率模块（USD→CNY 自动获取/手动覆盖）
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import {
  DEFAULT_RATE,
  getExchangeRate,
  getRateSource,
  setRateManual,
  clearRateManual,
  fetchLatestRate,
  refreshAutoRate
} from '../server/src/services/currency'

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db)
  return db
}

const PREFIX = 'v0.16.0 汇率'

describe(`${PREFIX} · 默认与读写`, () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDb()
  })

  it('v17 迁移后默认汇率 7.2 / source=auto', () => {
    expect(getExchangeRate(db)).toBe(DEFAULT_RATE)
    expect(getRateSource(db)).toBe('auto')
  })

  it('手动设置 → source=manual 且不再被自动覆盖', () => {
    setRateManual(db, 7.5)
    expect(getExchangeRate(db)).toBe(7.5)
    expect(getRateSource(db)).toBe('manual')
  })

  it('清除手动 → 恢复 auto', () => {
    setRateManual(db, 7.5)
    clearRateManual(db)
    expect(getRateSource(db)).toBe('auto')
  })
})

describe(`${PREFIX} · 联网获取（免 key 端点）`, () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetchLatestRate：成功解析 rates.CNY', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: 'success', rates: { CNY: 6.7569 } }), { status: 200 }))
    )
    const rate = await fetchLatestRate()
    expect(rate).toBeCloseTo(6.7569, 4)
  })

  it('fetchLatestRate：失败返回 null（不抛）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 503 })))
    expect(await fetchLatestRate()).toBeNull()
  })

  it('fetchLatestRate：超时/网络异常返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ENOTFOUND')
    }))
    expect(await fetchLatestRate(100)).toBeNull()
  })

  it('refreshAutoRate：auto 模式拉取成功落库并记录时间', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: 'success', rates: { CNY: 7.1 } }), { status: 200 }))
    )
    const db = openDb()
    const rate = await refreshAutoRate(db)
    expect(rate).toBe(7.1)
    expect(getExchangeRate(db)).toBe(7.1)
    expect(getRateSource(db)).toBe('auto')
  })

  it('refreshAutoRate：manual 模式不覆盖', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: 'success', rates: { CNY: 6.0 } }), { status: 200 }))
    )
    const db = openDb()
    setRateManual(db, 7.5)
    const rate = await refreshAutoRate(db)
    expect(rate).toBeNull()
    expect(getExchangeRate(db)).toBe(7.5)
  })

  it('refreshAutoRate：失败静默保留现值', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    const db = openDb()
    const rate = await refreshAutoRate(db)
    expect(rate).toBeNull()
    expect(getExchangeRate(db)).toBe(DEFAULT_RATE)
  })
})
