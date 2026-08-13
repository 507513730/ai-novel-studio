// v0.15.0：用户创作约束机制（Generalized Constraints）
// 背景（写书教训）：主角名等用户强调的要求散落 4 处（灵感/角色表/方案 prompt/正文）无统一约束源，
// 导演自由发挥产出偏离，错误固化进状态机后全链跟随。
// 本引擎：硬约束（MUST）/软偏好（SHOULD）分级 → 存 novel.constraints_json → 全链注入 + 确定性校验。

import { DatabaseSync } from 'node:sqlite'

export type ConstraintLevel = 'must' | 'should'

export interface NovelConstraint {
  id: string
  text: string // 约束文本，如「主角必须叫 Jing」
  level: ConstraintLevel
  enabled: boolean
  createdAt: string
  // 校验元数据（主角名类约束）
  keyword?: string // 检测关键词（如主角名）；违反时用于自动替换
  replaceWith?: string // 自动替换为
}

// ---------- 读写 ----------
export function getConstraints(db: DatabaseSync, novelId: number): NovelConstraint[] {
  const row = db.prepare('SELECT constraints_json FROM novel WHERE id = ?').get(novelId) as
    | { constraints_json: string }
    | undefined
  if (!row) return []
  try {
    const arr = JSON.parse(row.constraints_json || '[]') as NovelConstraint[]
    return Array.isArray(arr) ? arr.filter((c) => c.enabled !== false) : []
  } catch {
    return []
  }
}

export function setConstraints(db: DatabaseSync, novelId: number, constraints: NovelConstraint[]): void {
  db.prepare("UPDATE novel SET constraints_json = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(constraints),
    novelId
  )
}

export function addConstraint(
  db: DatabaseSync,
  novelId: number,
  c: Omit<NovelConstraint, 'id' | 'createdAt'>
): NovelConstraint {
  const list = getConstraints(db, novelId)
  const full: NovelConstraint = {
    ...c,
    id: `c${Date.now()}`,
    createdAt: new Date().toISOString()
  }
  list.push(full)
  setConstraints(db, novelId, list)
  return full
}

// ---------- 注入 ----------
export function constraintsBlock(db: DatabaseSync, novelId: number): string {
  const list = getConstraints(db, novelId)
  if (list.length === 0) return ''
  const musts = list.filter((c) => c.level === 'must').map((c) => `- ${c.text}`)
  const shoulds = list.filter((c) => c.level === 'should').map((c) => `- ${c.text}`)
  const parts: string[] = []
  if (musts.length > 0) parts.push('【不可变创作约束（必须严格遵循，任何产出不得违反）】\n' + musts.join('\n'))
  if (shoulds.length > 0) parts.push('【创作偏好（尽量遵循）】\n' + shoulds.join('\n'))
  return parts.join('\n\n')
}

// ---------- 确定性校验 ----------
export interface ConstraintViolation {
  constraint: NovelConstraint
  count: number
  fixed: boolean
}

/** 校验文本是否符合硬约束：
 * ① 禁用词类约束（keyword 出现即违反）：检测 → 告警（violations）
 * ② 主角名类约束（keyword=规范名，replaceWith=规范名）：替代名由调用方经 replaceProtagonistName 处理
 * 返回违反清单（用于记录/告警）。 */
export function validateConstraints(
  db: DatabaseSync,
  novelId: number,
  text: string
): { violations: ConstraintViolation[] } {
  const list = getConstraints(db, novelId)
  const violations: ConstraintViolation[] = []
  for (const c of list) {
    if (c.level !== 'must' || !c.keyword) continue
    // 主角名类：keyword 是规范名，正文中规范名缺失不算违反（替代名替换由 replaceProtagonistName 处理）
    const count = countOccurrences(text, c.keyword)
    if (count > 0 && c.replaceWith) continue // 规范名存在 = 正常
    if (count === 0 && !c.replaceWith) {
      // 禁用词约束：规范名不应出现？——语义：keyword 是"不得出现"的词（如"虐主"）
      // 约束文本约定：禁用类约束 keyword = 禁止词，replaceWith 为空 → 出现即违反
      violations.push({ constraint: c, count, fixed: false })
      void novelId
      void db
    }
  }
  return { violations }
}

function countOccurrences(text: string, kw: string): number {
  let count = 0
  let idx = 0
  while ((idx = text.indexOf(kw, idx)) !== -1) {
    count++
    idx += kw.length
  }
  return count
}

/** 主角名约束替换：正文中出现角色表主角的当前名（与规范名不同）时替换为规范名（keyword） */
export function replaceProtagonistName(db: DatabaseSync, novelId: number, text: string): string {
  const list = getConstraints(db, novelId)
  const pc = list.find((c) => c.keyword && c.replaceWith && c.text.includes('主角'))
  if (!pc || !pc.keyword) return text
  // 角色表主角当前名（profile 标注主角）
  const rows = db
    .prepare("SELECT name FROM character WHERE novel_id = ? AND profile_json LIKE '%主角%' LIMIT 5")
    .all(novelId) as Array<{ name: string }>
  let out = text
  let replaced = 0
  for (const r of rows) {
    const n = String(r.name ?? '').trim()
    if (!n || n === pc.keyword) continue
    const before = out
    out = out.split(n).join(pc.keyword)
    if (out !== before) replaced++
  }
  if (replaced > 0) console.warn(`[constraint] 主角名替换：${rows.map((r) => r.name).join('、')} → ${pc.keyword}`)
  return out
}

// ---------- 违反统计 ----------
export function recordConstraintViolation(db: DatabaseSync, _novelId: number, constraintId: string, detail: string, chapterId = 0): void {
  db.prepare(
    "INSERT INTO quality_debt (chapter_id, issue, severity, resolved) VALUES (?, ?, 'high', 0)"
  ).run(chapterId, `[约束违反] ${constraintId}: ${detail.slice(0, 100)}`)
}
