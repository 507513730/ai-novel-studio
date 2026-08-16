// v0.23.1（批次 B5）：约束违反统计接通——validateConstraints 命中禁用词 →
// recordConstraintViolation 登记质量债（[约束违反] 前缀，去重写入）
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { validateConstraints, recordConstraintViolation, setConstraints, type NovelConstraint } from '../server/src/services/constraintEngine'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function setup(db: DatabaseSync): { novelId: number; chapterId: number } {
  const n = db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试灵感', '测试书')
  const novelId = Number(n.lastInsertRowid)
  const c = db
    .prepare("INSERT INTO chapter (novel_id, title, status) VALUES (?, '测试章', 'written')")
    .run(novelId)
  return { novelId, chapterId: Number(c.lastInsertRowid) }
}

const BANNED: NovelConstraint = {
  id: 'c-ban1',
  text: '禁止虐主情节',
  level: 'must',
  enabled: true,
  createdAt: '2026-08-16T00:00:00Z',
  keyword: '虐主'
}

const NAME_RULE: NovelConstraint = {
  id: 'c-name1',
  text: '主角必须叫 Jing',
  level: 'must',
  enabled: true,
  createdAt: '2026-08-16T00:00:00Z',
  keyword: 'Jing',
  replaceWith: 'Jing'
}

describe('约束违反统计接通（批次 B5）', () => {
  it('禁用词出现 → violations 命中并登记质量债（[约束违反] 前缀）', () => {
    const db = makeDb()
    const { novelId, chapterId } = setup(db)
    setConstraints(db, novelId, [BANNED])

    const { violations } = validateConstraints(db, novelId, '这一章的主角被写得非常虐主，读者看不下去了')
    expect(violations).toHaveLength(1)
    expect(violations[0].constraint.id).toBe('c-ban1')
    expect(violations[0].count).toBe(1)

    for (const v of violations) {
      recordConstraintViolation(db, novelId, v.constraint.id, v.constraint.text, chapterId)
    }
    const debts = db
      .prepare("SELECT issue, severity, resolved FROM quality_debt WHERE issue LIKE '[约束违反]%'")
      .all() as Array<{ issue: string; severity: string; resolved: number }>
    expect(debts).toHaveLength(1)
    expect(debts[0].severity).toBe('high')
    expect(debts[0].issue).toContain('c-ban1')
  })

  it('重复登记去重（同章同约束未解决不叠加）', () => {
    const db = makeDb()
    const { novelId, chapterId } = setup(db)
    setConstraints(db, novelId, [BANNED])

    recordConstraintViolation(db, novelId, BANNED.id, BANNED.text, chapterId)
    recordConstraintViolation(db, novelId, BANNED.id, BANNED.text, chapterId)

    const count = (db.prepare("SELECT COUNT(*) AS c FROM quality_debt WHERE issue LIKE '[约束违反]%'").get() as { c: number }).c
    expect(count).toBe(1)
  })

  it('主角名类约束：规范名存在不违反、正文无关也无违反', () => {
    const db = makeDb()
    const { novelId } = setup(db)
    setConstraints(db, novelId, [NAME_RULE])

    expect(validateConstraints(db, novelId, 'Jing 走进了藏经阁').violations).toHaveLength(0)
    expect(validateConstraints(db, novelId, '完全无关的正文').violations).toHaveLength(0)
  })
})
