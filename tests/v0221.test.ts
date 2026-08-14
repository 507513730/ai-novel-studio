// v0.22.1：kb_doc 标题清洗（? 前缀事故防再犯）
import { describe, expect, it, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createAssetsRouter } from '../server/src/routes/assets'
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
  app.use('/api', createAssetsRouter(db))
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

const PREFIX = 'v0.22.1 kb_doc 标题清洗'

describe(`${PREFIX}`, () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('标题首部 ? 序列被修剪（?????标题 → 标题）', async () => {
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const r = await fetch(`${base}/api/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '?????完美世界·主线设定', content: '这是设定文档正文内容，用于验证标题清洗逻辑。' })
      })
      expect(r.status).toBe(201)
      const row = db.prepare('SELECT title FROM kb_doc ORDER BY id DESC LIMIT 1').get() as { title: string }
      expect(row.title).toBe('完美世界·主线设定')
    })
    db.close()
  })

  it('全 ? 标题 → 400（拒绝无意义标题）', async () => {
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const r = await fetch(`${base}/api/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '?????', content: '正文内容足够长以通过校验。' })
      })
      expect(r.status).toBe(400)
    })
    db.close()
  })

  it('正常标题不受影响（含空格 trim）', async () => {
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const r = await fetch(`${base}/api/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '  正常标题  ', content: '正文内容足够长以通过校验。' })
      })
      expect(r.status).toBe(201)
      const row = db.prepare('SELECT title FROM kb_doc ORDER BY id DESC LIMIT 1').get() as { title: string }
      expect(row.title).toBe('正常标题')
    })
    db.close()
  })
})
