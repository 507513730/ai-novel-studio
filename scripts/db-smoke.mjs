// node:sqlite 冒烟测试（零原生依赖核心验证）
// 用法: pnpm db:smoke
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { applyMigrations, getSchemaVersion, SCHEMA_VERSION } = await import('../server/src/db/migrate.ts')
const { seedIfEmpty } = await import('../server/src/db/seed.ts')

const dir = mkdtempSync(join(tmpdir(), 'ai-novel-db-smoke-'))
const dbPath = join(dir, 'smoke.db')

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message)
    process.exitCode = 1
  }
}

try {
  console.log('[db-smoke] DB:', dbPath)

  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true, timeout: 5000 })

  check('WAL 模式可开启', () => {
    db.exec('PRAGMA journal_mode = WAL')
    const mode = db.prepare('PRAGMA journal_mode').get()
    if (mode && mode.journal_mode !== 'wal') throw new Error(`mode=${mode?.journal_mode}`)
  })

  check(`迁移应用（schema version=${SCHEMA_VERSION}）`, () => {
    applyMigrations(db)
    const v = getSchemaVersion(db)
    if (v !== SCHEMA_VERSION) throw new Error(`schema version=${v}`)
  })

  check('seed 幂等（重复调用不重复插入）', () => {
    seedIfEmpty(db)
    const c1 = db.prepare('SELECT COUNT(*) AS c FROM provider').get().c
    seedIfEmpty(db)
    const c2 = db.prepare('SELECT COUNT(*) AS c FROM provider').get().c
    if (c1 !== c2) throw new Error(`provider count ${c1} -> ${c2}`)
    if (c1 < 1) throw new Error('no providers seeded')
  })

  check('23+ 表存在', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_migrations' ORDER BY name")
      .all()
      .map((r) => r.name)
    const required = [
      'novel', 'world', 'character', 'volume', 'beat', 'chapter', 'chapter_version',
      'foreshadow', 'fact', 'timeline_event', 'style_asset', 'genre_asset', 'book_analysis',
      'kb_doc', 'kb_chunk', 'prompt_asset', 'provider', 'model_route', 'quality_debt',
      'job', 'agent', 'agent_session', 'director_followup', 'usage_log'
    ]
    const missing = required.filter((t) => !tables.includes(t))
    if (missing.length > 0) throw new Error(`missing: ${missing.join(',')}`)
  })

  check('写读 + 事务回滚', () => {
    const db2 = new DatabaseSync(dbPath, { timeout: 5000 })
    const before = db2.prepare('SELECT COUNT(*) AS c FROM novel').get().c // seed 含 __global__ 占位行（id=0）
    db2.exec('BEGIN')
    db2.prepare('INSERT INTO novel (title, inspiration) VALUES (?, ?)').run('测试书', '一段灵感')
    db2.exec('ROLLBACK')
    const c = db2.prepare('SELECT COUNT(*) AS c FROM novel').get().c
    db2.close()
    if (c !== before) throw new Error(`rollback failed, novel count ${before} -> ${c}`)
  })

  check('外键约束生效', () => {
    const db3 = new DatabaseSync(dbPath, { timeout: 5000 })
    let threw = false
    try {
      db3.prepare('INSERT INTO world (novel_id) VALUES (?)').run(99999)
    } catch {
      threw = true
    }
    db3.close()
    if (!threw) throw new Error('FK not enforced')
  })

  check('并发连接 busy timeout 生效', () => {
    const w1 = new DatabaseSync(dbPath, { timeout: 2000 })
    const w2 = new DatabaseSync(dbPath, { timeout: 2000 })
    w1.exec('BEGIN IMMEDIATE')
    const t0 = Date.now()
    let threw = false
    try {
      w2.exec('BEGIN IMMEDIATE')
    } catch {
      threw = true
    }
    w1.exec('COMMIT')
    w1.close()
    w2.close()
    if (!threw) throw new Error('no busy error under lock')
  })

  db.close()
  rmSync(dir, { recursive: true, force: true })
  console.log(`\n[db-smoke] ${passed} checks passed`)
} catch (err) {
  console.error('[db-smoke] fatal:', err)
  rmSync(dir, { recursive: true, force: true })
  process.exit(1)
}
