// 上下文域冻结前缀区（重构计划 R6.1 / PLAN §3.3）：
// [冻结前缀区] 系统提示 → 书级合约(framing) → 世界观手册 → 角色账本 → 外部资料 → 引导 → 写作要求
// hash 版本化：任一组成变化即缓存失效；顺序受 context-contract 测试锁定，禁止调整。
import type { DatabaseSync } from 'node:sqlite'
import { getGuidance, getWritingSettings, buildWritingRules } from '../guidance'
import { hashOf } from './hash'
import type { FrozenContext } from './types'

function getNovel(db: DatabaseSync, novelId: number): {
  title: string
  framing_json: string
} | null {
  return db.prepare('SELECT title, framing_json FROM novel WHERE id = ?').get(novelId) as never
}

function getWorld(db: DatabaseSync, novelId: number): string {
  const row = db
    .prepare('SELECT manual_json, factions_json, map_json, timeline_json FROM world WHERE novel_id = ?')
    .get(novelId) as
    | { manual_json: string; factions_json: string; map_json: string; timeline_json: string }
    | undefined
  if (!row) return ''
  const parts: string[] = []
  const manual = JSON.parse(row.manual_json || '{}') as Record<string, unknown>
  if (Object.keys(manual).length > 0) {
    parts.push('【世界观手册】')
    for (const [k, v] of Object.entries(manual)) {
      parts.push(`- ${k}：${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
  }
  const factions = JSON.parse(row.factions_json || '[]') as Array<{ name: string; desc: string; currentState?: string }>
  if (factions.length > 0) {
    parts.push('【势力】')
    for (const f of factions) {
      // v0.13.0（批E/I4）：势力状态行（回灌更新，世界状态机势力维度）
      parts.push(`- ${f.name}：${f.desc}${f.currentState ? `（当前：${f.currentState}）` : ''}`)
    }
  }
  // v0.9.0（审查 D）：map/timeline 此前查了但从不注入（map_json/timeline_json 设定永远不进上下文）
  const map = JSON.parse(row.map_json || '{}') as Record<string, unknown>
  if (Object.keys(map).length > 0) {
    parts.push('【地图】')
    for (const [k, v] of Object.entries(map)) {
      parts.push(`- ${k}：${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
  }
  const timeline = JSON.parse(row.timeline_json || '{}') as Record<string, unknown>
  if (Object.keys(timeline).length > 0) {
    parts.push('【时间线】')
    for (const [k, v] of Object.entries(timeline)) {
      parts.push(`- ${k}：${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
  }
  return parts.join('\n')
}

function getCharacters(db: DatabaseSync, novelId: number, limit = 12): string {
  const rows = db
    .prepare(
      `SELECT name, profile_json, status, ledger_json FROM character
       WHERE novel_id = ? ORDER BY CASE status WHEN 'roster' THEN 0 ELSE 1 END, id LIMIT ?`
    )
    .all(novelId, limit) as Array<{
    name: string
    profile_json: string
    status: string
    ledger_json: string
  }>
  const lines: string[] = []
  for (const r of rows) {
    const p = JSON.parse(r.profile_json || '{}') as {
      identity?: string
      personality?: string
      goal?: string
    }
    const ledger = JSON.parse(r.ledger_json || '{}') as { states?: string[] }
    const meta = [p.identity, p.personality, p.goal].filter(Boolean).join('；')
    let line = `- ${r.name}${r.status === 'pending' ? '（待确认）' : ''}：${meta}`
    // 回灌闭环：角色当前状态（已确认入账）注入上下文，保持跨章连续性
    if (ledger.states && ledger.states.length > 0) {
      line += `\n  当前状态：${ledger.states.join('；')}`
    }
    lines.push(line)
  }
  return lines.join('\n')
}

/**
 * P4 外部资料直塞注入（替代 RAG 的低成本方案）：
 * kb_doc 中 status='direct' 的文档注入冻结前缀区（复用缓存机制）
 */
function getExternalMaterials(db: DatabaseSync, novelId: number, maxChars = 6000): string {
  const rows = db
    .prepare(
      "SELECT title, content FROM kb_doc WHERE novel_id IN (0, ?) AND status = 'direct' ORDER BY id LIMIT 5"
    )
    .all(novelId) as Array<{ title: string; content: string }>
  if (rows.length === 0) return ''
  const parts: string[] = []
  let total = 0
  for (const r of rows) {
    if (total >= maxChars) break
    const chunk = `【参考资料·${r.title}】\n${r.content.slice(0, Math.min(2000, maxChars - total))}`
    parts.push(chunk)
    total += chunk.length
  }
  return parts.join('\n\n')
}

export function buildFrozenContext(db: DatabaseSync, novelId: number): FrozenContext {
  const novel = getNovel(db, novelId)
  const contract = novel ? `【书级合约】\n${novel.framing_json}` : ''
  const world = getWorld(db, novelId)
  const characters = getCharacters(db, novelId)
  // P4：外部资料直塞（status='direct'）注入冻结区
  const external = getExternalMaterials(db, novelId)
  // P19 ①：书级创作引导（冻结区——改引导=hash 变化=缓存失效，语义正确）
  const guidance = getGuidance(db, novelId)
  // P19 ②⑤：写作偏好规则（语言/格式/模式；非默认才注入；改设置=hash 变=缓存失效）
  const writingRules = buildWritingRules(getWritingSettings(db))
  return {
    contract,
    world,
    characters,
    external,
    guidance,
    writingRules,
    hash: hashOf(contract + '\n' + world + '\n' + characters + '\n' + external + '\n' + guidance + '\n' + writingRules)
  }
}
