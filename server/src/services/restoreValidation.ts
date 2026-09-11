import { existsSync, lstatSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations, SCHEMA_VERSION } from '../db/migrate'
import { seedIfEmpty } from '../db/seed'

const CORE_COLUMNS: Record<string, string[]> = {
  novel: ['id', 'title', 'inspiration'],
  chapter: ['id', 'novel_id', 'content', 'goal_json', 'review_json'],
  provider: ['id', 'name', 'base_url', 'api_key_encrypted'],
  model_route: ['task_type', 'provider_id', 'model'],
  job: ['id', 'type', 'status', 'payload_json']
}

function tableColumns(db: DatabaseSync, name: string): Set<string> {
  const object = db.prepare('SELECT type FROM sqlite_schema WHERE name = ?').get(name)
  if (object?.type !== 'table') throw new Error(`备份缺少应用数据表：${name}`)
  const rows = db.prepare('SELECT name FROM pragma_table_info(?)').all(name)
  return new Set(rows.map((row) => String(row.name)))
}

function requireColumns(db: DatabaseSync, table: string, expected: Iterable<string>): void {
  const columns = tableColumns(db, table)
  for (const column of expected) {
    if (!columns.has(column)) throw new Error(`备份缺少应用字段：${table}.${column}`)
  }
}

function checkIntegrity(db: DatabaseSync): void {
  const results = db.prepare('PRAGMA integrity_check').all()
  if (results.length !== 1 || Object.values(results[0])[0] !== 'ok') {
    throw new Error('备份数据库完整性检查失败')
  }
}

function checkMigrationVersions(db: DatabaseSync): void {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name = '_migrations'").get()) return
  requireColumns(db, '_migrations', ['version'])
  const rows = db.prepare('SELECT version FROM _migrations').all()
  const seen = new Set<number>()
  for (const row of rows) {
    const version = row.version
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || seen.has(version)) {
      throw new Error('备份数据库迁移版本无效')
    }
    if (version > SCHEMA_VERSION) throw new Error('备份来自更新的数据库版本，请先升级应用')
    seen.add(version)
  }
}

/** 仅用于恢复流程拥有的暂存副本；迁移副本并输出独立快照，不启动服务或任务。 */
export function validateRestoreDatabase(sourceFile: string, outputFile: string): void {
  const source = lstatSync(sourceFile)
  if (!source.isFile() || source.isSymbolicLink() || source.size === 0) throw new Error('备份数据库文件无效')
  if (existsSync(outputFile)) throw new Error('恢复校验输出文件已存在')
  const db = new DatabaseSync(sourceFile, { enableForeignKeyConstraints: true, timeout: 5000 })
  try {
    checkIntegrity(db)
    for (const [table, columns] of Object.entries(CORE_COLUMNS)) requireColumns(db, table, columns)
    checkMigrationVersions(db)
    applyMigrations(db)
    seedIfEmpty(db)
    const reference = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
    try {
      applyMigrations(reference)
      const tables = reference.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
      for (const table of tables) {
        const name = String(table.name)
        requireColumns(db, name, tableColumns(reference, name))
      }
    } finally {
      reference.close()
    }
    checkIntegrity(db)
    db.prepare('VACUUM INTO ?').run(outputFile)
  } finally {
    db.close()
  }
}
