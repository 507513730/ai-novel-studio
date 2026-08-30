// B3（D125）：外部书 → 工作书转换契约。
// LLM 依赖步骤（deriveVolumeStructure / deriveDirectionAndFraming）不在此测（需 key）；测纯逻辑与幂等 DB 操作：
// ① parseVolumeBoundaries 校验；② activateAsWorkingBook 翻转标记+章节状态；③ backfillChapterSummaries 回填摘要；
// ④ 路由：非外部书 400、steps 非法 400。
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createAssetsRouter } from '../server/src/routes/assets'
import { originGuard } from '../server/src/services/security'
import { ZodError } from 'zod'
import { parseVolumeBoundaries, activateAsWorkingBook, backfillChapterSummaries } from '../server/src/services/bookConversion'

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
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'invalid request' })
      return
    }
    res.status(err instanceof Error && /外部|not found/.test(err.message) ? 400 : 500).json({ error: err instanceof Error ? err.message : 'internal error' })
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

function makeExternalBook(db: DatabaseSync): { novelId: number; volId: number; chapterIds: number[] } {
  const novelId = Number(
    db
      .prepare("INSERT INTO novel (title, inspiration, status, is_external) VALUES ('连载稿', '外部导入', 'imported', 1)")
      .run().lastInsertRowid
  )
  const chapterIds: number[] = []
  for (let i = 1; i <= 3; i++) {
    chapterIds.push(
      Number(
        db
          .prepare("INSERT INTO chapter (novel_id, title, summary, content, status) VALUES (?, ?, '', ?, 'imported')")
          .run(novelId, `第${i}章`, `第${i}章正文内容片段`).lastInsertRowid
      )
    )
  }
  return { novelId, volId: 0, chapterIds }
}

describe('B3 外部书转换', () => {
  it('parseVolumeBoundaries 校验：起点递增、首卷=1、含末章、非法返 null', () => {
    const ok = parseVolumeBoundaries({ volumes: [{ startIndex: 1, title: '第一卷' }, { startIndex: 4, title: '第二卷' }] }, 6)
    expect(ok).not.toBeNull()
    expect(ok).toHaveLength(2)
    // 首卷不从 1 开始 → null
    expect(parseVolumeBoundaries({ volumes: [{ startIndex: 2, title: 'v' }] }, 6)).toBeNull()
    // 起点非递增 → null
    expect(parseVolumeBoundaries({ volumes: [{ startIndex: 1, title: 'v' }, { startIndex: 1, title: 'v2' }] }, 6)).toBeNull()
    // 越界 → null
    expect(parseVolumeBoundaries({ volumes: [{ startIndex: 7, title: 'v' }] }, 6)).toBeNull()
  })

  it('activateAsWorkingBook 翻转 is_external=0 + imported 章节 → written', () => {
    const db = makeDb()
    const { novelId } = makeExternalBook(db)
    activateAsWorkingBook(db, novelId)
    const novel = db.prepare('SELECT is_external, status FROM novel WHERE id = ?').get(novelId) as { is_external: number; status: string }
    expect(novel.is_external).toBe(0)
    expect(novel.status).toBe('draft')
    const ch = db.prepare("SELECT status FROM chapter WHERE novel_id = ? LIMIT 1").get(novelId) as { status: string }
    expect(ch.status).toBe('written')
    expect(db.prepare("SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND status = 'written'").get(novelId)).toMatchObject({ c: 3 })
    db.close()
  })

  it('backfillChapterSummaries 为缺 summary 的章节回填首段摘要', () => {
    const db = makeDb()
    const { novelId } = makeExternalBook(db)
    const filled = backfillChapterSummaries(db, novelId)
    expect(filled).toBe(3)
    const ch = db.prepare("SELECT summary FROM chapter WHERE novel_id = ? LIMIT 1").get(novelId) as { summary: string }
    expect(ch.summary.length).toBeGreaterThan(0)
    db.close()
  })

  it('转换路由：非外部书 → 400；非法 steps → 400', async () => {
    const db = makeDb() as DatabaseSync
    // 普通书（is_external=0）
    const normal = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('普通书', 'x', 'draft')").run().lastInsertRowid)
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/import/book/${normal}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: ['activate'] })
      })
      expect(res.status).toBe(400)
      // 非法 steps
      const { novelId } = makeExternalBook(db)
      const res2 = await fetch(`${base}/api/import/book/${novelId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: ['bogus'] })
      })
      expect(res2.status).toBe(400)
    })
    db.close()
  })
})
