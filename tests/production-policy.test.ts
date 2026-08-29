// 重构计划 R4.3：整本生产批次策略契约——
// 产物驱动选章（content=''）、范围授权校验、生成不达标阈值、ConfigError 整批熔断判定。
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { ConfigError } from '../server/src/services/llm'
import { selectPendingChapters, isGenerationSubstandard, isBatchFatalError } from '../server/src/services/production/chapterPolicy'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function seedNovelWithChapters(db: DatabaseSync): { novelId: number; chapterIds: number[] } {
  const novelId = Number(
    db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('灵感', '生产策略').lastInsertRowid
  )
  const volumeId = Number(
    db.prepare('INSERT INTO volume (novel_id, title, order_index) VALUES (?, ?, ?)').run(novelId, '第一卷', 0).lastInsertRowid
  )
  const chapterIds: number[] = []
  for (let i = 1; i <= 4; i++) {
    chapterIds.push(
      Number(
        db
          .prepare(
            "INSERT INTO chapter (novel_id, volume_id, title, content, status) VALUES (?, ?, ?, '', 'planned')"
          )
          .run(novelId, volumeId, `第${i}章`).lastInsertRowid
      )
    )
  }
  return { novelId, chapterIds }
}

describe('selectPendingChapters（产物驱动选章）', () => {
  it('只有无正文章节进入批次；已有正文即产物被跳过（kill 恢复依据）', () => {
    const db = makeDb()
    const { novelId, chapterIds } = seedNovelWithChapters(db)
    db.prepare('UPDATE chapter SET content = ? WHERE id = ?').run('已有正文产物', chapterIds[0])

    const selected = selectPendingChapters(db, novelId)
    expect(selected.map((c) => c.id)).toEqual([chapterIds[1], chapterIds[2], chapterIds[3]])
    db.close()
  })

  it('范围授权：from/to 必须成对且 to ≥ from；区间过滤生效', () => {
    const db = makeDb()
    const { novelId, chapterIds } = seedNovelWithChapters(db)

    expect(() => selectPendingChapters(db, novelId, { from: chapterIds[0] })).toThrow(/同时提供/)
    expect(() => selectPendingChapters(db, novelId, { to: chapterIds[3] })).toThrow(/同时提供/)
    expect(() => selectPendingChapters(db, novelId, { from: 3, to: 2 })).toThrow(/to 小于 from/)

    const range = selectPendingChapters(db, novelId, { from: chapterIds[1], to: chapterIds[2] })
    expect(range.map((c) => c.id)).toEqual([chapterIds[1], chapterIds[2]])
    db.close()
  })
})

describe('isGenerationSubstandard / isBatchFatalError', () => {
  it('空正文或字数 <200 不达标；≥200 达标', () => {
    expect(isGenerationSubstandard({ content: '', wordCount: 0 })).toBe(true)
    expect(isGenerationSubstandard({ content: '正文', wordCount: 199 })).toBe(true)
    expect(isGenerationSubstandard({ content: '正文', wordCount: 200 })).toBe(false)
  })

  it('仅 ConfigError 整批熔断；普通错误继续下一章', () => {
    expect(isBatchFatalError(new ConfigError('key 未配置'))).toBe(true)
    expect(isBatchFatalError(new Error('网络超时'))).toBe(false)
    expect(isBatchFatalError('字符串错误')).toBe(false)
  })
})
