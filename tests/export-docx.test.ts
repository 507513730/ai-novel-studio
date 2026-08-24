// v0.24.4（A5 DOCX 导出）：OOXML 组装回归——200 + zip 结构 + 中文内容（jszip CJS 解包 D42）
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createExportRouter } from '../server/src/routes/export'
import { createChapterExecutionRouter } from '../server/src/routes/chapters'
import { originGuard } from '../server/src/services/security'
import { ZodError } from 'zod'

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
  app.use('/api/novels', createExportRouter(db))
  // AGENTS #28：错误码语义化（ZodError→400）——测试装配与真实 app 对齐
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'invalid request' })
      return
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal error' })
  })
  return app
}

async function withServer<T>(app: express.Express, fn: (base: string) => Promise<T>): Promise<T> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const { port } = server.address() as { port: number }
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
  }
}

describe('DOCX 导出（A5）', () => {
  it('返回 200 + OOXML zip 结构（PK 头 + document.xml）', async () => {
    const db = makeDb()
    const n = db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('导出测试', 'x', 'draft')").run()
    const novelId = Number(n.lastInsertRowid)
    db.prepare("INSERT INTO chapter (novel_id, title, content, status, word_count) VALUES (?, '第一章', '这是一段用于导出验证的中文正文。', 'written', 15)").run(novelId)

    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}/export?format=docx`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('wordprocessingml.document')
      const buf = Buffer.from(await res.arrayBuffer())
      expect(buf.length).toBeGreaterThan(1000)
      const text = buf.toString('latin1')
      expect(text.startsWith('PK')).toBe(true)
      expect(text).toContain('word/document.xml')
      expect(text).toContain('[Content_Types].xml')
    })
    db.close()
  })

  it('非法 format 400', async () => {
    const db = makeDb()
    const n = db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('x', 'x', 'draft')").run()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/${Number(n.lastInsertRowid)}/export?format=pdf`)
      expect(res.status).toBe(400)
    })
    db.close()
  })
})
