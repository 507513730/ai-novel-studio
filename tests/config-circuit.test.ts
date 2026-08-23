import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { callLlm, ConfigError } from '../server/src/services/llm'
import { generateChapter } from '../server/src/services/generate'
import { runProductionPipeline } from '../server/src/services/production'

// v0.24.3（写书实战纠错）：配置级错误熔断——历史 bug：key 解密失败时生产管线逐章空转
// 标 failed（任务 28/29 共 27 章误标）而 job 仍 done。此组测试锁定：
// ① callLlm 对路由/key 缺失与解密失败抛 ConfigError；② generateChapter 不误标章节；
// ③ runProductionPipeline 首个 ConfigError 即熔断上抛。

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function makeNovelWithChapters(db: DatabaseSync, chapterCount: number): { novelId: number; chapterIds: number[] } {
  const novelId = Number(
    db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试灵感', '熔断测试书').lastInsertRowid
  )
  const volumeId = Number(
    db.prepare('INSERT INTO volume (novel_id, title, order_index) VALUES (?, ?, ?)').run(novelId, '第一卷', 0)
      .lastInsertRowid
  )
  const chapterIds: number[] = []
  for (let i = 1; i <= chapterCount; i++) {
    const cid = Number(
      db
        .prepare(
          "INSERT INTO chapter (novel_id, volume_id, title, summary, goal_json, content, status) VALUES (?, ?, ?, ?, ?, '', 'planned')"
        )
        .run(novelId, volumeId, `第${i}章`, `摘要${i}`, '{}').lastInsertRowid
    )
    chapterIds.push(cid)
  }
  return { novelId, chapterIds }
}

const MESSAGES = [{ role: 'user' as const, content: 'ping' }]

describe('配置级错误分类（ConfigError）', () => {
  it('路由指向的供应商未配置 key → ConfigError（含指引）', async () => {
    const db = makeDb()
    await expect(callLlm(db, 'prose', { messages: MESSAGES, maxTokens: 16 })).rejects.toThrow(ConfigError)
    await expect(callLlm(db, 'prose', { messages: MESSAGES, maxTokens: 16 })).rejects.toThrow(/未配置 API Key/)
    db.close()
  })

  it('key 解密失败（密文损坏/来自旧环境）→ ConfigError 且带 cause', async () => {
    const db = makeDb()
    db.prepare("UPDATE provider SET api_key_encrypted = 'not-a-valid-ciphertext' WHERE name = 'DeepSeek'").run()
    const err = await callLlm(db, 'prose', { messages: MESSAGES, maxTokens: 16 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConfigError)
    expect((err as Error).message).toContain('解密失败')
    expect((err as ConfigError).cause).toBeDefined()
    db.close()
  })
})

describe('generateChapter 配置错误不误标章节', () => {
  it('ConfigError 时章节恢复抢占前状态（planned），而非 failed', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 1)
    await expect(generateChapter(db, novelId, chapterIds[0])).rejects.toThrow(ConfigError)
    const row = db.prepare('SELECT status FROM chapter WHERE id = ?').get(chapterIds[0]) as { status: string }
    expect(row.status).toBe('planned')
    db.close()
  })
})

describe('生产管线配置错误熔断', () => {
  it('首个 ConfigError 即上抛：不逐章标 failed，未尝试章节保持 planned', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = makeNovelWithChapters(db, 3)
    await expect(
      runProductionPipeline(db, novelId, () => {
        /* 进度回调 */
      })
    ).rejects.toThrow(ConfigError)
    for (const cid of chapterIds) {
      const row = db.prepare('SELECT status FROM chapter WHERE id = ?').get(cid) as { status: string }
      expect(row.status).toBe('planned')
    }
    db.close()
  })
})
