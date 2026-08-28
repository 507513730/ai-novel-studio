import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createNovelsRouter } from '../server/src/routes/novels'
import { createSolutionsRouter } from '../server/src/routes/solutions'
import { createSettingsRouter } from '../server/src/routes/settings'
import { createAutomationRouter } from '../server/src/routes/automation'
import { createVolumesRouter } from '../server/src/routes/volumes'
import { apiErrorMiddleware } from '../server/src/services/apiError'
import { originGuard } from '../server/src/services/security'

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

describe('v0.9.0 A-9 错误收敛（审查 #9）', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('未分类错误只回固定文案 internal error（不泄露内部消息）', async () => {
    const db = makeDb()
    const app = express()
    app.use(express.json())
    app.use((_req, _res, next) => next(new Error('SQLite 约束 / C:\\Users\\secret\\path 内部细节')))
    app.use(apiErrorMiddleware)
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/x`)
      const body = (await res.json()) as { error: string }
      expect(res.status).toBe(500)
      expect(body.error).toBe('internal error')
    })
    db.close()
  })

  it('SQLite 约束冲突 → 409 固定文案', async () => {
    const db = makeDb()
    const app = express()
    app.use(express.json())
    app.use((_req, _res, next) => next(new Error('UNIQUE constraint failed: provider.name')))
    app.use(apiErrorMiddleware)
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/x`)
      const body = (await res.json()) as { error: string }
      expect(res.status).toBe(409)
      expect(body.error).toBe('数据冲突（约束不满足）')
    })
    db.close()
  })
})

describe('v0.9.0 A-19 status 枚举校验（审查 #19）', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('novel.status 非法值 → 400', async () => {
    const db = makeDb()
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', 'x', 'draft')").run().lastInsertRowid)
    await withServer(makeApp(db, [['/api/novels', createNovelsRouter(db)]]), async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'banana' })
      })
      expect(res.status).toBe(400)
    })
    db.close()
  })

  it('chapter.status 非法值 → 400', async () => {
    const db = makeDb()
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', 'x', 'draft')").run().lastInsertRowid)
    const chapterId = Number(db.prepare("INSERT INTO chapter (novel_id, title) VALUES (?, '章')").run(novelId).lastInsertRowid)
    await withServer(makeApp(db, [['/api/novels', createVolumesRouter(db)]]), async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}/chapters/${chapterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'weird' })
      })
      expect(res.status).toBe(400)
    })
    db.close()
  })
})

describe('v0.9.0 A-17 isCustom 保留（审查 #17）', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('PATCH provider 不传 isCustom 时保留原值（内置 provider 不再被翻转为自定义）', async () => {
    process.env.SERVER_TOKEN = 't'
    const db = makeDb()
    // seed 的内置 provider（is_custom=0）
    const builtin = db.prepare('SELECT id, is_custom FROM provider WHERE is_custom = 0 LIMIT 1').get() as { id: number; is_custom: number }
    expect(builtin).toBeTruthy()
    await withServer(makeApp(db, [['/api/settings', createSettingsRouter(db)]]), async (base) => {
      const res = await fetch(`${base}/api/settings/providers/${builtin.id}`, {
        method: 'PATCH',
        // v0.25.0（审查 M3）：全请求强制 X-App-Token——本用例已配置 SERVER_TOKEN，须带上
        headers: { 'Content-Type': 'application/json', 'X-App-Token': 't' },
        body: JSON.stringify({ name: '改名' })
      })
      expect(res.status).toBe(200)
    })
    const after = db.prepare('SELECT is_custom FROM provider WHERE id = ?').get(builtin.id) as { is_custom: number }
    expect(after.is_custom).toBe(0)
    db.close()
  })
})

describe('v0.9.0 B-13 生产方案绑定（审查 #13）', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('绑定不存在的方案 → 404；绑定已停用方案 → 409', async () => {
    const db = makeDb()
    const disabledId = Number(
      db.prepare("INSERT INTO solution (name, description, steps_json, enabled) VALUES ('停用方案', '', '[]', 0)").run().lastInsertRowid
    )
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', 'x', 'draft')").run().lastInsertRowid)
    await withServer(makeApp(db, [['/api/novels', createNovelsRouter(db)], ['/api', createSolutionsRouter(db)]]), async (base) => {
      const missing = await fetch(`${base}/api/novels/${novelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSolutionId: 99999 })
      })
      expect(missing.status).toBe(404)
      const disabled = await fetch(`${base}/api/novels/${novelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSolutionId: disabledId })
      })
      expect(disabled.status).toBe(409)
    })
    db.close()
  })

  it('绑定成功后 GET 回传 currentSolutionId', async () => {
    const db = makeDb()
    const sid = Number(
      db.prepare("INSERT INTO solution (name, description, steps_json, enabled) VALUES ('方案', '', '[]', 1)").run().lastInsertRowid
    )
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', 'x', 'draft')").run().lastInsertRowid)
    await withServer(makeApp(db, [['/api/novels', createNovelsRouter(db)]]), async (base) => {
      const patch = await fetch(`${base}/api/novels/${novelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSolutionId: sid })
      })
      expect(patch.status).toBe(200)
      const get = await fetch(`${base}/api/novels/${novelId}`)
      const body = (await get.json()) as { novel: { currentSolutionId: number | null } }
      expect(body.novel.currentSolutionId).toBe(sid)
    })
    db.close()
  })
})

describe('v0.9.0 B-20 import-feelfish 限长（审查 #20）', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('超大 content（>100KB）→ 400', async () => {
    const db = makeDb()
    await withServer(makeApp(db, [['/api', createSolutionsRouter(db)]]), async (base) => {
      const res = await fetch(`${base}/api/solutions/import-feelfish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: [{ filename: 'mc-x.md', content: 'a'.repeat(100_001) }] })
      })
      expect(res.status).toBe(400)
    })
    db.close()
  })
})

describe('v0.9.0 D automation 范围授权（审查 D）', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('只传 from 不传 to → 400（此前静默退化为全书生产）', async () => {
    const db = makeDb()
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', 'x', 'draft')").run().lastInsertRowid)
    await withServer(makeApp(db, [['/api/novels', createAutomationRouter(db)]]), async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}/produce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 3 })
      })
      expect(res.status).toBe(400)
    })
    db.close()
  })
})
