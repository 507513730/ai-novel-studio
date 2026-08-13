// v0.20.0：记忆面（状态机显式查看/修正——NovelClaw 学习组）
import { describe, expect, it, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createChapterExecutionRouter } from '../server/src/routes/chapters'
import { apiErrorMiddleware } from '../server/src/services/apiError'
import { originGuard } from '../server/src/services/security'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function makeApp(db: DatabaseSync): express.Express {
  const app = express()
  app.use(originGuard)
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/novels', createChapterExecutionRouter(db))
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

const PREFIX = 'v0.20.0 记忆面'

describe(`${PREFIX} · 查看与修正`, () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('GET /memory 聚合角色状态/势力状态/待确认事实', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'planned')").run()
    db.prepare(
      "INSERT INTO character (novel_id, name, profile_json, ledger_json, status) VALUES (1, '石昊', ?, ?, 'pending')"
    ).run(JSON.stringify({ role: '主角' }), JSON.stringify({ states: ['荒域少年', '双骨觉醒'] }))
    db.prepare("INSERT INTO world (novel_id, manual_json, factions_json, map_json) VALUES (1, '{}', ?, '{}')").run(
      JSON.stringify([{ name: '荒域石族', currentState: '遭袭' }])
    )
    db.prepare("INSERT INTO chapter (novel_id, title, status) VALUES (1, '第一章', 'written')").run()
    db.prepare("INSERT INTO fact (novel_id, chapter_id, content, confirmed) VALUES (1, 1, '石昊失去至尊骨', 0)").run()
    await withServer(makeApp(db), async (base) => {
      const r = await fetch(`${base}/api/novels/1/memory`)
      expect(r.status).toBe(200)
      const body = (await r.json()) as {
        characters: Array<{ name: string; states: string[] }>
        factions: Array<{ name: string; currentState: string }>
        pendingFacts: Array<{ id: number; content: string }>
      }
      expect(body.characters[0].states).toContain('双骨觉醒')
      expect(body.factions[0].currentState).toBe('遭袭')
      expect(body.pendingFacts).toHaveLength(1)
    })
    db.close()
  })

  it('POST /memory/character：追加状态 + remove 删除', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'planned')").run()
    db.prepare(
      "INSERT INTO character (novel_id, name, profile_json, ledger_json, status) VALUES (1, '石昊', '{}', ?, 'pending')"
    ).run(JSON.stringify({ states: ['荒域少年'] }))
    await withServer(makeApp(db), async (base) => {
      const add = await fetch(`${base}/api/novels/1/memory/character`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '石昊', state: '突破列阵境' })
      })
      expect(add.status).toBe(200)
      const addBody = (await add.json()) as { states: string[] }
      expect(addBody.states).toContain('突破列阵境')
      const rm = await fetch(`${base}/api/novels/1/memory/character`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '石昊', state: '荒域少年', remove: true })
      })
      const rmBody = (await rm.json()) as { states: string[] }
      expect(rmBody.states).not.toContain('荒域少年')
      expect(rmBody.states).toContain('突破列阵境')
    })
    db.close()
  })

  it('POST /memory/faction：更新势力当前状态', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'planned')").run()
    db.prepare("INSERT INTO world (novel_id, manual_json, factions_json, map_json) VALUES (1, '{}', ?, '{}')").run(
      JSON.stringify([{ name: '荒域石族' }])
    )
    await withServer(makeApp(db), async (base) => {
      const r = await fetch(`${base}/api/novels/1/memory/faction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '荒域石族', state: '迁往石国' })
      })
      expect(r.status).toBe(200)
      const world = db.prepare('SELECT factions_json FROM world WHERE novel_id = 1').get() as {
        factions_json: string
      }
      const factions = JSON.parse(world.factions_json) as Array<{ name: string; currentState?: string }>
      expect(factions[0].currentState).toBe('迁往石国')
    })
    db.close()
  })

  it('不存在的角色/势力 → 404', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'planned')").run()
    db.prepare("INSERT INTO world (novel_id, manual_json, factions_json, map_json) VALUES (1, '{}', '[]', '{}')").run()
    await withServer(makeApp(db), async (base) => {
      const c = await fetch(`${base}/api/novels/1/memory/character`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '不存在', state: 'x' })
      })
      expect(c.status).toBe(404)
      const f = await fetch(`${base}/api/novels/1/memory/faction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '不存在', state: 'x' })
      })
      expect(f.status).toBe(404)
    })
    db.close()
  })
})
