// v1.0 后续（A1 多候选分支生成）：候选生成契约——
// ① count 越界（<1 / >3）被 zod 拦成 400；③ 无 key 时走 ConfigError 而非误标章节（与 generateChapter 一致）；
// ④ 差异化走向引导必须有多样性（禁止全部同向，AGENTS #12 多样性约束）。
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createChapterExecutionRouter } from '../server/src/routes/chapters'
import { generateChapterCandidates, CANDIDATE_ANGLES } from '../server/src/services/chapterGeneration/candidates'
import { ConfigError } from '../server/src/services/llm/errors'
import { originGuard } from '../server/src/services/security'
import { ZodError } from 'zod'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function makeNovelWithChapter(db: DatabaseSync): { novelId: number; chapterId: number } {
  const novelId = Number(
    db.prepare("INSERT INTO novel (inspiration, title) VALUES ('c', '候选测试')").run().lastInsertRowid
  )
  const volumeId = Number(
    db.prepare("INSERT INTO volume (novel_id, title, order_index) VALUES (?, '第一卷', 0)").run(novelId).lastInsertRowid
  )
  const chapterId = Number(
    db
      .prepare(
        "INSERT INTO chapter (novel_id, volume_id, title, summary, goal_json, content, status) VALUES (?, ?, '第1章', '摘要', '{}', '', 'planned')"
      )
      .run(novelId, volumeId).lastInsertRowid
  )
  return { novelId, chapterId }
}

function makeApp(db: DatabaseSync): express.Express {
  const app = express()
  app.use(originGuard)
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/novels', createChapterExecutionRouter(db))
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

describe('多候选分支生成（A1）', () => {
  it('count 越界（0 / 4）→ 400', async () => {
    const db = makeDb()
    const { novelId, chapterId } = makeNovelWithChapter(db)
    await withServer(makeApp(db), async (base) => {
      for (const count of [0, 4]) {
        const res = await fetch(`${base}/api/novels/${novelId}/chapters/${chapterId}/candidates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count })
        })
        expect(res.status).toBe(400)
      }
    })
    db.close()
  })

  it('差异化走向引导具有多样性（3 份各不重复）', () => {
    const unique = new Set(CANDIDATE_ANGLES.map((s) => s.trim()))
    expect(unique.size).toBe(3)
    expect(CANDIDATE_ANGLES.length).toBe(3)
  })

  it('无 API Key → ConfigError（与 generateChapter 一致，不误标章节）', async () => {
    const db = makeDb()
    const { novelId, chapterId } = makeNovelWithChapter(db)
    await expect(generateChapterCandidates(db, novelId, chapterId)).rejects.toThrow(ConfigError)
    await expect(generateChapterCandidates(db, novelId, chapterId)).rejects.toThrow(/未配置 API Key/)
    db.close()
  })
})
