import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import type { Server } from 'node:http'
import { applyMigrations } from '../server/src/db/migrate'
import { createVolumesRouter } from '../server/src/routes/volumes'
import { createChapterExecutionRouter } from '../server/src/routes/chapters'
import { apiErrorMiddleware } from '../server/src/services/apiError'
import { claimChapter } from '../server/src/services/chapterGeneration/state'
import { persistGeneratedChapter } from '../server/src/services/chapterGeneration/persistence'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))

async function fixture(run: (db: DatabaseSync, request: (body: unknown, path?: string) => Promise<Response>) => Promise<void>, path = ':memory:'): Promise<void> {
  const db = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true })
  applyMigrations(db)
  db.exec("INSERT OR IGNORE INTO novel (id, title, inspiration) VALUES (1, '书', '灵感'); INSERT OR IGNORE INTO chapter (id, novel_id, title, content) VALUES (1, 1, '章', '原稿')")
  const app = express()
  app.use(express.json())
  app.use('/api', createVolumesRouter(db), createChapterExecutionRouter(db))
  app.use(apiErrorMiddleware)
  const server: Server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const { port } = server.address() as { port: number }
  try {
    await run(db, (body, suffix = '') => fetch(`http://127.0.0.1:${port}/api/1/chapters/1${suffix}`, { method: suffix ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    db.close()
  }
}

describe('正文保存回执与条件提交', () => {
  it('响应丢失后重启重放不重复增量，并返回后来保存的正文', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chapter-receipt-')); directories.push(dir)
    const path = join(dir, 'test.db')
    const input = { expectedContent: '原稿', operationId: 'save-1', content: '人工编辑', humanWordsDelta: 4 }
    await fixture(async (_db, request) => {
      expect((await request(input)).status).toBe(200)
      expect((await request({ expectedContent: '人工编辑', operationId: 'save-2', content: '后来编辑', humanWordsDelta: 2 })).status).toBe(200)
    }, path)
    await fixture(async (db, request) => {
      expect(await (await request(input)).json()).toEqual({ ok: true, replayed: true, currentContent: '后来编辑' })
      expect(db.prepare('SELECT human_words FROM chapter WHERE id=1').get()?.human_words).toBe(6)
      expect((await request({ ...input, content: '篡改重放' })).status).toBe(409)
      const conflict = await request({ ...input, operationId: 'stale' })
      expect(conflict.status).toBe(409)
      expect((await conflict.json()).code).toBe('CHAPTER_CONTENT_CONFLICT')
    }, path)
  })

  it('缺少协议拒绝正文和增量，元数据兼容；失败事务不留回执', async () => fixture(async (db, request) => {
    expect((await request({ content: '新正文' })).status).toBe(400)
    expect((await request({ humanWordsDelta: 3 })).status).toBe(400)
    expect((await request({ title: '新标题' })).status).toBe(200)
    db.exec("CREATE TRIGGER reject_save BEFORE INSERT ON chapter_save_receipt BEGIN SELECT RAISE(ABORT, 'forced receipt failure'); END")
    expect((await request({ content: '失败正文', expectedContent: '原稿', operationId: 'failed', humanWordsDelta: 3 })).status).toBe(500)
    expect(db.prepare('SELECT content,human_words FROM chapter WHERE id=1').get()).toMatchObject({ content: '原稿', human_words: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM chapter_save_receipt').get()?.n).toBe(0)
  }))

  it('生成期间人工保存保持正文并落候选；恢复CAS和重放不重复快照', async () => fixture(async (db, request) => {
    const claim = claimChapter(db, 1, 1)
    expect((await request({ expectedContent: '原稿', operationId: 'human', content: '人工新稿', status: 'written' })).status).toBe(200)
    const generated = persistGeneratedChapter(db, claim, { content: '迟到AI结果', aborted: false })
    expect(generated.persisted).toBe(false)
    expect(db.prepare('SELECT content FROM chapter WHERE id=1').get()?.content).toBe('人工新稿')
    expect(db.prepare('SELECT content FROM chapter_version WHERE id=?').get(generated.candidateVersionId!)?.content).toBe('迟到AI结果')
    const suffix = `/versions/${generated.candidateVersionId}/restore`
    expect((await request({ expectedContent: '原稿', operationId: 'stale-restore' }, suffix)).status).toBe(409)
    const restore = { expectedContent: '人工新稿', operationId: 'restore' }
    expect((await request(restore, suffix)).status).toBe(200)
    expect((await (await request(restore, suffix)).json()).replayed).toBe(true)
    expect(db.prepare('SELECT count(*) AS n FROM chapter_version').get()?.n).toBe(2)
    expect(db.prepare('SELECT content FROM chapter WHERE id=1').get()?.content).toBe('迟到AI结果')
  }))
})
