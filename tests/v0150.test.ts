// v0.15.0：用户创作约束机制（Generalized Constraints）
import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import {
  getConstraints,
  setConstraints,
  addConstraint,
  constraintsBlock,
  replaceProtagonistName,
  recordConstraintViolation,
  type NovelConstraint
} from '../server/src/services/constraintEngine'

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db)
  db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '测试书', '灵感', 'draft')").run()
  db.prepare(
    "INSERT INTO character (novel_id, name, profile_json, status) VALUES (1, '林惊蛰', ?, 'pending')"
  ).run(JSON.stringify({ role: '主角', identity: '穿越者' }))
  return db
}

const PREFIX = 'v0.15.0 约束机制'

describe(`${PREFIX} · 迁移与读写`, () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDb()
  })

  it('v16 迁移：novel 表有 constraints_json 列且默认空数组', () => {
    const cols = db.prepare("PRAGMA table_info(novel)").all() as Array<{ name: string; dflt_value: string | null }>
    const c = cols.find((x) => x.name === 'constraints_json')
    expect(c).toBeTruthy()
    expect(getConstraints(db, 1)).toEqual([])
  })

  it('setConstraints 往返 + getConstraints 过滤禁用', () => {
    const list: NovelConstraint[] = [
      { id: 'c1', text: '主角必须叫 Jing', level: 'must', enabled: true, createdAt: 'x', keyword: 'Jing', replaceWith: 'Jing' },
      { id: 'c2', text: '文风轻快', level: 'should', enabled: false, createdAt: 'x' }
    ]
    setConstraints(db, 1, list)
    const got = getConstraints(db, 1)
    expect(got).toHaveLength(1)
    expect(got[0].id).toBe('c1')
  })

  it('addConstraint 追加并返回完整对象', () => {
    const c = addConstraint(db, 1, { text: '不许虐主', level: 'must', enabled: true })
    expect(c.id).toBeTruthy()
    expect(c.createdAt).toBeTruthy()
    expect(getConstraints(db, 1)).toHaveLength(1)
  })
})

describe(`${PREFIX} · 注入块`, () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDb()
  })

  it('无约束时返回空串', () => {
    expect(constraintsBlock(db, 1)).toBe('')
  })

  it('硬约束块带【不可变创作约束】标题、软偏好独立成块', () => {
    setConstraints(db, 1, [
      { id: 'c1', text: '主角必须叫 Jing', level: 'must', enabled: true, createdAt: 'x' },
      { id: 'c2', text: '节奏明快', level: 'should', enabled: true, createdAt: 'x' }
    ])
    const block = constraintsBlock(db, 1)
    expect(block).toContain('【不可变创作约束（必须严格遵循，任何产出不得违反）】')
    expect(block).toContain('主角必须叫 Jing')
    expect(block).toContain('【创作偏好（尽量遵循）】')
    expect(block).toContain('节奏明快')
  })
})

describe(`${PREFIX} · 主角名自动对齐`, () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDb()
  })

  it('正文中的角色表主角名被替换为规范名', () => {
    setConstraints(db, 1, [
      { id: 'c1', text: '主角必须叫 Jing', level: 'must', enabled: true, createdAt: 'x', keyword: 'Jing', replaceWith: 'Jing' }
    ])
    const out = replaceProtagonistName(db, 1, '林惊蛰踏出石村，林惊蛰握紧玉符。')
    expect(out).toBe('Jing踏出石村，Jing握紧玉符。')
  })

  it('无主角约束时原样返回', () => {
    const out = replaceProtagonistName(db, 1, '林惊蛰踏出石村。')
    expect(out).toBe('林惊蛰踏出石村。')
  })

  it('正文已是规范名时不动', () => {
    setConstraints(db, 1, [
      { id: 'c1', text: '主角必须叫 Jing', level: 'must', enabled: true, createdAt: 'x', keyword: 'Jing', replaceWith: 'Jing' }
    ])
    db.prepare("UPDATE character SET name = 'Jing' WHERE novel_id = 1").run()
    const out = replaceProtagonistName(db, 1, 'Jing踏出石村。')
    expect(out).toBe('Jing踏出石村。')
  })
})

describe(`${PREFIX} · 违反记录`, () => {
  it('约束违反写入 quality_debt（可被遵守率统计消费）', () => {
    const db = openDb()
    const ch = db.prepare("INSERT INTO chapter (novel_id, title, status) VALUES (1, '第一章', 'written')").run()
    recordConstraintViolation(db, 1, 'c1', '主角名漂移', Number(ch.lastInsertRowid))
    const rows = db.prepare("SELECT * FROM quality_debt WHERE issue LIKE '[约束违反]%'").all() as Array<{ issue: string; severity: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].severity).toBe('high')
    expect(rows[0].issue).toContain('c1')
  })
})
