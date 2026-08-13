// 书 25 修正：设置创作约束（主角 Jing/双雄/系统克制/版权边界）+ 角色表主角名 → Jing + 已产出正文替换
// 用法：node scripts/debug/fix-book25-constraints.mjs
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { applyMigrations } from '../../server/src/db/migrate.ts'

const dbPath = join(homedir(), 'AppData', 'Roaming', 'ai-novel-studio', 'ai-novel-studio.db')
if (!existsSync(dbPath)) {
  console.error('未找到用户库：' + dbPath)
  process.exit(1)
}

const ts = new Date().toISOString().replace(/[:.]/g, '-')
copyFileSync(dbPath, join(process.env.TEMP ?? '/tmp', `fix-book25-${ts}.db`))
console.log('备份：' + join(process.env.TEMP ?? '/tmp', `fix-book25-${ts}.db`))

const db = new DatabaseSync(dbPath, { timeout: 15000 })
// 用户应用是旧构建——先补跑迁移（v16 constraints_json 列）
applyMigrations(db)

const NOVEL_ID = 25
const row = db.prepare('SELECT title, constraints_json FROM novel WHERE id = ?').get(NOVEL_ID)
if (!row) {
  console.error('书 25 不存在')
  process.exit(1)
}
console.log('书：' + row.title)

// 1) 创作约束（4 条硬约束；主角条带规范名 Jing）
const constraints = [
  {
    id: 'c-protagonist-jing',
    text: '主角必须叫 Jing（音译"惊"，与石昊同代的双骄之一），任何产出不得使用其他名字',
    level: 'must',
    enabled: true,
    createdAt: new Date().toISOString(),
    keyword: 'Jing',
    replaceWith: 'Jing'
  },
  {
    id: 'c-dual-heroes',
    text: '与石昊同代并肩的双雄叙事：Jing 比石昊更早突破、更果决，两人彼此欣赏、相互成就，共同抗争黑暗动乱',
    level: 'must',
    enabled: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'c-system-restraint',
    text: '系统金手指保持克制：不作无脑碾压，奖励与代价对等，服务于人物成长而非万能外挂',
    level: 'must',
    enabled: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'c-copyright',
    text: '同人作品：尊重完美世界世界观边界，不篡改原著主线结局，不引入原著未有的越界设定',
    level: 'must',
    enabled: true,
    createdAt: new Date().toISOString()
  }
]
db.prepare('UPDATE novel SET constraints_json = ? WHERE id = ?').run(JSON.stringify(constraints), NOVEL_ID)
console.log('[1/4] constraints_json 已设置（4 条硬约束）')

// 2) 角色表主角名 → Jing
const protos = db
  .prepare("SELECT id, name FROM character WHERE novel_id = ? AND profile_json LIKE '%主角%'")
  .all(NOVEL_ID)
for (const p of protos) {
  if (p.name !== 'Jing') {
    db.prepare("UPDATE character SET name = 'Jing' WHERE id = ?").run(p.id)
    console.log(`[2/4] 角色 #${p.id} 主角名：${p.name} → Jing`)
  }
}
if (protos.length === 0) console.warn('[2/4] 未找到角色表主角（profile 无"主角"标注）')

// 3) 已产出正文替换（林惊蛰/林尘 → Jing）
const aliases = ['林惊蛰', '林尘']
const written = db
  .prepare("SELECT id, title, content FROM chapter WHERE novel_id = ? AND content IS NOT NULL AND content != ''")
  .all(NOVEL_ID)
let replacedChapters = 0
let replacedHits = 0
for (const ch of written) {
  let out = ch.content
  let hits = 0
  for (const a of aliases) {
    const n = out.split(a).length - 1
    if (n > 0) {
      out = out.split(a).join('Jing')
      hits += n
    }
  }
  if (hits > 0) {
    db.prepare("UPDATE chapter SET content = ?, word_count = ?, updated_at = datetime('now') WHERE id = ?").run(
      out,
      (out.match(/[\u4e00-\u9fff]/g) ?? []).length,
      ch.id
    )
    replacedChapters++
    replacedHits += hits
    console.log(`[3/4] 章节 #${ch.id}《${ch.title}》替换 ${hits} 处`)
  }
}
console.log(`[3/4] 共替换 ${replacedChapters} 章 / ${replacedHits} 处（已产出 ${written.length} 章）`)

// 4) 简报/世界观等 JSON 文本里的旧名一并替换
for (const tbl of ['framing_json', 'setting_brief_json']) {
  void tbl
}
const framing = db.prepare('SELECT framing_json FROM novel WHERE id = ?').get(NOVEL_ID)
if (framing) {
  let f = framing.framing_json
  let hits = 0
  for (const a of aliases) {
    const n = f.split(a).length - 1
    if (n > 0) {
      f = f.split(a).join('Jing')
      hits += n
    }
  }
  if (hits > 0) {
    db.prepare('UPDATE novel SET framing_json = ? WHERE id = ?').run(f, NOVEL_ID)
    console.log(`[4/4] framing_json 替换 ${hits} 处`)
  }
}
const world = db.prepare('SELECT manual_json FROM world WHERE novel_id = ?').get(NOVEL_ID)
if (world) {
  let w = world.manual_json
  let hits = 0
  for (const a of aliases) {
    const n = w.split(a).length - 1
    if (n > 0) {
      w = w.split(a).join('Jing')
      hits += n
    }
  }
  if (hits > 0) {
    db.prepare('UPDATE world SET manual_json = ? WHERE novel_id = ?').run(w, NOVEL_ID)
    console.log(`[4/4] world manual_json 替换 ${hits} 处`)
  }
}
console.log('[4/4] 完成——后续章节生成将自动对齐主角名 Jing（硬约束生效）')
