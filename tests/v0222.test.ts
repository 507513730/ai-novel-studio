// v0.22.2：书级「下一步」引导（nextSteps 规则引擎 4 态）
import { describe, expect, it, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createAutomationRouter } from '../server/src/routes/automation'
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
  app.use('/api/novels', createAutomationRouter(db))
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

function seedNovel(db: DatabaseSync, chapters: Array<{ status: string; content?: string }>): void {
  db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'producing')").run()
  for (const c of chapters) {
    db.prepare('INSERT INTO chapter (novel_id, title, status, content) VALUES (1, ?, ?, ?)').run(
      c.status,
      c.status,
      c.content ?? ''
    )
  }
}

const PREFIX = 'v0.22.2 nextSteps'

describe(`${PREFIX} · 正文未写完`, () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
  })

  it('剩余章 > 0 → 引导「继续生产正文」+ 跳章节执行', async () => {
    const db = makeDb()
    seedNovel(db, [
      { status: 'written', content: '正文一' },
      { status: 'failed', content: '' },
      { status: 'planned', content: '' }
    ])
    await withServer(makeApp(db), async (base) => {
      const r = await fetch(`${base}/api/novels/1/status`)
      const body = (await r.json()) as { nextSteps: { title: string; description: string; action: { label: string; to: string } } }
      expect(body.nextSteps.title).toBe('继续生产正文')
      expect(body.nextSteps.description).toContain('1/3')
      expect(body.nextSteps.description).toContain('失败')
      expect(body.nextSteps.action.to).toBe('/novels/1/chapters')
    })
    db.close()
  })

  it('全部写完无质量债 → 「本书已完成」', async () => {
    const db = makeDb()
    seedNovel(db, [{ status: 'written', content: '正文' }, { status: 'done', content: '正文二' }])
    await withServer(makeApp(db), async (base) => {
      const body = (await (await fetch(`${base}/api/novels/1/status`)).json()) as { nextSteps: { title: string } }
      expect(body.nextSteps.title).toBe('本书已完成')
    })
    db.close()
  })

  it('写完但有质量债 → 「收尾：修复质量债」', async () => {
    const db = makeDb()
    seedNovel(db, [{ status: 'written', content: '正文' }])
    db.prepare("INSERT INTO quality_debt (chapter_id, issue, severity, resolved) VALUES (1, '节奏拖沓', 'medium', 0)").run()
    await withServer(makeApp(db), async (base) => {
      const body = (await (await fetch(`${base}/api/novels/1/status`)).json()) as { nextSteps: { title: string } }
      expect(body.nextSteps.title).toBe('收尾：修复质量债')
    })
    db.close()
  })

  it('有运行中 job → 「生产进行中」优先', async () => {
    const db = makeDb()
    seedNovel(db, [
      { status: 'written', content: '正文' },
      { status: 'planned', content: '' }
    ])
    db.prepare(
      "INSERT INTO job (type, status, progress, payload_json) VALUES ('production', 'running', 50, ?)"
    ).run(JSON.stringify({ novelId: 1 }))
    await withServer(makeApp(db), async (base) => {
      const body = (await (await fetch(`${base}/api/novels/1/status`)).json()) as { nextSteps: { title: string } }
      expect(body.nextSteps.title).toBe('生产进行中')
    })
    db.close()
  })
})
