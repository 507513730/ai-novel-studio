import { describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { applyMigrations } from '../server/src/db/migrate'
import { registerChapterGenerationRoutes } from '../server/src/routes/chapters/generate'
import { generateChapter } from '../server/src/services/chapterGeneration/orchestrator'

vi.mock('../server/src/services/chapterGeneration/orchestrator', () => ({ generateChapter: vi.fn() }))
vi.mock('../server/src/services/context/dynamic', () => ({ buildChapterWriteContext: () => ({ frozenHash: '', budgetUsed: 0, budgetLimit: 1 }) }))

describe('生成传输层失败隔离', () => {
  it('旧请求失败不能复位后来抢占的生成会话', async () => {
    const db = new DatabaseSync(':memory:', { timeout: 5000, enableForeignKeyConstraints: true })
    applyMigrations(db)
    db.exec("INSERT INTO novel(id,title,inspiration) VALUES(1,'书','灵感'); INSERT INTO chapter(id,novel_id,title,status,generation_token) VALUES(1,1,'章','generating','old')")
    vi.mocked(generateChapter).mockImplementationOnce(async () => {
      db.prepare("UPDATE chapter SET generation_token='new',status='generating' WHERE id=1").run()
      throw new Error('旧协程失败')
    })
    const app = express(); app.use(express.json())
    const router = express.Router(); registerChapterGenerationRoutes(router, db); app.use('/api', router)
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/1/chapters/1/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      expect(await response.text()).toContain('event: error')
      expect(db.prepare('SELECT status,generation_token FROM chapter WHERE id=1').get()).toMatchObject({ status: 'generating', generation_token: 'new' })
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close() }
  })
})
