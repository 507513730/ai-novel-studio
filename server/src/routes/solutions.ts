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
import { enqueueProductionJob, enqueueTypedJob } from '../services/jobQueue'
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
    .optional(),
  // v0.8.0（审查 #2）：production 字段纳入校验——此前 zod 剥离未知键导致
  // UI 创建/编辑 whole_book 方案时 production 静默丢失，流水线退化为 draft 拼接
  production: z
    .object({
      output: z.enum(['outline', 'draft', 'dialogue', 'scene', 'review', 'final']),
      reviewRounds: z.number().int().min(1).max(3).optional()
    })
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
      // v0.17.0（LOW）：存在性检查（此前不存在恒返 ok:true）
      const sol = db.prepare('SELECT id FROM solution WHERE id = ?').get(Number(req.params.id))
      if (!sol) {
        res.status(404).json({ error: 'solution not found' })
        return
      }
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

  // ---------- P30：章节生产模式（方案 whole_book 步骤接力生成正文） ----------
  // v0.23.1（批次 D1/#8/#23）：迁 job 队列——此前在 HTTP 请求内直跑多步 LLM 流水线
  // （每步最高 8192 token：长连接挂死风险 + 无取消感知）；现入队返回 jobId，前端轮询
  router.post('/solutions/:id/produce-chapter', (req, res) => {
    const id = Number(req.params.id)
    const parsed = z
      .object({
        novelId: z.number().int().positive(),
        chapterId: z.number().int().positive()
      })
      .safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request body' })
      return
    }
    // 快速存在性校验（执行时 runProductionChapter 仍会完整校验）
    const sol = db.prepare('SELECT id FROM solution WHERE id = ?').get(id) as { id: number } | undefined
    if (!sol) {
      res.status(404).json({ error: 'solution not found' })
      return
    }
    const enq = enqueueTypedJob(db, 'solution-chapter', {
      novelId: parsed.data.novelId,
      chapterId: parsed.data.chapterId,
      solutionId: id
    })
    if ('conflict' in enq) {
      // 同书已有方案生产任务排队/执行中（章节级并发由 runProductionChapter 原子抢占兜底）
      res.status(409).json({ error: '该书已有方案生产任务在队列中/执行中' })
      return
    }
    res.status(202).json({ jobId: enq.jobId })
  })

  // ---------- v0.24.2（F4）：方案一键整本生产 ----------
  // 校验方案可用 + 含整本模式步骤 → 绑定到书（current_solution_id）→ 入队 production job
  // （幂等/取消/进度复用整本生产管道——book 绑定是 production.ts 选流水线模式的开关）
  router.post('/solutions/:id/produce-book', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z.object({ novelId: z.number().int().positive() }).parse(req.body ?? {})
      const solution = loadSolution(db, id)
      if (!solution) {
        res.status(404).json({ error: 'solution not found' })
        return
      }
      if (!solution.enabled) {
        res.status(400).json({ error: `方案「${solution.name}」已停用，请先启用` })
        return
      }
      if (!solution.steps.some((s) => s.stage === 'whole_book')) {
        res.status(400).json({ error: '方案不包含整本模式（whole_book）生产步骤——请添加后使用整本生产' })
        return
      }
      const pending = db
        .prepare("SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND content = ''")
        .get(input.novelId) as { c: number }
      if (Number(pending.c) === 0) {
        res.status(400).json({ error: '该书没有待生成的章节' })
        return
      }
      // 绑定方案（production 管道按 current_solution_id 决定是否走流水线；覆盖式绑定即用户意图）
      db.prepare('UPDATE novel SET current_solution_id = ? WHERE id = ?').run(id, input.novelId)
      const queued = enqueueProductionJob(db, input.novelId)
      if ('conflict' in queued) {
        res.status(409).json({ error: '该书已有整本生产任务在运行中' })
        return
      }
      res.status(201).json({ jobId: queued.jobId, pending: Number(pending.c) })
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

  // ---------- 导出/导入（P21-4）+ v0.11.0 方案包（solution-pack） ----------
  router.get('/solutions/:id/export', (req, res, next) => {
    try {
      // ?sampleNovelId= 附带所选书样例快照（市场包用）
      const sampleNovelId = req.query.sampleNovelId ? Number(req.query.sampleNovelId) : undefined
      const bundle = exportSolutionBundle(db, Number(req.params.id), {
        ...(sampleNovelId && Number.isInteger(sampleNovelId) && sampleNovelId > 0 ? { sample: { novelId: sampleNovelId } } : {})
      })
      const sol = loadSolution(db, Number(req.params.id))
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent((sol?.name ?? 'solution').replace(/[\\/:*?"<>|]/g, '_'))}.solution-pack.json`
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
          // P30 修正：agents 支持 {filename, content}（Feelfish 引用 key = 文件名 id，如 mc-xxx）
          // v0.9.0（审查 #20）：content 限长 100KB——此前无上限，MB 级内容直塞 DB
          agents: z
            .array(
              z.union([
                z.string().max(100_000),
                z.object({ filename: z.string().max(200), content: z.string().max(100_000) })
              ])
            )
            .max(200)
            .default([]),
          solution: z
            .object({
              name: z.string().max(100),
              description: z.string().default(''),
              agents: z.array(z.object({ id: z.string().max(200) })).max(200).default([]),
              primaryAgentId: z.string().nullable().optional()
            })
            .optional(),
          primaryAgentId: z.string().nullable().optional()
        })
        .parse(req.body ?? {})
      const agentIdByKey = new Map<string, number>()
      for (const entry of input.agents) {
        const md = typeof entry === 'string' ? entry : entry.content
        const key =
          typeof entry === 'string'
            ? (parseAgentMd(md).frontmatter.name ?? `agent-${Date.now()}-${agentIdByKey.size}`)
            : entry.filename.replace(/\.md$/i, '')
        const parsed = parseAgentMd(md)
        const name = parsed.frontmatter.name ?? key
        const existing = db.prepare('SELECT id FROM agent WHERE name = ? LIMIT 1').get(name) as
          | { id: number }
          | undefined
        let id: number
        if (existing) {
          id = existing.id
        } else {
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
          id = Number(rid.lastInsertRowid)
        }
        // 文件名 key 与中文名都映射（方案可能用任一引用）
        // v0.9.0（审查 #20）：key 与中文名撞车时——后写覆盖会把方案引用映射到错误 agent，
        // 改"首次写入优先"（先来者胜），并告警提示冲突
        const conflict = agentIdByKey.has(key) && agentIdByKey.get(key) !== id
        if (!agentIdByKey.has(key)) agentIdByKey.set(key, id)
        if (!agentIdByKey.has(name)) agentIdByKey.set(name, id)
        if (conflict || (key !== name && agentIdByKey.get(name) !== undefined && agentIdByKey.get(name) !== id)) {
          console.warn(`[import-feelfish] 引用键冲突（key=${key}, name=${name}）——按先出现者映射`)
        }
      }
      // 方案（若提供）：按 agents 顺序生成步骤
      const sol = input.solution
      const primary = sol?.primaryAgentId ?? input.primaryAgentId
      const steps: SolutionStep[] = (sol?.agents ?? []).map((a, i) => {
        const agentId = agentIdByKey.get(a.id)
        if (!agentId) throw new Error(`方案引用未知智能体：${a.id}`)
        return { agentId, role: `步骤 ${i + 1}`, stage: 'post_generate', if: null }
      })
      if (steps.length === 0) {
        res.status(400).json({ error: '方案为空（无步骤或智能体未匹配）' })
        return
      }
      const primaryId = primary && agentIdByKey.get(primary) ? agentIdByKey.get(primary)! : null
      const id = createSolution(db, {
        name: sol?.name ?? '导入方案',
        description: sol?.description ?? '从外部导入',
        primaryAgentId: primaryId,
        steps
      })
      res.status(201).json({ id, name: sol?.name ?? '导入方案', agentCount: agentIdByKey.size })
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
        // v0.17.0（审查 M6）：统一 camelCase（此前 body_md 与邻字段不一致）
        bodyMd: r.body_md,
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
