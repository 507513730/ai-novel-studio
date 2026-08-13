// v0.16.0：汇率模块——USD→CNY 换算（显示层人民币语义）
// 获取策略：启动时自动联网（免 key 公开端点，失败静默降级保留现值）+ 手动可改（manual 模式优先）
// 定价双币种（官方 CNY/网关 USD）统一折算 CNY 时消费本模块

import type { DatabaseSync } from 'node:sqlite'
import { getAppSetting, setAppSetting } from './appSettings'

export const DEFAULT_RATE = 7.2
export type RateSource = 'auto' | 'manual'

export function getExchangeRate(db: DatabaseSync): number {
  const v = Number(getAppSetting(db, 'cny_usd_rate'))
  return v > 0 ? v : DEFAULT_RATE
}

export function getRateSource(db: DatabaseSync): RateSource {
  return getAppSetting(db, 'cny_usd_rate_source') === 'manual' ? 'manual' : 'auto'
}

export function getRateUpdatedAt(db: DatabaseSync): string {
  return getAppSetting(db, 'cny_usd_rate_at') ?? ''
}

/** 手动设置汇率（覆盖为 manual——不再被自动获取覆盖） */
export function setRateManual(db: DatabaseSync, rate: number): void {
  setAppSetting(db, 'cny_usd_rate', String(rate))
  setAppSetting(db, 'cny_usd_rate_source', 'manual')
  setAppSetting(db, 'cny_usd_rate_at', new Date().toISOString())
}

/** 清除手动覆盖 → 恢复自动获取（下次启动/刷新时拉取） */
export function clearRateManual(db: DatabaseSync): void {
  setAppSetting(db, 'cny_usd_rate_source', 'auto')
  setAppSetting(db, 'cny_usd_rate_at', '')
}

/** 联网获取实时汇率（免 key；失败返回 null——调用方静默降级） */
export async function fetchLatestRate(timeoutMs = 5000): Promise<number | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctrl.signal })
    if (!res.ok) return null
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> }
    const cny = data.rates?.CNY
    return typeof cny === 'number' && cny > 0 ? cny : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 启动/手动刷新：非 manual 模式时联网拉取并落库（失败静默——保留现值） */
export async function refreshAutoRate(db: DatabaseSync): Promise<number | null> {
  if (getRateSource(db) === 'manual') return null
  const rate = await fetchLatestRate()
  if (rate) {
    setAppSetting(db, 'cny_usd_rate', String(rate))
    setAppSetting(db, 'cny_usd_rate_source', 'auto')
    setAppSetting(db, 'cny_usd_rate_at', new Date().toISOString())
  }
  return rate
}
