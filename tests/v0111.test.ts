import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createAgentAdminRouter } from '../server/src/routes/agents'
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
  app.use('/api/agents', createAgentAdminRouter(db))
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

describe('v0.11.1 智能体删除（引用拦截 + 内置保护）', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('删除不存在的智能体 → 404', async () => {
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/agents/99999`, { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
    db.close()
  })

  it('内置智能体（is_custom=0）拒绝删除 → 409', async () => {
    const db = makeDb()
    const builtin = db.prepare('SELECT id FROM agent WHERE is_custom = 0 LIMIT 1').get() as { id: number }
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/agents/${builtin.id}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('内置智能体不可删除')
    })
    db.close()
  })

  it('被方案引用的自定义智能体 → 409（含引用清单）', async () => {
    const db = makeDb()
    const agentId = Number(
      db.prepare("INSERT INTO agent (name, role, system_prompt, is_custom) VALUES ('我的智能体', 'custom', '你是助手', 1)").run().lastInsertRowid
    )
    db.prepare(
      "INSERT INTO solution (name, description, steps_json, enabled) VALUES ('引用方案', '', ?, 1)"
    ).run(JSON.stringify([{ agentId, role: '步骤', stage: 'whole_book' }]))
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/agents/${agentId}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('引用方案')
      // 智能体仍在
      expect(db.prepare('SELECT id FROM agent WHERE id = ?').get(agentId)).toBeTruthy()
    })
    db.close()
  })

  it('未引用的自定义智能体删除成功 + agent_skill 级联清理', async () => {
    const db = makeDb()
    const agentId = Number(
      db.prepare("INSERT INTO agent (name, role, system_prompt, is_custom) VALUES ('我的智能体', 'custom', '你是助手', 1)").run().lastInsertRowid
    )
    const skillId = Number(
      db.prepare("INSERT INTO skill (name, description, body_md, novel_id) VALUES ('技能', 'd', 'b', 0)").run().lastInsertRowid
    )
    db.prepare('INSERT INTO agent_skill (agent_id, skill_id) VALUES (?, ?)').run(agentId, skillId)
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/agents/${agentId}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    })
    expect(db.prepare('SELECT id FROM agent WHERE id = ?').get(agentId)).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS c FROM agent_skill WHERE agent_id = ?').get(agentId) as { c: number }).toMatchObject({ c: 0 })
    db.close()
  })
})
