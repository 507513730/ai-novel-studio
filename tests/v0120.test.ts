import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { getChapterPosition, chapterPositionBlock } from '../server/src/services/chapterRole'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function setup(db: DatabaseSync): { novelId: number; volumeId: number; beatId: number; chapterIds: number[] } {
  const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('整本书', 'x', 'planned')").run().lastInsertRowid)
  const volumeId = Number(
    db
      .prepare("INSERT INTO volume (novel_id, title, strategy_json, order_index) VALUES (?, '第一卷 风起', '{}', 0)")
      .run(novelId).lastInsertRowid
  )
  const beatId = Number(
    db.prepare("INSERT INTO beat (volume_id, title, summary, order_index) VALUES (?, '引入主角', '主角登场与悬念', 0)").run(volumeId).lastInsertRowid
  )
  const chapterIds: number[] = []
  for (let i = 0; i < 3; i++) {
    const id = Number(
      db
        .prepare("INSERT INTO chapter (novel_id, volume_id, beat_id, title, content) VALUES (?, ?, ?, ?, '')")
        .run(novelId, volumeId, beatId, `第${i + 1}章`).lastInsertRowid
    )
    chapterIds.push(id)
  }
  return { novelId, volumeId, beatId, chapterIds }
}

describe('v0.12.0 批D-1 卷章定位（P31）', () => {
  it('无卷数据 → null（零噪音）', () => {
    const db = makeDb()
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', 'x', 'draft')").run().lastInsertRowid)
    const chapterId = Number(db.prepare("INSERT INTO chapter (novel_id, title) VALUES (?, '章')").run(novelId))
    expect(getChapterPosition(db, novelId, chapterId)).toBeNull()
    expect(chapterPositionBlock(db, novelId, chapterId)).toBe('')
    db.close()
  })

  it('卷内位置与角色推断：首=开篇 / 末=收尾 / 中=推进', () => {
    const db = makeDb()
    const { novelId, chapterIds } = setup(db)
    const first = getChapterPosition(db, novelId, chapterIds[0])
    const middle = getChapterPosition(db, novelId, chapterIds[1])
    const last = getChapterPosition(db, novelId, chapterIds[2])
    expect(first?.role).toBe('开篇')
    expect(middle?.role).toBe('推进')
    expect(last?.role).toBe('收尾')
    expect(first?.volumeTitle).toBe('第一卷 风起')
    expect(first?.chapterIndexInVolume).toBe(1)
    expect(first?.chapterCountInVolume).toBe(3)
    db.close()
  })

  it('chapterPositionBlock 注入卷/角色/节拍', () => {
    const db = makeDb()
    const { novelId, chapterIds } = setup(db)
    const block = chapterPositionBlock(db, novelId, chapterIds[0])
    expect(block).toContain('【卷章定位】')
    expect(block).toContain('第一卷 风起')
    expect(block).toContain('开篇')
    expect(block).toContain('引入主角')
    db.close()
  })
})
