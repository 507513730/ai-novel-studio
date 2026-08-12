// v0.10.0（批B）：应用级设置（app_settings 表读写，v7 建表）
// 键：cost_monthly_budget（月度成本预警阈值，元，0=关闭）
//     auto_fix_debts（质量债自动修复开关，'1'/'0'，默认开）

import { DatabaseSync } from 'node:sqlite'

const DEFAULTS: Record<string, string> = {
  cost_monthly_budget: '0',
  auto_fix_debts: '1'
}

export function getAppSetting(db: DatabaseSync, key: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? DEFAULTS[key] ?? ''
}

export function setAppSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}

export function getAutoFixEnabled(db: DatabaseSync): boolean {
  return getAppSetting(db, 'auto_fix_debts') === '1'
}

/** 当月已用成本（元）——按 usage 表当月 input/output 计费估算 */
export function getMonthlyCost(db: DatabaseSync): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_estimate), 0) AS c FROM usage_log
       WHERE created_at >= datetime('now', 'start of month')`
    )
    .get() as { c: number }
  return Number(row.c) || 0
}
