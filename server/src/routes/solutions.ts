import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  listSolutions,
  loadSolution,
  saveSolution,
  createSolution,
  deleteSolution,
  exportSolutionBundle,
  importSolutionBundle,
  parseSolutionSteps,
  type SolutionStep
} from '../services/solutionAssets'
import { runSolutionById, summarizeRun } from '../services/solutionRunner'
import { parseAgentMd } from '../services/solutionAssets'

// ============================================================
// P21：创造工坊 API（方案/技能/智能体资产 + 试运行 + 导入导出）
// ============================================================

const stepSchema = z.object({
  agentId: z.number().int().positive(),
  role: z.string().min(1).max(60),
  stage: z.enum(['post_generate', 'review', 'whole_book']).default('post_generate'),
  include: z.array(z.string()).optional(),
  maxTokens: z.number().int().positive().max(8192).optional(),
  if: z
    .object({ field: z.string(), op: z.enum(['<', '>', '==']), value: z.number() })
    .nullable()
    .optional()
})

export function createSolutionsRouter(db: DatabaseSync): Router {
  const router = Router()

  // ---------- 方案 CRUD ----------
  router.get('/solutions', (_req, res) => {
    res.json({ solutions: listSolutions(db) })
  })

  router.post('/solutions', (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().min(1).max(100),
          description: z.string().max(2000).default(''),
          primaryAgentId: z.number().int().positive().nullable().optional(),
          steps: z.array(stepSchema).default([])
        })
        .parse(req.body ?? {})
      const id = createSolution(db, {
        name: input.name,
        description: input.description,
        primaryAgentId: input.primaryAgentId ?? null,
        steps: input.steps as SolutionStep[]
      })
      res.status(201).json({ id })
    } catch (err) {
      next(err)
    }
  })

  router.get('/solutions/:id', (req, res, next) => {
    try {
      const sol = loadSolution(db, Number(req.params.id))
      if (!sol) {
        res.status(404).json({ error: 'solution not found' })
        return
      }
      res.json({ solution: sol })
    } catch (err) {
      next(err)
    }
  })

  router.patch('/solutions/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z
        .object({
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(2000).optional(),
          primaryAgentId: z.number().int().positive().nullable().optional(),
          steps: z.array(stepSchema).optional(),
          enabled: z.number().int().min(0).max(1).optional(),
          note: z.string().max(200).optional()
        })
        .parse(req.body ?? {})
      saveSolution(db, id, {
        name: input.name,
        description: input.description,
        primaryAgentId: input.primaryAgentId,
        steps: input.steps as SolutionStep[] | undefined,
        enabled: input.enabled,
        note: input.note
      })
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/solutions/:id', (req, res, next) => {
    try {
      deleteSolution(db, Number(req.params.id))
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 方案版本历史（P21-5b） ----------
  router.get('/solutions/:id/versions', (req, res, next) => {
    try {
      const rows = db
        .prepare(
          'SELECT id, steps_json, note, created_at FROM solution_version WHERE solution_id = ? ORDER BY id DESC LIMIT 20'
        )
        .all(Number(req.params.id)) as Array<{ id: number; steps_json: string; note: string; created_at: string }>
      res.json({
        versions: rows.map((r) => ({
          id: r.id,
          note: r.note,
          createdAt: r.created_at,
          steps: parseSolutionSteps(r.steps_json)
        }))
      })
    } catch (err) {
      next(err)
    }
  })

  // ---------- P21-5h：AI 生成方案骨架（描述 → 步骤建议） ----------
  router.post('/solutions/generate', async (req, res, next) => {
    try {
      const input = z
        .object({
          description: z.string().min(4).max(1000),
          genre: z.string().max(50).optional()
        })
        .parse(req.body ?? {})
      // 可用智能体清单（提示模型选）
      const agents = db
        .prepare('SELECT id, name, role, description FROM agent WHERE enabled = 1 ORDER BY id')
        .all() as Array<{ id: number; name: string; role: string; description: string }>
      const { callLlmJson } = await import('../services/jsonSafe')
      const result = await callLlmJson<{
        name: string
        description: string
        steps: Array<{ agentId: number; role: string; stage: 'post_generate' | 'review'; maxTokens?: number }>
      }>(
        db,
        'extraction',
        {
          novelId: null as unknown as number,
          messages: [
            {
              role: 'user',
              content: `你是创作流程架构师。根据用户描述，从可用智能体中选择并编排一套「创作方案」（agent 流水线）。\n可用智能体：\n${agents
                .map((a) => `- ${a.id}: ${a.name}（${a.role}）${a.description ? `：${a.description}` : ''}`)
                .join('\n')}\n\n用户需求：${input.description}${input.genre ? `\n流派：${input.genre}` : ''}\n\n规则：\n1. 3-8 步，顺序有意义（前一步输出供后一步参考）\n2. stage 用 post_generate（正文后增强）或 review（审核类）\n3. 每步给 role（该步职责，简短）与 maxTokens（512-4096）\n4. 方案名简短（≤30 字），描述 ≤200 字\n\n输出 JSON：{"name": "...", "description": "...", "steps": [{"agentId": 数字, "role": "...", "stage": "post_generate|review", "maxTokens": 数字}]}`
            }
          ],
          maxTokens: 4096
        },
        (obj) => {
          const r = obj as Record<string, unknown>
          if (typeof r.name !== 'string' || !Array.isArray(r.steps) || r.steps.length === 0) return null
          const steps = r.steps
            .map((s) => {
              const x = s as Record<string, unknown>
              if (typeof x.agentId !== 'number' || typeof x.role !== 'string') return null
              return {
                agentId: x.agentId,
                role: String(x.role).slice(0, 60),
                stage: (x.stage === 'review' ? 'review' : 'post_generate') as 'post_generate' | 'review',
                maxTokens: typeof x.maxTokens === 'number' ? Math.min(8192, Math.max(256, x.maxTokens)) : undefined
              }
            })
            .filter((s): s is NonNullable<typeof s> => s !== null)
          if (steps.length === 0) return null
          // 校验 agentId 存在
          const validIds = new Set(agents.map((a) => a.id))
          if (!steps.every((s) => validIds.has(s.agentId))) return null
          return { name: String(r.name).slice(0, 30), description: String(r.description ?? '').slice(0, 200), steps }
        },
        'solution-generate'
      )
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  // ---------- 试运行（chapter 级） ----------
  router.post('/solutions/:id/run', async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z
        .object({
          novelId: z.number().int().positive(),
          chapterId: z.number().int().positive(),
          humanOverride: z.record(z.string(), z.union([z.string(), z.number()])).optional()
        })
        .parse(req.body ?? {})
      const run = await runSolutionById(db, id, input.novelId, input.chapterId, {
        humanOverride: input.humanOverride
          ? Object.fromEntries(Object.entries(input.humanOverride).map(([k, v]) => [Number(k), String(v)]))
          : undefined
      })
      res.json({ run, summary: summarizeRun(run) })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 导出/导入（P21-4） ----------
  router.get('/solutions/:id/export', (req, res, next) => {
    try {
      const bundle = exportSolutionBundle(db, Number(req.params.id))
      const sol = loadSolution(db, Number(req.params.id))
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent((sol?.name ?? 'solution').replace(/[\\/:*?"<>|]/g, '_'))}.solution.json`
      )
      res.send(bundle)
    } catch (err) {
      next(err)
    }
  })

  router.post('/solutions/import', (req, res, next) => {
    try {
      const input = z.object({ bundle: z.string().min(10) }).parse(req.body ?? {})
      const result = importSolutionBundle(db, input.bundle)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  })

  // ---------- Feelfish 格式导入（agent md + solution.json） ----------
  router.post('/solutions/import-feelfish', (req, res, next) => {
    try {
      const input = z
        .object({
          agents: z.array(z.string()).default([]), // 每个元素为 agent md 文本
          solution: z
            .object({
              name: z.string(),
              description: z.string().default(''),
              agents: z.array(z.object({ id: z.string() })).default([]),
              primaryAgentId: z.string().nullable().optional()
            })
            .optional(),
          primaryAgentId: z.string().nullable().optional()
        })
        .parse(req.body ?? {})
      const agentIdByName = new Map<string, number>()
      for (const md of input.agents) {
        const parsed = parseAgentMd(md)
        const name = parsed.frontmatter.name ?? `agent-${Date.now()}-${agentIdByName.size}`
        const existing = db.prepare('SELECT id FROM agent WHERE name = ? LIMIT 1').get(name) as
          | { id: number }
          | undefined
        if (existing) {
          agentIdByName.set(name, existing.id)
          continue
        }
        const rid = db
          .prepare(
            "INSERT INTO agent (name, role, system_prompt, description, body_md, skills_json, tools_json, enabled, is_custom) VALUES (?, ?, ?, ?, ?, ?, '[]', 1, 1)"
          )
          .run(
            name,
            'custom',
            parsed.body.slice(0, 4000),
            parsed.frontmatter.description ?? '',
            parsed.body,
            JSON.stringify(parsed.frontmatter.skills ?? [])
          )
        agentIdByName.set(name, Number(rid.lastInsertRowid))
      }
      // 方案（若提供）：按 agents 顺序生成步骤
      const sol = input.solution
      const primary = sol?.primaryAgentId ?? input.primaryAgentId
      const steps: SolutionStep[] = (sol?.agents ?? []).map((a, i) => {
        const agentId = agentIdByName.get(a.id)
        if (!agentId) throw new Error(`方案引用未知智能体：${a.id}`)
        return { agentId, role: `步骤 ${i + 1}`, stage: 'post_generate', if: null }
      })
      if (steps.length === 0) {
        res.status(400).json({ error: '方案为空（无步骤或智能体未匹配）' })
        return
      }
      const primaryId = primary && agentIdByName.get(primary) ? agentIdByName.get(primary)! : null
      const id = createSolution(db, {
        name: sol?.name ?? '导入方案',
        description: sol?.description ?? '从外部导入',
        primaryAgentId: primaryId,
        steps
      })
      res.status(201).json({ id, name: sol?.name ?? '导入方案', agentCount: agentIdByName.size })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 技能 CRUD ----------
  router.get('/skills', (_req, res) => {
    const rows = db.prepare('SELECT * FROM skill ORDER BY id DESC').all() as Array<Record<string, unknown>>
    res.json({
      skills: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        body_md: r.body_md,
        novelId: r.novel_id,
        createdAt: r.created_at
      }))
    })
  })

  router.post('/skills', (req, res, next) => {
    try {
      const input = z
        .object({ name: z.string().min(1).max(80), description: z.string().max(500).default(''), body_md: z.string().max(8000).default('') })
        .parse(req.body ?? {})
      const existing = db.prepare('SELECT id FROM skill WHERE name = ?').get(input.name) as { id: number } | undefined
      if (existing) {
        res.status(409).json({ error: '技能已存在' })
        return
      }
      const rid = db
        .prepare('INSERT INTO skill (name, description, body_md, novel_id) VALUES (?, ?, ?, 0)')
        .run(input.name, input.description, input.body_md)
      res.status(201).json({ id: Number(rid.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/skills/:id', (req, res, next) => {
    try {
      db.prepare('DELETE FROM skill WHERE id = ?').run(Number(req.params.id))
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 智能体资产（P21-1：自定义 agent 创建） ----------
  router.post('/agents/custom', (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().min(1).max(60),
          description: z.string().max(500).default(''),
          body_md: z.string().max(12000).default(''),
          skills: z.array(z.string()).default([])
        })
        .parse(req.body ?? {})
      const existing = db.prepare('SELECT id FROM agent WHERE name = ?').get(input.name) as { id: number } | undefined
      if (existing) {
        res.status(409).json({ error: '智能体已存在' })
        return
      }
      const rid = db
        .prepare(
          "INSERT INTO agent (name, role, system_prompt, description, body_md, skills_json, tools_json, enabled, is_custom) VALUES (?, 'custom', '', ?, ?, ?, '[]', 1, 1)"
        )
        .run(input.name, input.description, input.body_md, JSON.stringify(input.skills))
      res.status(201).json({ id: Number(rid.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 试运行：列出可选章节（供工坊下拉） ----------
  router.get('/run-targets/:novelId', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const rows = db
        .prepare(
          "SELECT id, title, status FROM chapter WHERE novel_id = ? AND content != '' ORDER BY id DESC LIMIT 10"
        )
        .all(novelId) as Array<{ id: number; title: string; status: string }>
      res.json({ chapters: rows })
    } catch (err) {
      next(err)
    }
  })

  return router
}
