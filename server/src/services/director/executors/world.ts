// 导演阶段执行器：world（世界观骨架 = 设定手册 + 势力 + 地图，world 行单一产物）
import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from '../../jsonSafe'
import { injectGuidance } from '../../settingBrief'
import { generateWorldManualPrompt, generateWorldFactionsPrompt, generateWorldMapPrompt } from '../../planner'
import { loadNovel, type StageContext } from './shared'

export async function runWorldStage(db: DatabaseSync, novelId: number, _ctx: StageContext): Promise<void> {
  const novel = loadNovel(db, novelId)
  // 写书修复：world 行可能不存在（新书/清理后）——UPDATE 会 0 行丢内容，先确保行存在
  db.prepare(
    "INSERT OR IGNORE INTO world (novel_id, manual_json, factions_json, map_json) VALUES (?, '{}', '[]', '{}')"
  ).run(novelId)
  const base = `书名设定：${novel.framing_json}\n灵感：${novel.inspiration}`
  const manual = await callLlmJson<Record<string, string>>(
    db,
    'extraction',
    {
      novelId,
      messages: [{ role: 'user', content: injectGuidance(db, novelId, generateWorldManualPrompt(base)) }],
      maxTokens: 2048
    },
    (obj) => {
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const rec = obj as Record<string, unknown>
        return Object.keys(rec).length >= 2 ? (rec as Record<string, string>) : null
      }
      return null
    },
    'director-world-manual'
  )
  const factions = await callLlmJson<Array<{ name: string; desc: string; stance: string }>>(
    db,
    'extraction',
    {
      novelId,
      messages: [{ role: 'user', content: injectGuidance(db, novelId, generateWorldFactionsPrompt(base, manual)) }],
      maxTokens: 2048
    },
    (obj) => {
      const arr = (obj as { factions?: unknown }).factions
      if (!Array.isArray(arr) || arr.length === 0) return null
      return arr.map((f) => {
        const r = f as Record<string, unknown>
        return { name: String(r.name ?? ''), desc: String(r.desc ?? ''), stance: String(r.stance ?? '') }
      })
    },
    'director-world-factions'
  )
  const map = await callLlmJson<Record<string, string>>(
    db,
    'extraction',
    {
      novelId,
      messages: [{ role: 'user', content: injectGuidance(db, novelId, generateWorldMapPrompt(base)) }],
      maxTokens: 2048
    },
    (obj) => (obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, string>) : null),
    'director-world-map'
  )
  db.prepare(
    "UPDATE world SET manual_json = ?, factions_json = ?, map_json = ?, updated_at = datetime('now') WHERE novel_id = ?"
  ).run(JSON.stringify(manual), JSON.stringify(factions), JSON.stringify(map), novelId)
}
