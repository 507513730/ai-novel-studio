import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createSettingsRouter } from '../server/src/routes/settings'
import { createAutomationRouter } from '../server/src/routes/automation'
import { apiErrorMiddleware } from '../server/src/services/apiError'
import { originGuard } from '../server/src/services/security'
import { getAppSetting, setAppSetting, getAutoFixEnabled, getMonthlyCost } from '../server/src/services/appSettings'
import { fixChapterOnce } from '../server/src/services/debtFix'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function makeApp(db: DatabaseSync, routes: Array<[string, express.Router]>): express.Express {
  const app = express()
  app.use(originGuard)
  app.use(express.json({ limit: '10mb' }))
  for (const [prefix, router] of routes) app.use(prefix, router)
  app.use(apiErrorMiddleware)
  return app
}

async function withServer(app: express.Express, fn: (base: string) => Promise<void>): Promise<void> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const { port } = server.address() as { port: number }
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
  }
}

describe('v0.10.0 批B-0 app_settings（v14 迁移 + 默认值）', () => {
  it('默认值：cost_monthly_budget=0（关闭）、auto_fix_debts=1（开启）', () => {
    const db = makeDb()
    expect(getAppSetting(db, 'cost_monthly_budget')).toBe('0')
    expect(getAppSetting(db, 'auto_fix_debts')).toBe('1')
    expect(getAutoFixEnabled(db)).toBe(true)
    db.close()
  })

  it('读写 + getMonthlyCost（无用量记录 → 0）', () => {
    const db = makeDb()
    setAppSetting(db, 'cost_monthly_budget', '88.5')
    setAppSetting(db, 'auto_fix_debts', '0')
    expect(getAppSetting(db, 'cost_monthly_budget')).toBe('88.5')
    expect(getAutoFixEnabled(db)).toBe(false)
    expect(getMonthlyCost(db)).toBe(0)
    db.close()
  })
})

describe('v0.10.0 批B-O5 成本预警 API', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('GET /settings/app 返回预算/开关/当月成本；PATCH 生效', async () => {
    const db = makeDb()
    await withServer(makeApp(db, [['/api/settings', createSettingsRouter(db)]]), async (base) => {
      const get = await fetch(`${base}/api/settings/app`)
      const body = (await get.json()) as { costMonthlyBudget: number; autoFixDebts: boolean; monthlyCost: number }
      expect(body.costMonthlyBudget).toBe(0)
      expect(body.autoFixDebts).toBe(true)
      expect(body.monthlyCost).toBe(0)
      const patch = await fetch(`${base}/api/settings/app`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costMonthlyBudget: 50, autoFixDebts: false })
      })
      expect(patch.status).toBe(200)
      const after = (await (await fetch(`${base}/api/settings/app`)).json()) as { costMonthlyBudget: number; autoFixDebts: boolean }
      expect(after.costMonthlyBudget).toBe(50)
      expect(after.autoFixDebts).toBe(false)
    })
    db.close()
  })

  it('非法预算（负数）→ 400', async () => {
    const db = makeDb()
    await withServer(makeApp(db, [['/api/settings', createSettingsRouter(db)]]), async (base) => {
      const res = await fetch(`${base}/api/settings/app`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costMonthlyBudget: -1 })
      })
      expect(res.status).toBe(400)
    })
    db.close()
  })
})

describe('v0.10.0 批B-I2 质量债自动修复', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('fixChapterOnce 轮数上限：2 轮后登记债务并返回 reason（不再调用 LLM）', async () => {
    const db = makeDb()
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', 'x', 'planned')").run().lastInsertRowid)
    const chapterId = Number(
      db.prepare("INSERT INTO chapter (novel_id, title, content, review_json, fix_history_json) VALUES (?, '章', '正文内容', '{}', ?)").run(
        novelId,
        JSON.stringify([{ round: 1, issues: 1 }, { round: 2, issues: 1 }])
      ).lastInsertRowid
    )
    const r = await fixChapterOnce(db, novelId, chapterId)
    expect(r.reason).toBe('rounds exceeded')
    const debts = db.prepare('SELECT COUNT(*) AS c FROM quality_debt WHERE chapter_id = ? AND resolved = 0').get(chapterId) as { c: number }
    expect(debts.c).toBe(1)
    db.close()
  })

  it('fixChapterOnce 同签名防重：同类问题 → 登记债务不重写', async () => {
    const db = makeDb()
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', 'x', 'planned')").run().lastInsertRowid)
    const chapterId = Number(
      db.prepare(
        "INSERT INTO chapter (novel_id, title, content, review_json, fix_history_json) VALUES (?, '章', '正文', ?, ?)"
      ).run(
        novelId,
        JSON.stringify({ issues: [{ severity: 'high', problem: '角色动机模糊导致剧情牵强', suggestion: '补充动机' }] }),
        JSON.stringify([{ round: 1, issues: 1, signature: '角色动机模糊导致剧情牵强' }])
      ).lastInsertRowid
    )
    const r = await fixChapterOnce(db, novelId, chapterId)
    expect(r.reason).toBe('same signature')
    const debts = db.prepare('SELECT COUNT(*) AS c FROM quality_debt WHERE chapter_id = ? AND resolved = 0').get(chapterId) as { c: number }
    expect(debts.c).toBe(1)
    db.close()
  })

  it('debts API：待修复计数 + 手动触发原子防重（重复 POST → 409）', async () => {
    const db = makeDb()
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', 'x', 'planned')").run().lastInsertRowid)
    const chapterId = Number(db.prepare("INSERT INTO chapter (novel_id, title, content) VALUES (?, '章', '正文')").run(novelId).lastInsertRowid)
    db.prepare("INSERT INTO quality_debt (chapter_id, issue, severity, resolved) VALUES (?, '问题', 'high', 0)").run(chapterId)
    await withServer(makeApp(db, [['/api/novels', createAutomationRouter(db)]]), async (base) => {
      const count = (await (await fetch(`${base}/api/novels/${novelId}/debts`)).json()) as { pendingDebts: number }
      expect(count.pendingDebts).toBe(1)
      const first = await fetch(`${base}/api/novels/${novelId}/debts/fix`, { method: 'POST' })
      expect(first.status).toBe(201)
      const second = await fetch(`${base}/api/novels/${novelId}/debts/fix`, { method: 'POST' })
      expect(second.status).toBe(409)
    })
    db.close()
  })
})
