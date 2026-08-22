// v0.24.2：F2 全书检索（LIKE 转义/分组命中/空词拒绝）+ F4 方案整本生产（入队/绑定/校验/查重）
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createChapterExecutionRouter } from '../server/src/routes/chapters'
import { createSolutionsRouter } from '../server/src/routes/solutions'
import { originGuard } from '../server/src/services/security'
import { enqueueProductionJob } from '../server/src/services/jobQueue'

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
  app.use('/api', createSolutionsRouter(db))
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

function setupNovel(db: DatabaseSync): number {
  const n = db
    .prepare("INSERT INTO novel (title, inspiration, status, current_solution_id) VALUES ('测试书', '灵感', 'draft', NULL)")
    .run()
  return Number(n.lastInsertRowid)
}

function setupSolution(db: DatabaseSync, steps: unknown[], enabled = 1): number {
  const r = db
    .prepare('INSERT INTO solution (name, description, steps_json, enabled, version) VALUES (?, ?, ?, ?, 1)')
    .run('测试方案', '', JSON.stringify(steps), enabled)
  return Number(r.lastInsertRowid)
}

describe('F2 书内全文检索', () => {
  it('空搜索词 400', async () => {
    const db = makeDb()
    const novelId = setupNovel(db)
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}/search?q=`)
      expect(res.status).toBe(400)
    })
    db.close()
  })

  it('章节/角色/伏笔按类型分组命中 + snippet 窗口', async () => {
    const db = makeDb()
    const novelId = setupNovel(db)
    db.prepare("INSERT INTO chapter (novel_id, title, summary, goal_json, content, status, word_count) VALUES (?, ?, ?, '{}', ?, 'written', 3)")
      .run(novelId, '第一章', '', '那盏油灯在桌上摇曳，仿佛在等待什么。')
    const cid = Number((db.prepare('SELECT id FROM chapter WHERE novel_id = ?').get(novelId) as { id: number }).id)
    db.prepare("INSERT INTO character (novel_id, name, profile_json) VALUES (?, ?, ?)")
      .run(novelId, '林默', '{"性格":"沉稳，油灯下思考"}')
    db.prepare("INSERT INTO foreshadow (novel_id, chapter_id, content, status) VALUES (?, ?, ?, 'laid')")
      .run(novelId, cid, '油灯是开启密室的钥匙')

    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}/search?q=${encodeURIComponent('油灯')}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        chapters: Array<{ id: number; snippet: string }>
        characters: Array<{ name: string }>
        foreshadows: Array<{ content: string }>
      }
      expect(body.chapters).toHaveLength(1)
      expect(body.chapters[0].id).toBe(cid)
      expect(body.chapters[0].snippet).toContain('油灯')
      expect(body.characters).toHaveLength(1)
      expect(body.characters[0].name).toBe('林默')
      expect(body.foreshadows).toHaveLength(1)
      expect(body.foreshadows[0].content).toContain('油灯')
    })
    db.close()
  })

  it('LIKE 通配符转义：搜 % 只命中字面 % 而非全表', async () => {
    const db = makeDb()
    const novelId = setupNovel(db)
    db.prepare("INSERT INTO chapter (novel_id, title, summary, goal_json, content, status, word_count) VALUES (?, ?, '', '{}', '普通正文', 'written', 4)")
      .run(novelId, '第一章')

    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}/search?q=${encodeURIComponent('%')}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { chapters: unknown[] }
      expect(body.chapters).toHaveLength(0)
    })
    db.close()
  })
})

describe('F4 方案整本生产', () => {
  it('enqueueProductionJob 同书查重 + range 入 payload', () => {
    const db = makeDb()
    const novelId = setupNovel(db)
    const first = enqueueProductionJob(db, novelId)
    expect('jobId' in first).toBe(true)
    const second = enqueueProductionJob(db, novelId)
    expect('conflict' in second).toBe(true)
    // 不同书不冲突
    const other = setupNovel(db)
    const third = enqueueProductionJob(db, other, { from: 1, to: 5 })
    expect('jobId' in third).toBe(true)
    const job = db.prepare('SELECT payload_json FROM job WHERE id = ?').get((third as { jobId: number }).jobId) as { payload_json: string }
    expect(JSON.parse(job.payload_json)).toMatchObject({ novelId: other, from: 1, to: 5 })
    db.close()
  })

  it('produce-book 校验链：404 / 停用 400 / 无整本步骤 400 / 成功绑定入队 / 重复 409', async () => {
    const db = makeDb()
    const novelId = setupNovel(db)
    db.prepare("INSERT INTO chapter (novel_id, title, summary, goal_json, content, status, word_count) VALUES (?, ?, '', '{}', '', 'planned', 0)")
      .run(novelId, '待生产章')
    const wholeBook = [{ agentId: 1, role: '大纲', stage: 'whole_book', production: { output: 'outline' } }]
    const postOnly = [{ agentId: 1, role: '校对', stage: 'post_generate' }]
    const sol = setupSolution(db, wholeBook)
    const disabledSol = setupSolution(db, wholeBook, 0)
    const postSol = setupSolution(db, postOnly)

    await withServer(makeApp(db), async (base) => {
      // 不存在
      let res = await fetch(`${base}/api/solutions/9999/produce-book`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ novelId }) })
      expect(res.status).toBe(404)
      // 停用
      res = await fetch(`${base}/api/solutions/${disabledSol}/produce-book`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ novelId }) })
      expect(res.status).toBe(400)
      // 无整本步骤
      res = await fetch(`${base}/api/solutions/${postSol}/produce-book`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ novelId }) })
      expect(res.status).toBe(400)
      // 成功：绑定 + 入队
      res = await fetch(`${base}/api/solutions/${sol}/produce-book`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ novelId }) })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { jobId: number; pending: number }
      expect(body.pending).toBe(1)
      const bound = db.prepare('SELECT current_solution_id FROM novel WHERE id = ?').get(novelId) as { current_solution_id: number | null }
      expect(bound.current_solution_id).toBe(sol)
      // 重复（同书 production 活跃态）→ 409
      res = await fetch(`${base}/api/solutions/${sol}/produce-book`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ novelId }) })
      expect(res.status).toBe(409)
    })
    db.close()
  })
})
