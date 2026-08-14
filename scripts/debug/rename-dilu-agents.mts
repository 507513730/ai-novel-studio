// 方案「帝路十章」Agent 名称现代化 + 职责说明（用户要求：文言名看不懂）
// 安全：方案 steps 按 agentId 引用（不改）；prompt 走 body_md 不含 name（已查证）——改名零影响
// 流程：备份 → 短事务 UPDATE 10 行 → 复查
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
copyFileSync(dbPath, join(process.env.TEMP ?? '/tmp', `rename-agents-${ts}.db`))
console.log('备份：' + join(process.env.TEMP ?? '/tmp', `rename-agents-${ts}.db`))

const RENAMES = [
  { old: '定策阁主', name: '总策划', desc: '本章大纲：制定章节目标、结构与推进顺序' },
  { old: '命途执笔', name: '主线编剧', desc: '人物与设定起草：铺陈主线、塑造角色' },
  { old: '棋局推手', name: '节奏策划', desc: '冲突构建：设计矛盾与张力，推动剧情' },
  { old: '丹青妙笔', name: '场景描摹', desc: '场景描写：画面感与氛围营造' },
  { old: '声韵师', name: '对白编剧', desc: '对话编写：口语化、体现人物性格' },
  { old: '鼓点手', name: '爽点调度', desc: '节奏推进与补写：保持爽点密度与阅读节奏' },
  { old: '青史主编', name: '内容审校', desc: '主编审校：核对节奏与章节钩子' },
  { old: '红尘读者', name: '读者视角', desc: '读者视角审核：爽点与期待感' },
  { old: '因果司', name: '连续性检查', desc: '连续性审校：核对角色状态/伏笔/时间线，防剧情矛盾' },
  { old: '天命合卷', name: '终审合稿', desc: '统筹终稿：融合前九步产出为完整章节' }
]

const db = new DatabaseSync(dbPath, { timeout: 15000 })
db.exec('BEGIN')
try {
  for (const r of RENAMES) {
    const row = db.prepare('SELECT id, name FROM agent WHERE name = ?').get(r.old) as { id: number } | undefined
    if (!row) {
      console.log(`跳过（未找到）: ${r.old}`)
      continue
    }
    db.prepare('UPDATE agent SET name = ?, description = ? WHERE id = ?').run(r.name, r.desc, row.id)
    console.log(`  #${row.id}: ${r.old} → ${r.name}（${r.desc}）`)
  }
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('失败已回滚：', err)
  process.exit(1)
}
const check = db.prepare("SELECT COUNT(*) AS c FROM agent WHERE name IN ('总策划','主线编剧','节奏策划','场景描摹','对白编剧','爽点调度','内容审校','读者视角','连续性检查','终审合稿')").get()
console.log('复查新名行数：' + check.c + '/10')
db.close()
