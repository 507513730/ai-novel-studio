// 「帝路十章」写书修复：清空书 25 的镜渊产出 + 灵感重写（UTF-8 文件传递，避免 PowerShell 管道编码坑）
import { DatabaseSync } from 'node:sqlite'

const DB = 'C:/Users/Lenovo/AppData/Roaming/ai-novel-studio/ai-novel-studio.db'
const db = new DatabaseSync(DB, { timeout: 5000 })

const NOVEL_ID = 25

// 1) 清空该书关联产出（保留 novel 行/方案绑定/全局知识库）
const tables = [
  ['DELETE FROM chapter_version WHERE chapter_id IN (SELECT id FROM chapter WHERE novel_id = ?)', NOVEL_ID],
  ['DELETE FROM chapter WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM character WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM beat WHERE volume_id IN (SELECT id FROM volume WHERE novel_id = ?)', NOVEL_ID],
  ['DELETE FROM volume WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM world WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM foreshadow WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM fact WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM quality_debt WHERE chapter_id IN (SELECT id FROM chapter WHERE novel_id = ?)', NOVEL_ID],
  ['DELETE FROM timeline_event WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM book_analysis WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM kb_doc WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM usage_log WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM director_followup WHERE novel_id = ?', NOVEL_ID],
  ['DELETE FROM job WHERE json_extract(payload_json, \'$.novelId\') = ?', NOVEL_ID]
]
for (const [sql, p] of tables) db.prepare(sql).run(p)

// 2) 保留：novel 行（title/灵感/简报/方案绑定）——只重置方向与状态（导演重跑会重建）
db.prepare('UPDATE novel SET status = ?, direction_json = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
  'draft',
  '[]',
  NOVEL_ID
)

const novel = db.prepare('SELECT id, title, inspiration, framing_json FROM novel WHERE id = ?').get(NOVEL_ID)
const framing = JSON.parse(novel.framing_json || '{}')
console.log('✓ 清空完成（保留设定简报）:')
console.log('  title:', novel.title)
console.log('  inspiration:', novel.inspiration.slice(0, 36) + '…')
console.log('  settingBrief 保留:', Boolean(framing.settingBrief))
console.log('  章节数:', db.prepare('SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ?').get(NOVEL_ID).c)
db.close()
