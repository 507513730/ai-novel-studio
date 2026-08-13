import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createNovelsRouter } from '../server/src/routes/novels'
import { originGuard } from '../server/src/services/security'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

// 最小装配（与被测逻辑一致的中间件链）：originGuard + json + novels 路由
function makeApp(db: DatabaseSync): express.Express {
  const app = express()
  app.use(originGuard)
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/novels', createNovelsRouter(db))
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

describe('v0.7.2 批1-1 删除小说：运行中 job 置 cancelled 而非删行', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('删除小说时 running/queued job 保留且置 cancelled（调度器可感知取消）', async () => {
    const db = makeDb()
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('测试书', '灵感', 'draft')").run().lastInsertRowid)
    db.prepare(
      "INSERT INTO job (type, status, payload_json) VALUES ('director', 'running', ?)"
    ).run(JSON.stringify({ novelId }))

    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    const rows = db
      .prepare("SELECT status FROM job WHERE json_extract(payload_json, '$.novelId') = ?")
      .all(novelId) as Array<{ status: string }>
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('cancelled')
    expect(db.prepare('SELECT COUNT(*) AS c FROM novel WHERE id = ?').get(novelId) as { c: number }).toMatchObject({ c: 0 })
    db.close()
  })

  it('已结束的 job（done/failed）不受删除影响，原样保留', async () => {
    const db = makeDb()
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('测试书2', '灵感', 'draft')").run().lastInsertRowid)
    db.prepare(
      "INSERT INTO job (type, status, payload_json) VALUES ('director', 'done', ?)"
    ).run(JSON.stringify({ novelId }))

    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    const rows = db
      .prepare("SELECT status FROM job WHERE json_extract(payload_json, '$.novelId') = ?")
      .all(novelId) as Array<{ status: string }>
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('done')
    db.close()
  })
})

describe('v0.7.2 批1-2 打包态（null Origin）鉴权：SSE/导出缺 token 应 403', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('配置 SERVER_TOKEN 时 null Origin 无 token → 403；带 token → 200', async () => {
    process.env.SERVER_TOKEN = 'test-token-abc'
    const db = makeDb()

    await withServer(makeApp(db), async (base) => {
      const noToken = await fetch(`${base}/api/novels/1`, { headers: { Origin: 'null' } })
      expect(noToken.status).toBe(403)
      // 带 token → 通过鉴权到达路由层（novel 1 不存在 → 404，证明未被鉴权拦截）
      const withToken = await fetch(`${base}/api/novels/1`, {
        headers: { Origin: 'null', 'X-App-Token': 'test-token-abc' }
      })
      expect(withToken.status).toBe(404)
    })
    db.close()
  })

  // v0.17.0（审查 M1）：fail-closed——未配置 SERVER_TOKEN 时 null Origin 一律拒绝（此前放行=裸奔）
  it('未配置 SERVER_TOKEN（独立调试）时 null Origin 拒绝 403', async () => {
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/1`, { headers: { Origin: 'null' } })
      expect(res.status).toBe(403)
    })
    db.close()
  })
})
