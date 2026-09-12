import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { registerChapterVersionRoutes } from '../server/src/routes/chapters/versions'
import { apiErrorMiddleware } from '../server/src/services/apiError'
import { fixChapterOnce } from '../server/src/services/debtFix'
import { callLlmJson } from '../server/src/services/jsonSafe'

vi.mock('../server/src/services/jsonSafe', () => ({ callLlmJson: vi.fn() }))
vi.mock('../server/src/services/context/dynamic', () => ({ buildChapterReviewContext: () => [], buildFixContext: () => [] }))
afterEach(() => vi.resetAllMocks())
function fixture() {
  const db = new DatabaseSync(':memory:', { timeout: 5000, enableForeignKeyConstraints: true })
  applyMigrations(db); seedIfEmpty(db)
  const novelId = Number(db.prepare("INSERT INTO novel(title) VALUES ('隔离测试书')").run().lastInsertRowid)
  const chapterId = Number(db.prepare("INSERT INTO chapter(novel_id,title,content) VALUES (?, '测试章', '原始正文')").run(novelId).lastInsertRowid)
  return { db, novelId, chapterId }
}
describe('候选内容持久化', () => {
  it('版本接口保留指定候选正文而不覆盖书稿，旧快照调用保持兼容', async () => {
    const { db, novelId, chapterId } = fixture()
    const app = express(); const router = express.Router()
    app.use(express.json()); registerChapterVersionRoutes(router, db); app.use('/api/novels', router); app.use(apiErrorMiddleware)
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/novels/${novelId}/chapters/${chapterId}/versions`
    try {
      for (const body of [{ content: 'AI 候选正文', note: '待采用' }, {}]) {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        expect(response.status).toBe(201)
      }
      expect(db.prepare('SELECT content FROM chapter WHERE id=?').get(chapterId)?.content).toBe('原始正文')
      expect(db.prepare('SELECT content FROM chapter_version WHERE chapter_id=? ORDER BY id').all(chapterId).map(r => r.content)).toEqual(['AI 候选正文', '原始正文'])
      const invalid = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 42 }) })
      expect(invalid.status).toBe(400)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close() }
  })
  it('模型返回前手动保存后，修复仅存候选版本且不重审旧正文', async () => {
    const { db, novelId, chapterId } = fixture()
    const fixed = '修复后的 AI 正文'.repeat(20)
    vi.mocked(callLlmJson).mockImplementationOnce(async () => {
      db.prepare('UPDATE chapter SET content=? WHERE id=?').run('手动保存的新正文', chapterId)
      return { content: fixed }
    })
    try {
      const result = await fixChapterOnce(db, novelId, chapterId)
      expect(result.fixed).toBe(false)
      expect(result.reason).toContain('正文已修改')
      expect(db.prepare('SELECT content FROM chapter WHERE id=?').get(chapterId)?.content).toBe('手动保存的新正文')
      expect(db.prepare('SELECT content FROM chapter_version WHERE chapter_id=?').get(chapterId)?.content).toBe(fixed)
      expect(callLlmJson).toHaveBeenCalledTimes(1)
    } finally { db.close() }
  })
  it('重审期间正文变化时不写回过期审核，也不解除质量债', async () => {
    const { db, novelId, chapterId } = fixture()
    db.prepare("INSERT INTO quality_debt(chapter_id,issue,severity,resolved) VALUES (?, '测试问题', 'high', 0)").run(chapterId)
    vi.mocked(callLlmJson).mockResolvedValueOnce({ content: '修复结果'.repeat(40) }).mockImplementationOnce(async () => {
      db.prepare('UPDATE chapter SET content=? WHERE id=?').run('重审期间手改', chapterId)
      return { score: 90, issues: [], needsFix: false }
    })
    try {
      const result = await fixChapterOnce(db, novelId, chapterId)
      expect(result.passed).toBe(false)
      expect(db.prepare('SELECT resolved FROM quality_debt WHERE chapter_id=?').get(chapterId)?.resolved).toBe(0)
      expect(db.prepare('SELECT content FROM chapter WHERE id=?').get(chapterId)?.content).toBe('重审期间手改')
    } finally { db.close() }
  })
})
