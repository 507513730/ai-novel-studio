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

      // 主编约束（team lead）
      const editor = db.prepare("SELECT system_prompt FROM agent WHERE role = 'editor' AND enabled = 1 LIMIT 1").get() as
        | { system_prompt: string }
        | undefined
      const editorConstraint = editor
        ? await callLlmJson<{ constraint: string }>(
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
          )
        : null

      // 审校三岗并行
      const agents = ['plot', 'logic', 'style'] as const
      const results = await Promise.all(
        agents.map((focus) => {
          const reviewer = db
            .prepare("SELECT system_prompt FROM agent WHERE role = 'reviewer' AND enabled = 1 LIMIT 1")
            .get() as { system_prompt: string } | undefined
          return callLlmJson<{ score: number; issues: Array<{ severity: string; location: string; problem: string; suggestion: string }> }>(
            db,
            'extraction',
            {
              novelId,
              messages: [
                {
                  role: 'user',
                  content: `${reviewer?.system_prompt ?? '你是审校编辑。'}\n本次审核维度：${REVIEW_FOCUS[focus]}\n\n${frozen.contract}\n${frozen.characters ? `\n【角色账本】\n${frozen.characters}` : ''}\n章节：${chapter.title}\n任务单：${chapter.goal_json}\n\n【正文】\n${chapter.content.slice(0, 6000)}\n\n输出 JSON：{"score": 0-100, "issues": [{"severity":"high|medium|low","location":"..","problem":"..","suggestion":".."}]}`
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
          )
        })
      )

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

      // 角色顾问 OOC 检测
      const charAdvisor = db
        .prepare("SELECT system_prompt FROM agent WHERE role = 'character_advisor' AND enabled = 1 LIMIT 1")
        .get() as { system_prompt: string } | undefined
      const ooc = charAdvisor
        ? await callLlmJson<{ issues: Array<{ severity: string; location: string; problem: string; suggestion: string }> }>(
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
          )
        : { issues: [] as Array<{ severity: string; location: string; problem: string; suggestion: string }> }

      // 反 AI 词检测（文风顾问辅助）
      const bound = getBoundStyleRules(db, novelId)
      const antiAiWords = bound ? extractAntiAiWords(bound.antiAiRules) : []
      const antiAiHits = detectAntiAiHits(chapter.content, antiAiWords)

      // 汇总评分（取三岗均值）
      const avgScore = Math.round(results.reduce((a, r) => a + r.score, 0) / 3)
      const highCount = mergedIssues.filter((i) => i.severity === 'high').length + ooc.issues.filter((i) => i.severity === 'high').length

      res.json({
        review: {
          score: avgScore,
          editorConstraint: editorConstraint?.constraint ?? null,
          dimensions: agents.map((a, i) => ({ focus: a, score: results[i].score })),
          issues: mergedIssues,
          oocIssues: ooc.issues,
          antiAiHits,
          highCount
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
