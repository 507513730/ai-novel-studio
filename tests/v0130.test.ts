import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { writeFactionStates } from '../server/src/services/ledger'
import { buildChapterWriteContext } from '../server/src/services/context'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function setup(db: DatabaseSync): { novelId: number; chapterId: number } {
  const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('整本书', 'x', 'planned')").run().lastInsertRowid)
  db.prepare("INSERT INTO world (novel_id, factions_json) VALUES (?, ?)").run(
    novelId,
    JSON.stringify([{ name: '天机阁', desc: '情报组织' }, { name: '皇城司', desc: '官方监察' }])
  )
  const chapterId = Number(
    db
      .prepare("INSERT INTO chapter (novel_id, title, summary, goal_json, content) VALUES (?, '第一章', '摘要', '{}', '')")
      .run(novelId).lastInsertRowid
  )
  return { novelId, chapterId }
}

describe('v0.13.0 批E-1 势力状态（世界状态机·势力维度）', () => {
  it('writeFactionStates 更新匹配势力的 currentState；不匹配势力忽略', () => {
    const db = makeDb()
    const { novelId } = setup(db)
    const written = writeFactionStates(db, novelId, [
      { name: '天机阁', state: '内乱，阁主失踪' },
      { name: '不存在的势力', state: '忽略' }
    ])
    expect(written).toBe(1)
    const world = db.prepare('SELECT factions_json FROM world WHERE novel_id = ?').get(novelId) as { factions_json: string }
    const factions = JSON.parse(world.factions_json) as Array<{ name: string; currentState?: string }>
    expect(factions.find((f) => f.name === '天机阁')?.currentState).toBe('内乱，阁主失踪')
    expect(factions.find((f) => f.name === '皇城司')?.currentState).toBeUndefined()
    db.close()
  })

  it('生成上下文注入势力状态行（当前状态）', () => {
    const db = makeDb()
    const { novelId, chapterId } = setup(db)
    writeFactionStates(db, novelId, [{ name: '皇城司', state: '加强监视' }])
    const ctx = buildChapterWriteContext(db, novelId, chapterId)
    const content = ctx.messages[0]?.content ?? ''
    expect(content).toContain('【势力】')
    expect(content).toContain('天机阁：情报组织')
    expect(content).toContain('皇城司：官方监察（当前：加强监视）')
    db.close()
  })
})

describe('v0.13.0 批E-2 时间线消费（世界状态机·事件记忆层）', () => {
  it('最近事件注入可变区（chapter_id <= 当前章，倒序最近优先）', () => {
    const db = makeDb()
    const { novelId, chapterId } = setup(db)
    const ins = db.prepare('INSERT INTO timeline_event (novel_id, chapter_id, title, content, time_ref) VALUES (?, ?, ?, ?, ?)')
    ins.run(novelId, chapterId, '第一章', '主角登场', 'chapter-1')
    ins.run(novelId, chapterId, '第一章', '天机阁露出线索', 'chapter-1')
    const ctx = buildChapterWriteContext(db, novelId, chapterId)
    const content = ctx.messages[0]?.content ?? ''
    expect(content).toContain('【时间线（最近事件）】')
    expect(content).toContain('主角登场')
    expect(content).toContain('天机阁露出线索')
    db.close()
  })

  it('无时间线事件时不注入（零噪音）', () => {
    const db = makeDb()
    const { novelId, chapterId } = setup(db)
    const ctx = buildChapterWriteContext(db, novelId, chapterId)
    expect(ctx.messages[0]?.content ?? '').not.toContain('【时间线（最近事件）】')
    db.close()
  })
})
