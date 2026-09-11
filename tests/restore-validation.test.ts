import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyMigrations, SCHEMA_VERSION } from '../server/src/db/migrate'
import { validateRestoreDatabase } from '../server/src/services/restoreValidation'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture(): { source: string; output: string } {
  const directory = mkdtempSync(join(tmpdir(), 'novel-restore-validation-'))
  directories.push(directory)
  return { source: join(directory, 'staged.db'), output: join(directory, 'validated.db') }
}

function applicationDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  return db
}

describe('恢复暂存副本校验（无模型）', () => {
  it.each(['', 'not a sqlite database'])('拒绝空文件及文本伪装库：%j', (content) => {
    const { source, output } = fixture()
    writeFileSync(source, content, 'utf8')
    expect(() => validateRestoreDatabase(source, output)).toThrow()
    expect(existsSync(output)).toBe(false)
  })

  it('拒绝其他 SQLite 应用数据库，不生成输出', () => {
    const { source, output } = fixture()
    const db = new DatabaseSync(source)
    db.exec('CREATE TABLE unrelated(id INTEGER PRIMARY KEY)')
    db.close()
    expect(() => validateRestoreDatabase(source, output)).toThrow('应用数据表')
    expect(existsSync(output)).toBe(false)
  })

  it.each(['core', 'current', 'view'])('拒绝缺少字段或视图伪装表：%s', (kind) => {
    const { source, output } = fixture()
    const db = applicationDb(source)
    if (kind === 'core') db.exec('ALTER TABLE chapter DROP COLUMN content')
    if (kind === 'current') db.exec('ALTER TABLE chapter DROP COLUMN generation_token')
    if (kind === 'view') db.exec('ALTER TABLE chapter RENAME TO chapter_hidden; CREATE VIEW chapter AS SELECT * FROM chapter_hidden')
    db.close()
    expect(() => validateRestoreDatabase(source, output)).toThrow(/应用字段|应用数据表/)
    expect(existsSync(output)).toBe(false)
  })

  it.each(['future', 'invalid', 'duplicate'])('拒绝未来或不合法迁移台账：%s', (kind) => {
    const { source, output } = fixture()
    const db = applicationDb(source)
    db.exec('DROP TABLE _migrations; CREATE TABLE _migrations(version)')
    if (kind === 'future') db.prepare('INSERT INTO _migrations VALUES (?)').run(SCHEMA_VERSION + 1)
    if (kind === 'invalid') db.prepare('INSERT INTO _migrations VALUES (?)').run('1')
    if (kind === 'duplicate') db.exec('INSERT INTO _migrations VALUES (1),(1)')
    db.close()
    expect(() => validateRestoreDatabase(source, output)).toThrow(/版本/)
    expect(existsSync(output)).toBe(false)
  })

  it.each(['current', 'legacy', 'older'])('接受空应用库并完成所需迁移：%s', (kind) => {
    const { source, output } = fixture()
    const db = applicationDb(source)
    if (kind === 'legacy') db.exec('DROP TABLE _migrations')
    if (kind === 'older') {
      db.exec('ALTER TABLE kb_doc DROP COLUMN keywords')
      db.prepare('DELETE FROM _migrations WHERE version = ?').run(SCHEMA_VERSION)
    }
    db.close()
    validateRestoreDatabase(source, output)
    const restored = new DatabaseSync(output, { readOnly: true, timeout: 5000 })
    try {
      expect(restored.prepare('SELECT MAX(version) AS version FROM _migrations').get()?.version).toBe(SCHEMA_VERSION)
      expect(restored.prepare('SELECT count(*) AS n FROM novel WHERE id > 0').get()?.n).toBe(0)
      expect(restored.prepare('SELECT count(*) AS n FROM provider').get()?.n).toBe(1)
      expect(restored.prepare('SELECT count(*) AS n FROM usage_log').get()?.n).toBe(0)
      expect(Object.values(restored.prepare('PRAGMA integrity_check').get()!)).toEqual(['ok'])
    } finally { restored.close() }
    expect(existsSync(output + '-wal')).toBe(false)
  })

  it('快照包含暂存库 WAL 中已经提交的记录，保持任务未执行', () => {
    const { source, output } = fixture()
    const db = applicationDb(source)
    try {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0')
      db.prepare('INSERT INTO novel (title) VALUES (?)').run('已提交哨兵')
      db.prepare("INSERT INTO job (type,status,payload_json) VALUES ('production','running','{\"novelId\":1}')").run()
      validateRestoreDatabase(source, output)
      const restored = new DatabaseSync(output, { readOnly: true, timeout: 5000 })
      try {
        expect(restored.prepare('SELECT title FROM novel WHERE id > 0').get()?.title).toBe('已提交哨兵')
        expect(restored.prepare('SELECT status FROM job').get()?.status).toBe('running')
        expect(restored.prepare('SELECT count(*) AS n FROM usage_log').get()?.n).toBe(0)
      } finally { restored.close() }
    } finally { db.close() }
  })

  it('拒绝覆盖已经存在的输出', () => {
    const { source, output } = fixture()
    applicationDb(source).close()
    writeFileSync(output, 'keep', 'utf8')
    expect(() => validateRestoreDatabase(source, output)).toThrow('已存在')
  })
})
