// 重构计划 R5：章节执行路由契约测试——拆分前后路径/方法/状态码/camelCase 响应保持不变。
// 覆盖：CRUD 创建、待确认区、确认、版本（列表/快照/详情/diff/恢复）、检索、上下文预览、
// 记忆面修正，以及 LLM 路由未配置时审核端点的 ConfigurationError→400 语义。
import { describe, expect, it } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createChapterExecutionRouter } from '../server/src/routes/chapters'
import { apiErrorMiddleware } from '../server/src/services/apiError'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function makeApp(db: DatabaseSync): express.Express {
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/novels', createChapterExecutionRouter(db))
  app.use(apiErrorMiddleware)
  return app
}

async function withServer<T>(db: DatabaseSync, fn: (base: string) => Promise<T>): Promise<T> {
  const server: Server = await new Promise((resolve) => {
    const s = makeApp(db).listen(0, () => resolve(s))
  })
  const { port } = server.address() as { port: number }
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
  }
}

function seedNovelWithChapter(db: DatabaseSync, content = ''): { novelId: number; chapterId: number } {
  const novelId = Number(
    db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('灵感', '契约测试书').lastInsertRowid
  )
  const volumeId = Number(
    db.prepare('INSERT INTO volume (novel_id, title, order_index) VALUES (?, ?, ?)').run(novelId, '第一卷', 0).lastInsertRowid
  )
  const chapterId = Number(
    db
      .prepare("INSERT INTO chapter (novel_id, volume_id, title, content, status) VALUES (?, ?, '第1章', ?, 'planned')")
      .run(novelId, volumeId, content).lastInsertRowid
  )
  return { novelId, chapterId }
}

