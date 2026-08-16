// v0.10.0（批B/I2）：质量债自动修复闭环
// 业界模式：evaluator-optimizer（Anthropic Building Effective Agents 查证，D81）
// 停止条件（官方建议"maximum number of iterations"）：
//   ① 每章最多 2 轮修复（fix_history 上限，P12 C1 既有）
//   ② 同签名问题防重复烧 LLM（P12 C1 既有）
//   ③ 修复后重审 score≥75 达标即止（P1.5 既有）
// 本服务把 chapters.ts 的 /fix 路由核心抽为可复用函数（路由与 job 共用）

import { DatabaseSync } from 'node:sqlite'
import { buildChapterReviewContext, buildFixContext } from './context'
import { callLlmJson } from './jsonSafe'

const PASS_SCORE = 75
const MAX_FIX_ROUNDS = 2

export interface FixRoundResult {
  fixed: boolean
  round: number
  content: string
  score: number
  passed: boolean
  reason?: string
}

/** 单章修复一轮（含上限/签名防重/重审/债务 resolve）；返回 round 信息 */
export async function fixChapterOnce(
  db: DatabaseSync,
  novelId: number,
  chapterId: number
): Promise<FixRoundResult> {
  const chapter = db
    .prepare('SELECT content, review_json, fix_history_json FROM chapter WHERE id = ? AND novel_id = ?')
    .get(chapterId, novelId) as
    | { content: string; review_json: string; fix_history_json: string }
    | undefined
  if (!chapter) return { fixed: false, round: 0, content: '', score: 0, passed: false, reason: 'chapter not found' }
  if (!chapter.content.trim()) return { fixed: false, round: 0, content: '', score: 0, passed: false, reason: 'empty chapter' }

  const review = JSON.parse(chapter.review_json || '{}') as {
    issues?: Array<{ severity: string; problem: string; suggestion: string }>
  }
  const fixHistory = JSON.parse(chapter.fix_history_json || '[]') as Array<{ round: number; issues: number; signature?: string }>
  const issues = review.issues ?? []

  // ① 轮数上限 → 登记质量债（不再自动重写）
  if (fixHistory.length >= MAX_FIX_ROUNDS) {
    const sig = issues.slice(0, 3).map((i) => String(i.problem ?? '').slice(0, 30)).join('|')
    db.prepare("INSERT INTO quality_debt (chapter_id, issue, severity, resolved) VALUES (?, ?, 'high', 0)").run(
      chapterId,
      `修复 ${MAX_FIX_ROUNDS} 轮未达标，建议人工修改或重规划。${sig ? `签名：${sig}` : ''}`
    )
    return { fixed: false, round: fixHistory.length, content: chapter.content, score: 0, passed: false, reason: 'rounds exceeded' }
  }
  // ② 同签名防重复烧 LLM
  const sig = issues.slice(0, 3).map((i) => String(i.problem ?? '').slice(0, 30)).join('|')
  if (sig && fixHistory.length > 0 && fixHistory[fixHistory.length - 1]?.signature === sig) {
    db.prepare("INSERT INTO quality_debt (chapter_id, issue, severity, resolved) VALUES (?, ?, 'high', 0)").run(
      chapterId,
      `同类问题修复后仍存在（签名：${sig}），登记质量债，建议人工修改或窗口重规划`
    )
    return { fixed: false, round: fixHistory.length, content: chapter.content, score: 0, passed: false, reason: 'same signature' }
  }
  // ③ LLM 修复
  const messages = buildFixContext(db, novelId, chapterId, chapter.content, issues)
  const fixed = await callLlmJson<{ content: string }>(
    db,
    'extraction',
    {
      novelId,
      messages,
      maxTokens: 8192
    },
    (obj) => {
      const r = obj as Record<string, unknown>
      if (typeof r.content === 'string' && r.content.length > 100) return { content: r.content }
      return null
    },
    'fix'
  )
  fixHistory.push({ round: fixHistory.length + 1, issues: issues.length, signature: sig })
  // v0.22.0（审查 N1·本地设计决策）：修复重写整章→覆盖语义（防多轮修复膨胀；见 generate.ts 注释）
  const fixedWordCount = (fixed.content.match(/[\u4e00-\u9fff]/g) ?? []).length
  db.prepare(
    "UPDATE chapter SET content = ?, fix_history_json = ?, word_count = ?, ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ?"
  ).run(fixed.content, JSON.stringify(fixHistory), fixedWordCount, fixedWordCount, chapterId)

  // ④ 重审闭环：score≥75 或达轮数上限停止
  const reviewMessages = buildChapterReviewContext(db, novelId, chapterId, fixed.content)
  const rescore = await callLlmJson<{
    score: number
    strengths: string[]
    issues: Array<{ severity: string; location: string; problem: string; suggestion: string }>
    needsFix: boolean
  }>(
    db,
    'extraction',
    {
      novelId,
      messages: reviewMessages,
      maxTokens: 4096
    },
    (obj) => {
      const r = obj as Record<string, unknown>
      if (typeof r.score !== 'number') return null
      return {
        score: Number(r.score),
        strengths: Array.isArray(r.strengths) ? (r.strengths as string[]) : [],
        issues: Array.isArray(r.issues)
          ? (r.issues as Array<{ severity: string; location: string; problem: string; suggestion: string }>)
          : [],
        needsFix: Boolean(r.needsFix)
      }
    },
    'review'
  )
  db.prepare("UPDATE chapter SET review_json = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(rescore),
    chapterId
  )
  const passed = rescore.score >= PASS_SCORE
  // ⑤ 达标 → 该章未解决债务 resolved（质量债可消费闭环）
  if (passed) {
    // v0.23.1（批次 B7/e2e R4 发现）：quality_debt 表无 updated_at 列（仅 created_at）——
    // 此前带 updated_at 的 UPDATE 必抛 no such column → 修复链路 500（v0.10.0 引入，
    // 历史轮 rescore 未达标而绕过未暴露）
    db.prepare('UPDATE quality_debt SET resolved = 1 WHERE chapter_id = ? AND resolved = 0').run(chapterId)
  }
  return { fixed: true, round: fixHistory.length, content: fixed.content, score: rescore.score, passed }
}

/** 整本书质量债自动修复（job 处理入口）：未解决债务章节 → 逐章修复（每章内部自限轮次） */
export async function fixAllDebts(
  db: DatabaseSync,
  novelId: number,
  onProgress: (done: number, total: number, current: string, action: string) => void
): Promise<{ fixed: number; skipped: number; failed: number }> {
  const debts = db
    .prepare(
      `SELECT DISTINCT q.chapter_id, c.title FROM quality_debt q
       JOIN chapter c ON c.id = q.chapter_id
       WHERE q.resolved = 0 AND c.novel_id = ? ORDER BY q.chapter_id`
    )
    .all(novelId) as Array<{ chapter_id: number; title: string }>
  const total = debts.length
  let done = 0
  let fixed = 0
  let failed = 0
  for (const d of debts) {
    onProgress(done, total, d.title || `第 ${d.chapter_id} 章`, '自动修复')
    try {
      const r = await fixChapterOnce(db, novelId, d.chapter_id)
      if (r.passed) fixed += 1
      else failed += 1
    } catch (err) {
      console.warn(`[debt-fix] 第 ${d.chapter_id} 章修复失败: ${err instanceof Error ? err.message : String(err)}`)
      failed += 1
    }
    done += 1
  }
  return { fixed, skipped: total - fixed - failed, failed }
}
