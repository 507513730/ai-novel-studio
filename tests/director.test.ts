import { describe, it, expect } from 'vitest'
import { isStageDone } from '../server/src/services/director/artifacts'
import { STAGE_ORDER } from '../server/src/services/director/stages'
import { buildFrozenContext } from '../server/src/services/context/frozen'
import { buildChapterWriteContext } from '../server/src/services/context/dynamic'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

describe('导演状态机幂等判定（isStageDone）', () => {
  it('空书：directions/world/characters/volumes 全部未完成', () => {
    const db = makeDb()
    const id = Number(
      db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试灵感', '测试书').lastInsertRowid
    )
    db.prepare('INSERT INTO world (novel_id) VALUES (?)').run(id)
    expect(isStageDone(db, id, 'directions')).toBe(false)
    expect(isStageDone(db, id, 'world')).toBe(false)
    expect(isStageDone(db, id, 'characters')).toBe(false)
    expect(isStageDone(db, id, 'volumes')).toBe(false)
    expect(isStageDone(db, id, 'ready')).toBe(false)
    db.close()
  })

  it('产物落库后判定完成（幂等：不依赖状态字段）', () => {
    const db = makeDb()
    const id = Number(
      db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试灵感', '测试书').lastInsertRowid
    )
    db.prepare('INSERT INTO world (novel_id) VALUES (?)').run(id)
    // directions：写入 2 套
    db.prepare('UPDATE novel SET direction_json = ? WHERE id = ?').run(
      JSON.stringify([
        { id: 'd1', scheme: { title: 'A', sellingPoint: 'x', genre: '都市' } },
        { id: 'd2', scheme: { title: 'B', sellingPoint: 'y', genre: '悬疑' } }
      ]),
      id
    )
    expect(isStageDone(db, id, 'directions')).toBe(true)
    // world：写入 manual
    db.prepare('UPDATE world SET manual_json = ? WHERE novel_id = ?').run(
      JSON.stringify({ 力量体系: '描述1', 社会结构: '描述2' }),
      id
    )
    expect(isStageDone(db, id, 'world')).toBe(true)
    db.close()
  })

  it('refine：所有 planned 章节必须含 purpose', () => {
    const db = makeDb()
    const id = Number(
      db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试灵感', '测试书').lastInsertRowid
    )
    db.prepare('INSERT INTO world (novel_id) VALUES (?)').run(id)
    db.prepare(
      "INSERT INTO chapter (novel_id, title, status, goal_json) VALUES (?, '第一章', 'planned', '{}')"
    ).run(id)
    expect(isStageDone(db, id, 'refine')).toBe(false)
    db.prepare(
      "UPDATE chapter SET goal_json = ? WHERE novel_id = ?"
    ).run(JSON.stringify({ purpose: '推进主线', tasks: ['a'], scenes: ['b'], ending: '钩子' }), id)
    expect(isStageDone(db, id, 'refine')).toBe(true)
    db.close()
  })
})

describe('上下文组装器（前缀冻结 + 回灌闭环）', () => {
  it('冻结区 hash 稳定（内容不变 hash 不变）', () => {
    const db = makeDb()
    const id = Number(
      db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试灵感', '测试书').lastInsertRowid
    )
    db.prepare('INSERT INTO world (novel_id) VALUES (?)').run(id)
    const f1 = buildFrozenContext(db, id)
    const f2 = buildFrozenContext(db, id)
    expect(f1.hash).toBe(f2.hash)
    db.close()
  })

  it('章节任务单存在 + 前文回顾注入', () => {
    const db = makeDb()
    const id = Number(
      db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试灵感', '测试书').lastInsertRowid
    )
    db.prepare('INSERT INTO world (novel_id) VALUES (?)').run(id)
    db.prepare(
      "INSERT INTO chapter (novel_id, title, summary, status, goal_json) VALUES (?, '第一章', '开局', 'written', '{}')"
    ).run(id)
    const ch2 = Number(
      db
        .prepare("INSERT INTO chapter (novel_id, title, summary, status, goal_json) VALUES (?, '第二章', '发展', 'planned', '{}')")
        .run(id).lastInsertRowid
    )
    const ctx = buildChapterWriteContext(db, id, ch2)
    const text = ctx.messages[0].content
    expect(text).toContain('第二章')
    expect(text).toContain('前文回顾')
    expect(ctx.budgetUsed).toBeLessThanOrEqual(ctx.budgetLimit)
    db.close()
  })

  it('STAGE_ORDER 完整性（11 阶段）', () => {
    expect(STAGE_ORDER).toHaveLength(11)
    expect(STAGE_ORDER[0]).toBe('inspiration')
    expect(STAGE_ORDER[10]).toBe('ready')
  })
})