describe('章节执行路由契约（R5 拆分回归）', () => {
  it('POST /:novelId/chapters 创建：201 / novel 404 / 卷不存在 400', async () => {
    const db = makeDb()
    const { novelId } = seedNovelWithChapter(db)
    await withServer(db, async (base) => {
      const created = await fetch(`${base}/api/novels/${novelId}/chapters`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '手动新章' })
      })
      expect(created.status).toBe(201)
      expect('id' in (await created.json())).toBe(true)

      const missing = await fetch(`${base}/api/novels/99999/chapters`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
      expect(missing.status).toBe(404)

      const badVolume = await fetch(`${base}/api/novels/${novelId}/chapters`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ volumeId: 99999 })
      })
      expect(badVolume.status).toBe(400)
    })
    db.close()
  })

  it('待确认区与确认端点：camelCase 字段 + ZodError 400', async () => {
    const db = makeDb()
    const { novelId, chapterId } = seedNovelWithChapter(db, '正文内容')
    await withServer(db, async (base) => {
      const pending = await fetch(`${base}/api/novels/${novelId}/pending`)
      expect(pending.status).toBe(200)
      const body = (await pending.json()) as { pendingFacts: Array<Record<string, unknown>>; pendingCharacters: unknown[] }
      expect(Array.isArray(body.pendingFacts)).toBe(true)
      expect(Array.isArray(body.pendingCharacters)).toBe(true)

      const invalid = await fetch(`${base}/api/novels/${novelId}/confirm-state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterStates: 'oops' })
      })
      expect(invalid.status).toBe(400)

      const confirmed = await fetch(`${base}/api/novels/${novelId}/confirm-state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterStates: [] })
      })
      expect(confirmed.status).toBe(200)
      expect(((await confirmed.json()) as { ok: boolean; written: number })).toMatchObject({ ok: true, written: 0 })
      expect(chapterId).toBeGreaterThan(0)
    })
    db.close()
  })

  it('版本五端点：快照 201 / 列表 camelCase / 详情 / diff / 恢复（恢复前快照）', async () => {
    const db = makeDb()
    const { novelId, chapterId } = seedNovelWithChapter(db, '天地玄黄，宇宙洪荒。')
    await withServer(db, async (base) => {
      const base_ = `${base}/api/novels/${novelId}/chapters/${chapterId}`

      const missing = await fetch(`${base}/api/novels/${novelId}/chapters/99999/versions`)
      expect(missing.status).toBe(404)

      const snap = await fetch(`${base_}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
      expect(snap.status).toBe(201)
      const { versionId } = (await snap.json()) as { versionId: number }

      const list = await fetch(`${base_}/versions`)
      const listBody = (await list.json()) as { versions: Array<{ id: number; note: string; createdAt: string; wordCount: number; preview: string }> }
      expect(listBody.versions[0]).toMatchObject({ id: versionId, note: '手动快照' })
      expect(listBody.versions[0].createdAt).toBeTruthy()
      expect(listBody.versions[0].wordCount).toBe(8)
      expect(Object.keys(listBody.versions[0])).not.toContain('created_at')

      const detail = await fetch(`${base_}/versions/${versionId}`)
      expect(detail.status).toBe(200)
      expect(((await detail.json()) as { version: { id: number } }).version.id).toBe(versionId)

      // 当前正文改写后 diff 可用
      db.prepare('UPDATE chapter SET content = ? WHERE id = ?').run('全新正文内容', chapterId)
      const diff = await fetch(`${base_}/versions/${versionId}/diff`)
      expect(diff.status).toBe(200)
      expect(((await diff.json()) as { versionId: number }).versionId).toBe(versionId)

      const restore = await fetch(`${base_}/versions/${versionId}/restore`, { method: 'POST' })
      expect(restore.status).toBe(200)
      const restored = (await restore.json()) as { content: string; wordCount: number }
      expect(restored.content).toBe('天地玄黄，宇宙洪荒。')
      expect(restored.wordCount).toBe(8)
      const versionsNow = db
        .prepare('SELECT COUNT(*) AS c FROM chapter_version WHERE chapter_id = ?')
        .get(chapterId) as { c: number }
      expect(versionsNow.c).toBe(2) // 恢复前快照 + 被恢复版本

      const missingVersion = await fetch(`${base_}/versions/99999`)
      expect(missingVersion.status).toBe(404)
    })
    db.close()
  })

  it('检索端点：空词 400 / 命中章节与角色 / 超长词 400', async () => {
    const db = makeDb()
    const { novelId } = seedNovelWithChapter(db, '雨夜追凶是本章的主线剧情。')
    await withServer(db, async (base) => {
      const empty = await fetch(`${base}/api/novels/${novelId}/search?q=`)
      expect(empty.status).toBe(400)

      const hit = await fetch(`${base}/api/novels/${novelId}/search?q=${encodeURIComponent('雨夜')}`)
      expect(hit.status).toBe(200)
      const body = (await hit.json()) as { query: string; chapters: Array<{ snippet: string }>; characters: unknown[] }
      expect(body.query).toBe('雨夜')
      expect(body.chapters[0].snippet).toContain('雨夜')

      const tooLong = await fetch(`${base}/api/novels/${novelId}/search?q=${encodeURIComponent('长'.repeat(101))}`)
      expect(tooLong.status).toBe(400)
    })
    db.close()
  })

  it('context-preview：结构化分段 + budget 字段（camelCase）', async () => {
    const db = makeDb()
    const { novelId, chapterId } = seedNovelWithChapter(db, '正文')
    await withServer(db, async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}/chapters/${chapterId}/context-preview`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { sections: unknown[]; totalTokens: number; budgetLimit: number }
      expect(Array.isArray(body.sections)).toBe(true)
      expect(typeof body.totalTokens).toBe('number')
      expect(typeof body.budgetLimit).toBe('number')
    })
    db.close()
  })

  it('记忆面修正：角色不存在 404 / 势力不存在 404 / 正常修正 ok', async () => {
    const db = makeDb()
    const { novelId } = seedNovelWithChapter(db)
    db.prepare("INSERT INTO character (novel_id, name, profile_json, status) VALUES (?, ?, '{}', 'roster')").run(
      novelId,
      '主角甲'
    )
    await withServer(db, async (base) => {
      const missing = await fetch(`${base}/api/novels/${novelId}/memory/character`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '不存在', state: '受伤' })
      })
      expect(missing.status).toBe(404)

      const ok = await fetch(`${base}/api/novels/${novelId}/memory/character`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '主角甲', state: '受伤' })
      })
      expect(ok.status).toBe(200)
      expect(((await ok.json()) as { states: string[] }).states).toContain('受伤')

      const missingFaction = await fetch(`${base}/api/novels/${novelId}/memory/faction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '无此势力', state: '扩张' })
      })
      expect(missingFaction.status).toBe(404)
    })
    db.close()
  })

  it('审核端点：模型路由未配置 → ConfigurationError 400 带可操作指引（不再伪装 500）', async () => {
    const db = makeDb()
    const { novelId, chapterId } = seedNovelWithChapter(db, '需要审核的正文。')
    await withServer(db, async (base) => {
      const res = await fetch(`${base}/api/novels/${novelId}/chapters/${chapterId}/review`, { method: 'POST' })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('API Key')
    })
    db.close()
  })
})
