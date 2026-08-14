// kb_doc 标题修复：去除字面 ???? 前缀（0x3F 有损替换，原始 5 字符不可恢复——D91 结论）
// 流程（D90 教训①）：备份 → 短事务 UPDATE → 复查；仅碰 kb_doc 表（无 key/provider 污染风险）
// 用法：node scripts/debug/fix-kb-titles.mjs
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const dbPath = join(homedir(), 'AppData', 'Roaming', 'ai-novel-studio', 'ai-novel-studio.db')
if (!existsSync(dbPath)) {
  console.error('未找到用户库：' + dbPath)
  process.exit(1)
}

const ts = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(process.env.TEMP ?? '/tmp', `fix-kb-titles-${ts}.db`)
copyFileSync(dbPath, backup)
console.log('备份：' + backup)

const db = new DatabaseSync(dbPath, { timeout: 15000 })

const rows = db.prepare("SELECT id, title FROM kb_doc WHERE title LIKE '?????%'").all()
console.log('待修复：' + rows.length + ' 行')
if (rows.length === 0) {
  console.log('无需修复（已干净）')
  db.close()
  process.exit(0)
}

db.exec('BEGIN')
try {
  for (const r of rows) {
    const fixed = String(r.title).replace(/^\?+/, '')
    db.prepare('UPDATE kb_doc SET title = ? WHERE id = ?').run(fixed, r.id)
    console.log(`  #${r.id}: ${JSON.stringify(String(r.title).slice(0, 40))} → ${JSON.stringify(fixed.slice(0, 40))}`)
  }
  db.exec('COMMIT')
  console.log('完成：' + rows.length + ' 行标题已修复（去 ? 前缀，保留可读语义）')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('失败已回滚：', err)
  process.exit(1)
}

const check = db.prepare("SELECT COUNT(*) AS c FROM kb_doc WHERE title LIKE '?????%'").get()
console.log('复查剩余 ? 前缀行：' + check.c)
db.close()
