// v0.17.0：审查修复批（H3 重启重置 / H5 is_custom / M10 reserved 落库 / M3 usage stats camelCase）
import { describe, expect, it, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { startJobScheduler } from '../server/src/services/jobs/scheduler'
import { createAgentAdminRouter } from '../server/src/routes/agents'
import { createSettingsRouter } from '../server/src/routes/settings'
import { createNovelsRouter } from '../server/src/routes/novels'
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
  app.use('/api/settings', createSettingsRouter(db))
  app.use('/api/novels', createNovelsRouter(db))
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

const PREFIX = 'v0.17.0 审查修复'

describe(`${PREFIX} · H3 重启重置章节 generating`, () => {
  it('startJobScheduler 将遗留 generating 章节重置为 planned', () => {
    const db = makeDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'planned')").run()
    db.prepare("INSERT INTO chapter (novel_id, title, status) VALUES (1, '第一章', 'generating')").run()
    startJobScheduler(db, 60_000) // 长间隔——只触发启动重置，不干扰
    const st = db.prepare("SELECT status FROM chapter WHERE novel_id = 1").get() as { status: string }
    expect(st.status).toBe('planned')
    db.close()
  })
})

describe(`${PREFIX} · H5 agents is_custom`, () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('POST /agents 创建的用户智能体可被 DELETE（is_custom=1 落库）', async () => {
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const created = await fetch(`${base}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '测试智能体', systemPrompt: '你是测试用的智能体，负责验证。' })
      })
      expect(created.status).toBe(201)
      const { id } = (await created.json()) as { id: number }
      const del = await fetch(`${base}/api/agents/${id}`, { method: 'DELETE' })
      expect(del.status).toBe(200)
    })
    db.close()
  })
})

describe(`${PREFIX} · M10 reserved 落库`, () => {
  it('v18 迁移：预留 task_type 标记 reserved=1，消费型 reserved=0', () => {
    const db = makeDb()
    const row = db.prepare("SELECT reserved FROM model_route WHERE task_type = 'planning'").get() as {
      reserved: number
    }
    expect(row.reserved).toBe(1)
    const prose = db.prepare("SELECT reserved FROM model_route WHERE task_type = 'prose'").get() as {
      reserved: number
    }
    expect(prose.reserved).toBe(0)
    db.close()
  })
})

describe(`${PREFIX} · M3 usage stats camelCase 契约`, () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('GET /settings/usage/stats 返回 camelCase 字段（不再泄漏 snake_case）', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'planned')").run()
    db.prepare(
      `INSERT INTO usage_log (novel_id, task_type, provider, model, input_tokens, output_tokens, cache_hit, cache_miss, cost_estimate)
       VALUES (1, 'prose', 'DeepSeek', 'deepseek-v4-flash', 1000, 500, 800, 200, 0.05)`
    ).run()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/settings/usage/stats`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { total: Record<string, unknown>; groups: Array<Record<string, unknown>> }
      expect(body.total.inputTokens).toBe(1000)
      expect(body.total.cacheHits).toBe(800)
      expect(body.total).not.toHaveProperty('input_tokens')
      expect(body.groups[0].taskType).toBe('prose')
    })
    db.close()
  })
})

describe(`${PREFIX} · M1 origin fail-closed（复用 v072 契约）`, () => {
  it('null Origin 无 token → 403', async () => {
    const db = makeDb()
    delete process.env.SERVER_TOKEN
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/1`, { headers: { Origin: 'null' } })
      expect(res.status).toBe(403)
    })
    db.close()
  })
})
