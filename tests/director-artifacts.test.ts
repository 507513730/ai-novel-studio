// 重构计划 R4.2：导演阶段产物判定契约——完成与否只看落库产物阈值，
// 不依赖 checkpoint 状态字段（重启幂等的事实源，spec §3.3）。
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { isStageDone } from '../server/src/services/director/artifacts'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function seedNovel(db: DatabaseSync): number {
  return Number(
    db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('灵感', '产物判定').lastInsertRowid
  )
}

describe('isStageDone 产物阈值契约（R4.2）', () => {
  it('inspiration 创建书即完成；directions 需 ≥2 套方向', () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    expect(isStageDone(db, novelId, 'inspiration')).toBe(true)

    db.prepare('UPDATE novel SET direction_json = ? WHERE id = ?').run(
      JSON.stringify([{ id: 'd1', scheme: {} }]),
      novelId
    )
    expect(isStageDone(db, novelId, 'directions')).toBe(false)
    db.prepare('UPDATE novel SET direction_json = ? WHERE id = ?').run(
      JSON.stringify([{ id: 'd1', scheme: {} }, { id: 'd2', scheme: {} }]),
      novelId
    )
    expect(isStageDone(db, novelId, 'directions')).toBe(true)
    db.close()
  })

  it('framing 需要 summary；macro 需要 framing.macro.storyEngine', () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    db.prepare('UPDATE novel SET framing_json = ? WHERE id = ?').run(JSON.stringify({ genre: '都市' }), novelId)
    expect(isStageDone(db, novelId, 'framing')).toBe(false)
    db.prepare('UPDATE novel SET framing_json = ? WHERE id = ?').run(JSON.stringify({ summary: 's' }), novelId)
    expect(isStageDone(db, novelId, 'framing')).toBe(true)
    expect(isStageDone(db, novelId, 'macro')).toBe(false)
    db.prepare('UPDATE novel SET framing_json = ? WHERE id = ?').run(
      JSON.stringify({ summary: 's', macro: { storyEngine: 'e' } }),
      novelId
    )
    expect(isStageDone(db, novelId, 'macro')).toBe(true)
    db.close()
  })

  it('world 手册键 ≥2；characters ≥5；volumes ≥2；beats ≥1；chapters ≥5', () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    db.prepare("INSERT INTO world (novel_id, manual_json) VALUES (?, '{}')").run(novelId)
    expect(isStageDone(db, novelId, 'world')).toBe(false)
    db.prepare('UPDATE world SET manual_json = ? WHERE novel_id = ?').run(JSON.stringify({ a: 1, b: 2 }), novelId)
    expect(isStageDone(db, novelId, 'world')).toBe(true)

    for (let i = 0; i < 4; i++) {
      db.prepare("INSERT INTO character (novel_id, name, profile_json, status) VALUES (?, ?, '{}', 'pending')").run(
        novelId,
        `角色${i}`
      )
    }
    expect(isStageDone(db, novelId, 'characters')).toBe(false)
    db.prepare("INSERT INTO character (novel_id, name, profile_json, status) VALUES (?, ?, '{}', 'pending')").run(
      novelId,
      '角色5'
    )
    expect(isStageDone(db, novelId, 'characters')).toBe(true)

    db.prepare("INSERT INTO volume (novel_id, title, order_index) VALUES (?, '卷1', 0)").run(novelId)
    expect(isStageDone(db, novelId, 'volumes')).toBe(false)
    db.prepare("INSERT INTO volume (novel_id, title, order_index) VALUES (?, '卷2', 1)").run(novelId)
    expect(isStageDone(db, novelId, 'volumes')).toBe(true)

    expect(isStageDone(db, novelId, 'beats')).toBe(false)
    const vol1 = db.prepare('SELECT id FROM volume WHERE title = ?').get('卷1') as { id: number }
    db.prepare("INSERT INTO beat (volume_id, title, summary, order_index) VALUES (?, '拍1', '{}', 0)").run(vol1.id)
    expect(isStageDone(db, novelId, 'beats')).toBe(true)

    expect(isStageDone(db, novelId, 'chapters')).toBe(false)
    for (let i = 0; i < 5; i++) {
      db.prepare(
        "INSERT INTO chapter (novel_id, volume_id, title, goal_json, content, status) VALUES (?, ?, ?, '{}', '', 'planned')"
      ).run(novelId, vol1.id, `第${i + 1}章`)
    }
    expect(isStageDone(db, novelId, 'chapters')).toBe(true)
    db.close()
  })

  it('refine：所有 planned 空内容章节都必须有 purpose；ready 为全阶段聚合', () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    const volId = Number(
      db.prepare("INSERT INTO volume (novel_id, title, order_index) VALUES (?, '卷1', 0)").run(novelId).lastInsertRowid
    )
    db.prepare(
      "INSERT INTO chapter (novel_id, volume_id, title, goal_json, content, status) VALUES (?, ?, '第1章', '{}', '', 'planned')"
    ).run(novelId, volId)
    expect(isStageDone(db, novelId, 'refine')).toBe(false)
    db.prepare("UPDATE chapter SET goal_json = '{\"purpose\":\"钩子\"}' WHERE novel_id = ?").run(novelId)
    expect(isStageDone(db, novelId, 'refine')).toBe(true)

    // ready：任一前置未完成即未完成（此处 world 为空 → false）
    expect(isStageDone(db, novelId, 'ready')).toBe(false)
    db.close()
  })
})
