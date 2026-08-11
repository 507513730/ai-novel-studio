import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { callLlmJson } from '../services/jsonSafe'
import { buildFrozenContext } from '../services/context'
import { detectAntiAiHits, getBoundStyleRules } from '../services/styleEngine'

// ============================================================
// P5 多智能体：Agent 管理 + 团队协作端点
// ============================================================

export function createAgentAdminRouter(db: DatabaseSync): Router {
  const router = Router()

  // ---------- Agent CRUD ----------
  router.get('/', (_req, res) => {
    const rows = db
      .prepare('SELECT id, name, role, system_prompt, tools_json, enabled FROM agent ORDER BY id')
      .all() as Array<Record<string, unknown>>
    res.json({
      agents: rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        systemPrompt: r.system_prompt,
        tools: JSON.parse(String(r.tools_json ?? '[]')),
        enabled: r.enabled === 1
      }))
    })
  })

  router.post('/', (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().min(1),
          role: z.string().optional().default('custom'),
          systemPrompt: z.string().min(10),
          tools: z.array(z.string()).default([])
        })
        .parse(req.body)
      const result = db
        .prepare('INSERT INTO agent (name, role, system_prompt, tools_json, enabled) VALUES (?, ?, ?, ?, 1)')
        .run(input.name, input.role, input.systemPrompt, JSON.stringify(input.tools))
      res.status(201).json({ id: Number(result.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z
        .object({
          name: z.string().min(1).optional(),
          role: z.string().optional(),
          systemPrompt: z.string().min(10).optional(),
          enabled: z.boolean().optional()
        })
        .parse(req.body)
      const sets: string[] = []
      const params: Array<string | number> = []
      if (input.name !== undefined) {
        sets.push('name = ?')
        params.push(input.name)
      }
      if (input.role !== undefined) {
        sets.push('role = ?')
        params.push(input.role)
      }
      if (input.systemPrompt !== undefined) {
        sets.push('system_prompt = ?')
        params.push(input.systemPrompt)
      }
      if (input.enabled !== undefined) {
        sets.push('enabled = ?')
        params.push(input.enabled ? 1 : 0)
      }
      if (sets.length === 0) {
        res.json({ ok: true })
        return
      }
      db.prepare(`UPDATE agent SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}

export function createAgentsRouter(db: DatabaseSync): Router {
  const router = Router()

  // P20（M4）：LLM 调用超时包装（超时降级而非挂死端点）
  async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  // ---------- P5-3 审校拆三岗（剧情/逻辑/文风） ----------
  const REVIEW_FOCUS: Record<string, string> = {
    plot: '剧情审核：聚焦本章剧情推进是否合理、钩子是否有力、爽点是否到位、与前文衔接是否顺畅。',
    logic: '逻辑审核：聚焦时间线、事实一致性、伏笔系统、设定矛盾、行为逻辑漏洞。',
    style: '文风审核：聚焦句式节奏、对话质量、反 AI 腔词（仿佛/眼底闪过/缓缓等）、写法一致性。'
  }

  router.post('/:novelId/team/review', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z.object({ chapterId: z.number().int().positive() }).parse(req.body)
      const chapter = db
        .prepare('SELECT title, content, goal_json FROM chapter WHERE id = ? AND novel_id = ?')
        .get(input.chapterId, novelId) as { title: string; content: string; goal_json: string } | undefined
      if (!chapter || !chapter.content) {
        res.status(400).json({ error: '章节无正文' })
        return
      }
      const frozen = buildFrozenContext(db, novelId)

      // 主编约束（team lead）——P20（M4）：产出注入三岗 prompt（不再丢弃）
      const editor = db.prepare("SELECT system_prompt FROM agent WHERE role = 'editor' AND enabled = 1 LIMIT 1").get() as
        | { system_prompt: string }
        | undefined
      let editorConstraint: string | null = null
      if (editor) {
        try {
          const r = await withTimeout(
            callLlmJson<{ constraint: string }>(
              db,
              'extraction',
              {
                novelId,
                messages: [
                  {
                    role: 'user',
                    content: `${editor.system_prompt}\n${JSON_FORMAT}\n\n${frozen.contract}\n章节：${chapter.title}\n任务单：${chapter.goal_json}\n\n输出 JSON：{"constraint": "本章创作约束（60-120字）"}`
                  }
                ],
                maxTokens: 512
              },
              (obj) => {
                const c = (obj as { constraint?: unknown }).constraint
                return typeof c === 'string' && c.trim().length >= 10 ? { constraint: c.trim() } : null
              },
              'team-editor'
            ),
            45_000
          )
          editorConstraint = r.constraint
        } catch (err) {
          console.warn('[team/review] 主编约束降级:', err instanceof Error ? err.message : String(err))
        }
      }

      // 审校三岗并行（P20：60s 整体超时，部分失败降级不毁整端）
      const agents = ['plot', 'logic', 'style'] as const
      const reviewer = db
        .prepare("SELECT system_prompt FROM agent WHERE role = 'reviewer' AND enabled = 1 LIMIT 1")
        .get() as { system_prompt: string } | undefined
      const editorLine = editorConstraint ? `\n主编约束：${editorConstraint}` : ''
      const settled = await Promise.allSettled(
        agents.map((focus) =>
          withTimeout(
            callLlmJson<{ score: number; issues: Array<{ severity: string; location: string; problem: string; suggestion: string }> }>(
              db,
              'extraction',
              {
                novelId,
                messages: [
                  {
                    role: 'user',
                    content: `${reviewer?.system_prompt ?? '你是审校编辑。'}\n本次审核维度：${REVIEW_FOCUS[focus]}${editorLine}\n\n${frozen.contract}\n${frozen.characters ? `\n【角色账本】\n${frozen.characters}` : ''}\n章节：${chapter.title}\n任务单：${chapter.goal_json}\n\n【正文】\n${chapter.content.slice(0, 6000)}\n\n输出 JSON：{"score": 0-100, "issues": [{"severity":"high|medium|low","location":"..","problem":"..","suggestion":".."}]}`
                  }
                ],
                maxTokens: 4096
              },
              (obj) => {
                const r = obj as Record<string, unknown>
                if (typeof r.score !== 'number') return null
                return {
                  score: r.score,
                  issues: Array.isArray(r.issues)
                    ? r.issues.map((i) => {
                        const x = i as Record<string, unknown>
                        return {
                          severity: String(x.severity ?? 'medium'),
                          location: String(x.location ?? ''),
                          problem: String(x.problem ?? ''),
                          suggestion: String(x.suggestion ?? '')
                        }
                      })
                    : []
                }
              },
              `team-${focus}`
            ),
            60_000
          )
        )
      )
      // 失败维度降级为空结果（不毁整端）——统一类型：全带 degraded/focus
      const results = settled.map((s, i) =>
        s.status === 'fulfilled'
          ? { ...s.value, degraded: false as boolean, focus: agents[i] as string }
          : { score: 0, issues: [] as Array<{ severity: string; location: string; problem: string; suggestion: string }>, degraded: true as boolean, focus: agents[i] as string }
      )
      const degradedFoci = results.filter((r) => r.degraded).map((r) => r.focus)
      if (degradedFoci.length > 0) {
        console.warn(`[team/review] 降级维度: ${degradedFoci.join(',')}`)
      }

      // 合并去重（location+problem 签名）
      const seen = new Set<string>()
      const mergedIssues: Array<{ focus: string; severity: string; location: string; problem: string; suggestion: string }> = []
      for (let i = 0; i < agents.length; i++) {
        for (const issue of results[i].issues) {
          const sig = `${issue.location}:${issue.problem}`.slice(0, 60)
          if (!seen.has(sig)) {
            seen.add(sig)
            mergedIssues.push({ focus: agents[i], ...issue })
          }
        }
      }

      // 角色顾问 OOC 检测（P20：45s 超时，失败降级为空）
      const charAdvisor = db
        .prepare("SELECT system_prompt FROM agent WHERE role = 'character_advisor' AND enabled = 1 LIMIT 1")
        .get() as { system_prompt: string } | undefined
      let ooc: { issues: Array<{ severity: string; location: string; problem: string; suggestion: string }> } = { issues: [] }
      if (charAdvisor) {
        try {
          ooc = await withTimeout(
            callLlmJson<{ issues: Array<{ severity: string; location: string; problem: string; suggestion: string }> }>(
              db,
              'extraction',
              {
                novelId,
                messages: [
                  {
                    role: 'user',
                    content: `${charAdvisor.system_prompt}\n\n${frozen.characters ? `【角色账本】\n${frozen.characters}` : ''}\n\n【正文】\n${chapter.content.slice(0, 6000)}\n\n输出 JSON：{"issues": [{"severity":"high|medium|low","location":"..","problem":"..","suggestion":".."}]}（无 OOC 输出空数组）`
                  }
                ],
                maxTokens: 4096
              },
              (obj) => {
                const r = obj as Record<string, unknown>
                return {
                  issues: Array.isArray(r.issues)
                    ? r.issues.map((i) => {
                        const x = i as Record<string, unknown>
                        return {
                          severity: String(x.severity ?? 'medium'),
                          location: String(x.location ?? ''),
                          problem: String(x.problem ?? ''),
                          suggestion: String(x.suggestion ?? '')
                        }
                      })
                    : []
                }
              },
              'team-ooc'
            ),
            45_000
          )
        } catch (err) {
          console.warn('[team/review] OOC 检测降级:', err instanceof Error ? err.message : String(err))
        }
      }

      // 反 AI 词检测（文风顾问辅助）
      const bound = getBoundStyleRules(db, novelId)
      const antiAiWords = bound ? extractAntiAiWords(bound.antiAiRules) : []
      const antiAiHits = detectAntiAiHits(chapter.content, antiAiWords)

      // 汇总评分（成功维度均值；全失败时 0 并标记）
      const active = results.filter((r) => !r.degraded)
      const avgScore = active.length > 0 ? Math.round(active.reduce((a, r) => a + r.score, 0) / active.length) : 0
      const highCount = mergedIssues.filter((i) => i.severity === 'high').length + ooc.issues.filter((i) => i.severity === 'high').length

      // P20（M4）：评审结果落库（chapter.review_json 合并，下游修复/重审可消费）
      const persistedReview = {
        score: avgScore,
        needsFix: avgScore < 75,
        strengths: [],
        issues: [...mergedIssues, ...ooc.issues],
        team: {
          editorConstraint,
          dimensions: agents.map((a, i) => ({ focus: a, score: results[i].score, degraded: results[i].degraded })),
          antiAiHits,
          highCount,
          degradedFoci
        }
      }
      db.prepare(
        "UPDATE chapter SET review_json = ?, status = 'reviewed', updated_at = datetime('now') WHERE id = ?"
      ).run(JSON.stringify(persistedReview), input.chapterId)
      // 质量债（INSERT OR IGNORE 防重复）
      const insertDebt = db.prepare(
        `INSERT OR IGNORE INTO quality_debt (chapter_id, issue, severity)
         SELECT ?, ?, ? WHERE NOT EXISTS (
           SELECT 1 FROM quality_debt WHERE chapter_id = ? AND issue = ? AND resolved = 0
         )`
      )
      for (const issue of persistedReview.issues) {
        if (issue.severity === 'high' || issue.severity === 'medium') {
          const sig = `${issue.location} ${issue.problem}`
          insertDebt.run(input.chapterId, sig, issue.severity, input.chapterId, sig)
        }
      }

      res.json({
        review: {
          score: avgScore,
          editorConstraint,
          dimensions: agents.map((a, i) => ({ focus: a, score: results[i].score, degraded: results[i].degraded })),
          issues: mergedIssues,
          oocIssues: ooc.issues,
          antiAiHits,
          highCount,
          degradedFoci
        }
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}

function extractAntiAiWords(rules: string[]): string[] {
  const words: string[] = []
  for (const rule of rules) {
    const m = rule.match(/严禁出现以下词汇\/句式：(.+)/)
    if (m) {
      for (const w of m[1].split(/[、，,]/)) words.push(w.trim())
    }
  }
  return words.filter(Boolean)
}

const JSON_FORMAT = '只输出 JSON，不要任何解释文字或 markdown 代码块标记。'
