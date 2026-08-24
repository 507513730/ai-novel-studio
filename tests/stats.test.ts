// v0.24.4（A3 写作统计）：/stats 聚合端点——汇总/状态分布/卷分布/审核分/成本
import { describe, it, expect } from 'vitest'
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

function makeApp(db: DatabaseSync): express.Express {
  const app = express()
  app.use(originGuard)
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/novels', createNovelsRouter(db))
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

function setupNovelWithData(db: DatabaseSync): number {
  const n = db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('统计测试书', 'x', 'draft')").run()
  const novelId = Number(n.lastInsertRowid)
  const v = db.prepare("INSERT INTO volume (novel_id, title, order_index) VALUES (?, '第一卷', 1)").run(novelId)
  const volId = Number(v.lastInsertRowid)
  db.prepare("INSERT INTO chapter (novel_id, volume_id, title, content, status, word_count, ai_words, human_words, review_json) VALUES (?, ?, '第一章', '正文一', 'written', 100, 80, 20, '{\"score\": 85, \"issues\": []}')").run(novelId, volId)
  db.prepare("INSERT INTO chapter (novel_id, title, content, status, word_count, ai_words, human_words, review_json) VALUES (?, '第二章', '', 'planned', 0, 0, 0, '')").run(novelId)
  db.prepare("INSERT INTO quality_debt (chapter_id, issue, severity) VALUES (?, 'x', 'high')").run(1)
  db.prepare('INSERT INTO usage_log (novel_id, task_type, provider, model, input_tokens, output_tokens, cost_estimate) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(novelId, 'prose', 'deepseek', 'flash', 1000, 500, 0.0123)
  return novelId
}

describe('GET /:id/stats（A3 写作统计）', () => {
  it('汇总/状态分布/卷分布/审核分/成本聚合正确', async () => {
    const db = makeDb()
    const novelId = setupNovelWithData(db)
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}/stats`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        total: { chapters: number; words: number; aiWords: number; humanWords: number; written: number }
        byStatus: Array<{ status: string; count: number }>
        byVolume: Array<{ count: number; words: number }>
        reviewScores: Array<{ score: number }>
        pendingDebts: number
        usage: { calls: number; tokens: number; cost: number }
      }
      expect(body.total).toMatchObject({ chapters: 2, words: 100, aiWords: 80, humanWords: 20, written: 1 })
      expect(body.byStatus).toHaveLength(2)
      expect(body.byVolume).toHaveLength(1)
      expect(body.byVolume[0]).toMatchObject({ count: 1, words: 100 })
      expect(body.reviewScores).toHaveLength(1)
      expect(body.reviewScores[0].score).toBe(85)
      expect(body.pendingDebts).toBe(1)
      expect(body.usage).toMatchObject({ calls: 1, tokens: 1500 })
      expect(body.usage.cost).toBeCloseTo(0.0123)
    })
    db.close()
  })

  it('不存在书 404', async () => {
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/9999/stats`)
      expect(res.status).toBe(404)
    })
    db.close()
  })
})
