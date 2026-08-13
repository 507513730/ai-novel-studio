// v0.21.0：第二轮审查修复批（M11 词边界 / ledger 上限 / N1 记账 SQL 语义辅助）
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { setConstraints, replaceProtagonistName } from '../server/src/services/constraintEngine'
import { writeCharacterStates } from '../server/src/services/ledger'

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db)
  return db
}

const PREFIX = 'v0.21.0 审查修复'

describe(`${PREFIX} · M11 词边界替换`, () => {
  it('主角名 ≥2 字：正常替换 + 子串不误伤（前字符边界）', () => {
    const db = openDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'draft')").run()
    db.prepare(
      "INSERT INTO character (novel_id, name, profile_json, status) VALUES (1, '林惊蛰', ?, 'pending')"
    ).run(JSON.stringify({ role: '主角' }))
    setConstraints(db, 1, [
      { id: 'c1', text: '主角必须叫 Jing', level: 'must', enabled: true, createdAt: 'x', keyword: 'Jing', replaceWith: 'Jing' }
    ])
    // 独立出现 → 替换；「林惊蛰」整名出现 → 替换
    const out = replaceProtagonistName(db, 1, '林惊蛰踏出石村，石昊看向林惊蛰。')
    expect(out).toBe('Jing踏出石村，石昊看向Jing。')
  })

  it('1 字主角名放弃自动替换（防常用字子串误伤）', () => {
    const db = openDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'draft')").run()
    db.prepare("INSERT INTO character (novel_id, name, profile_json, status) VALUES (1, '惊', ?, 'pending')").run(
      JSON.stringify({ role: '主角' })
    )
    setConstraints(db, 1, [
      { id: 'c1', text: '主角必须叫 Jing', level: 'must', enabled: true, createdAt: 'x', keyword: 'Jing', replaceWith: 'Jing' }
    ])
    const out = replaceProtagonistName(db, 1, '惊蛰过后，惊雷炸响。')
    expect(out).toBe('惊蛰过后，惊雷炸响。')
  })

  it('主角名出现在其他名字内部时不替换（如「林惊蛰」内不触发「惊蛰」）', () => {
    const db = openDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'draft')").run()
    // 主角「惊蛰」+ 其他角色「林惊蛰」（以主角名结尾 → 其前缀「林」成为保护前缀）
    db.prepare("INSERT INTO character (novel_id, name, profile_json, status) VALUES (1, '惊蛰', ?, 'pending')").run(
      JSON.stringify({ role: '主角' })
    )
    db.prepare("INSERT INTO character (novel_id, name, profile_json, status) VALUES (1, '林惊蛰', ?, 'pending')").run(
      JSON.stringify({ role: '配角' })
    )
    setConstraints(db, 1, [
      { id: 'c1', text: '主角必须叫 Jing', level: 'must', enabled: true, createdAt: 'x', keyword: 'Jing', replaceWith: 'Jing' }
    ])
    // 「林惊蛰」中的「惊蛰」受保护前缀「林」保护 → 不替换；独立「惊蛰」→ 替换
    const out = replaceProtagonistName(db, 1, '林惊蛰与惊蛰之战')
    expect(out).toBe('林惊蛰与Jing之战')
  })
})

describe(`${PREFIX} · ledger states 上限`, () => {
  it('writeCharacterStates 超 100 条截断最早状态', () => {
    const db = openDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'draft')").run()
    db.prepare(
      "INSERT INTO character (novel_id, name, profile_json, ledger_json, status) VALUES (1, '石昊', '{}', '{}', 'pending')"
    ).run()
    const states = Array.from({ length: 120 }, (_, i) => `状态${i + 1}`).map((s) => ({ name: '石昊', state: s }))
    writeCharacterStates(db, 1, states)
    const row = db.prepare('SELECT ledger_json FROM character WHERE novel_id = 1').get() as {
      ledger_json: string
    }
    const ledger = JSON.parse(row.ledger_json) as { states?: string[] }
    expect(ledger.states).toHaveLength(100)
    expect(ledger.states![0]).toBe('状态21')
    expect(ledger.states![99]).toBe('状态120')
  })
})

describe(`${PREFIX} · N1 记账 SQL 语义（generate 路径 UPDATE 含 ai_words 累加）`, () => {
  it('模拟 generate 落库语句：ai_words 累加而非覆盖', () => {
    const db = openDb()
    db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'draft')").run()
    db.prepare("INSERT INTO chapter (novel_id, title, status, ai_words) VALUES (1, '第一章', 'written', 100)").run()
    // 与 generate.ts 相同的 UPDATE 模式（ai_words = ai_words + ?）
    db.prepare(
      "UPDATE chapter SET content = ?, word_count = ?, status = 'written', ai_words = ai_words + ?, updated_at = datetime('now') WHERE id = ?"
    ).run('新内容', 50, 50, 1)
    const row = db.prepare('SELECT ai_words FROM chapter WHERE id = 1').get() as { ai_words: number }
    expect(row.ai_words).toBe(150)
  })
})
