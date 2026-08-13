// v0.19.0：人类/AI 字数分离（v20 迁移 + PATCH delta 累计）
import { describe, expect, it, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createVolumesRouter } from '../server/src/routes/volumes'
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
  // 与真实应用一致：volumes router 挂 /api/novels（Express 5 下 '/' 裸前缀 + 参数路由不匹配）
  app.use('/api/novels', createVolumesRouter(db))
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

const PREFIX = 'v0.19.0 字数分离'

describe(`${PREFIX} · v20 迁移`, () => {
  it('chapter 表有 ai_words/human_words 列（默认 0）', () => {
    const db = makeDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'planned')").run()
    db.prepare("INSERT INTO chapter (novel_id, title, status) VALUES (1, '第一章', 'planned')").run()
    const row = db.prepare('SELECT ai_words, human_words FROM chapter WHERE novel_id = 1').get() as {
      ai_words: number
      human_words: number
    }
    expect(row.ai_words).toBe(0)
    expect(row.human_words).toBe(0)
    db.close()
  })
})

describe(`${PREFIX} · PATCH delta 累计`, () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('保存携带 delta → 服务端累加（多次累加不覆盖）', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'planned')").run()
    db.prepare("INSERT INTO chapter (novel_id, title, status) VALUES (1, '第一章', 'planned')").run()
    await withServer(makeApp(db), async (base) => {
      const patch1 = await fetch(`${base}/api/novels/1/chapters/1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '他推开门走了进去。', aiWordsDelta: 9, humanWordsDelta: 0 })
      })
      expect(patch1.status).toBe(200)
      const patch2 = await fetch(`${base}/api/novels/1/chapters/1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '他推开门走了进去。夜色笼罩小城。', humanWordsDelta: 7 })
      })
      expect(patch2.status).toBe(200)
      const row = db.prepare('SELECT ai_words, human_words FROM chapter WHERE id = 1').get() as {
        ai_words: number
        human_words: number
      }
      expect(row.ai_words).toBe(9)
      expect(row.human_words).toBe(7)
    })
    db.close()
  })

  it('delta 为 0/负数 → 不累加', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'planned')").run()
    db.prepare("INSERT INTO chapter (novel_id, title, status) VALUES (1, '第一章', 'planned')").run()
    await withServer(makeApp(db), async (base) => {
      const r = await fetch(`${base}/api/novels/1/chapters/1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '正文内容。', aiWordsDelta: 0, humanWordsDelta: 0 })
      })
      expect(r.status).toBe(200)
      const row = db.prepare('SELECT ai_words, human_words FROM chapter WHERE id = 1').get() as {
        ai_words: number
        human_words: number
      }
      expect(row.ai_words).toBe(0)
      expect(row.human_words).toBe(0)
    })
    db.close()
  })
})
