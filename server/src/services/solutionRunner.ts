import type { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'
import { loadSolution, type SolutionStep } from './solutionAssets'
import { buildChapterWriteContext } from './context'
import { chapterPositionBlock } from './chapterRole'
import { constraintsBlock, replaceProtagonistName } from './constraintEngine'
import { JSON_FORMAT } from '../prompts'

// ============================================================
// P21-3：方案运行时（solution runner）
// 按 steps 顺序执行 agent 流水线（stage 驱动）：
//   post_generate：正文生成后增强（每步产出独立 JSON，输出聚合）
//   review：审核类步骤（产出 issues，并入审核结果）
//   whole_book：整本模式（P21 预留接口，未实现时明确报错）
// ============================================================

export interface StepOutput {
  stepIndex: number
  role: string
  stage: string
  output: string
  ok: boolean
  error?: string
  ms: number
}

export interface RunResult {
  solutionId: number
  solutionName: string
  outputs: StepOutput[]
  degraded: boolean
  degradedReasons: string[]
}

export interface RunSolutionOptions {
  signal?: AbortSignal
  // 单步调试（P21-5a）：外部提供上一步的人工改写
  humanOverride?: Record<number, string>
}

// 每步超时（LLM 调用层面用 Promise.race 兜底，防挂死）
const STEP_TIMEOUT_MS = 90_000

// v0.9.0（审查 #11）：withTimeout 支持工厂形式——超时即 abort 底层 LLM 请求，
// 此前只放弃等待、底层请求继续跑至 120s 客户端超时（zombie 请求 + 重试并发重复调用）
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T>
function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T>
function withTimeout<T>(
  pOrRun: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  ms: number
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const p = typeof pOrRun === 'function' ? pOrRun(controller.signal) : pOrRun
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`step timeout after ${ms}ms`))
      }, ms)
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function buildStepPrompt(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  step: SolutionStep,
  prevOutputs: string[]
): string {
  const agent = db.prepare('SELECT * FROM agent WHERE id = ?').get(step.agentId) as
    | { name: string; role: string; system_prompt: string; description: string; body_md: string; skills_json: string }
    | undefined
  if (!agent) throw new Error(`step ${step.role} 引用不存在的智能体 #${step.agentId}`)

  // 技能挂载（agent_skill + skills_json 合并，body 拼入；P29 C 显示技能名）
  const skillIds = new Set<string>((JSON.parse(agent.skills_json || '[]') as string[]) ?? [])
  const linked = db
    .prepare(
      `SELECT s.name, s.body_md FROM agent_skill a JOIN skill s ON s.id = a.skill_id WHERE a.agent_id = ?`
    )
    .all(step.agentId) as Array<{ name: string; body_md: string }>
  for (const l of linked) skillIds.add(l.name)
  let skillText = ''
  if (skillIds.size > 0) {
    const placeholders = [...skillIds].map(() => '?').join(',')
    const skills = db
      .prepare(`SELECT name, body_md FROM skill WHERE name IN (${placeholders})`)
      .all(...skillIds) as Array<{ name: string; body_md: string }>
    if (skills.length > 0) {
      skillText = `\n\n【挂载技能】\n${skills.map((s) => `### ${s.name}\n${s.body_md}`).join('\n\n')}`
    }
  }

  const ctx = buildChapterWriteContext(db, novelId, chapterId, {
    include: step.include
  })
  const promptBase = ctx.messages[0]?.content ?? ''

  const prevBlock =
    prevOutputs.length > 0
      ? `\n\n【本方案已完成的步骤输出】\n${prevOutputs.map((o, i) => `步骤${i + 1}：${o}`).join('\n---\n')}`
      : ''

  let base = [
    agent.system_prompt || agent.body_md || `你是${agent.name}（${agent.role}）。`,
    agent.description ? `\n职责：${agent.description}` : '',
    agent.body_md ? `\n\n${agent.body_md}` : '',
    skillText,
    `${JSON_FORMAT}`,
    `\n\n${promptBase}`,
    prevBlock,
    `\n\n请输出 JSON：{"result": "你的产出（≤${step.maxTokens ?? 2048} tokens 的文本或结构化结论）"}`
  ].join('\n')

  // 注入完整正文供审阅（限量 8000 字符）
  const content = db
    .prepare('SELECT content FROM chapter WHERE id = ?')
    .get(chapterId) as { content: string } | undefined
  if (content?.content) {
    base += `\n\n【章节正文】\n${content.content.slice(0, 8000)}`
  }
  return base
}

/**
 * 运行方案（chapter 级）。stage 全量执行：post_generate + review 步按声明顺序跑；
 * whole_book 步明确报错（P21 预留：整本模式执行器未实现）。
 */
export async function runSolutionById(
  db: DatabaseSync,
  solutionId: number,
  novelId: number,
  chapterId: number,
  opts: RunSolutionOptions = {}
): Promise<RunResult> {
  const solution = loadSolution(db, solutionId)
  if (!solution) throw new Error('solution not found')
  if (!solution.enabled) throw new Error(`方案「${solution.name}」已停用`)
  const bookStages = solution.steps.filter((s) => s.stage === 'whole_book')
  if (bookStages.length > 0) {
    throw new Error(
      `方案「${solution.name}」包含整本模式步骤（${bookStages.map((s) => s.role).join('、')}）。整本模式执行器尚未实现（P21 预留）。`
    )
  }

  const outputs: StepOutput[] = []
  const degradedReasons: string[] = []
  const prevOutputs: string[] = []

  for (let i = 0; i < solution.steps.length; i++) {
    if (opts.signal?.aborted) break
    const step = solution.steps[i]
    const t0 = Date.now()
    // 条件分支（P21-5c 预留：支持对上一步输出字段长度判断）
    if (step.if && outputs.length > 0) {
      const last = outputs[outputs.length - 1]
      // v0.17.0（审查 M12）：消费 field（默认 output 字符串长度；其他字段取数值/长度）——此前声明但恒用 output
      const field = step.if.field ?? 'output'
      const raw = field === 'output' ? last.output : String((last as unknown as Record<string, unknown>)[field] ?? '')
      const val = field === 'output' ? raw.length : Number(raw) || String(raw).length
      const { op, value } = step.if
      const hit = op === '<' ? val < value : op === '>' ? val > value : val === value
      if (!hit) {
        outputs.push({
          stepIndex: i,
          role: step.role,
          stage: step.stage,
          output: '（条件不满足，跳过）',
          ok: true,
          ms: 0
        })
        continue
      }
    }
    try {
      const prompt = buildStepPrompt(db, novelId, chapterId, step, prevOutputs)
      const result = await withTimeout(
        (signal) =>
          callLlmJson<{ result: string }>(
            db,
            'extraction',
            {
              novelId,
              signal,
              messages: [{ role: 'user', content: prompt }],
              maxTokens: step.maxTokens ?? 2048
            },
            (obj) => {
              const r = obj as Record<string, unknown>
              if (typeof r.result === 'string' && r.result.trim().length > 0) return { result: r.result }
              return null
            },
            `solution-${solutionId}-step-${i}`
          ),
        STEP_TIMEOUT_MS
      )
      // 人工改写（单步调试）
      const human = opts.humanOverride?.[i]
      const final = human !== undefined ? human : result.result
      outputs.push({
        stepIndex: i,
        role: step.role,
        stage: step.stage,
        output: final,
        ok: true,
        ms: Date.now() - t0
      })
      prevOutputs.push(final)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      outputs.push({
        stepIndex: i,
        role: step.role,
        stage: step.stage,
        output: '',
        ok: false,
        error: message,
        ms: Date.now() - t0
      })
      degradedReasons.push(`${step.role}: ${message}`)
      // 单步失败不中止后续（降级继续）
    }
  }

  return {
    solutionId,
    solutionName: solution.name,
    outputs,
    degraded: degradedReasons.length > 0,
    degradedReasons
  }
}

/** 汇总方案输出为注入文本（供审核/生成上下文引用） */
export function summarizeRun(run: RunResult): string {
  const okSteps = run.outputs.filter((o) => o.ok && o.output)
  if (okSteps.length === 0) return ''
  return [
    `【方案「${run.solutionName}」输出】`,
    ...okSteps.map((o) => `步骤${o.stepIndex + 1}·${o.role}：${o.output}`)
  ].join('\n')
}

// ============================================================
// P30：章节生产流水线（stage='whole_book'）
// 某章正文生成时按方案步骤接力 agent（情节规划→场景/对话→审校→最终合并），
// 最后合并落库 + 版本快照 + 回灌。替代默认 prose 单次流式生成。
// ============================================================

const OUTPUT_INSTRUCTION: Record<string, string> = {
  outline: '输出本章大纲 JSON：{"title": "章节标题（≤20字）", "scenes": [{"purpose": "场景目的", "summary": "场景内容要点"}]}，3-6 个场景',
  draft: '输出正文片段（Markdown 纯文本，800-1500 字）——只写这一部分，不要输出标题/总结',
  dialogue: '输出本章对话内容（纯文本对话段落，300-800 字）——对话为主，穿插动作与神态',
  scene: '输出一个场景的完整描写（纯文本，500-1200 字）——感官化、推动情节或揭示人物',
  review: '输出审校意见 JSON：{"issues": [{"severity": "high|medium|low", "problem": "问题", "suggestion": "修改建议"}], "verdict": "通过|需修改"}',
  final: '输出最终全文（纯文本，完整章节内容）——整合前面所有步骤的产出，符合本章目标'
}

export interface ProductionChapterResult {
  content: string
  wordCount: number
  title: string | null
  outputs: StepOutput[]
  degraded: boolean
  degradedReasons: string[]
}

/** 章节生产模式执行：按方案 whole_book 步骤接力产出正文并落库 */
export async function runProductionChapter(
  db: DatabaseSync,
  solutionId: number,
  novelId: number,
  chapterId: number,
  opts: RunSolutionOptions = {}
): Promise<ProductionChapterResult> {
  const solution = loadSolution(db, solutionId)
  if (!solution) throw new Error('solution not found')
  if (!solution.enabled) throw new Error(`方案「${solution.name}」已停用`)

  const chapter = db
    .prepare('SELECT id, title, content, status FROM chapter WHERE id = ? AND novel_id = ?')
    .get(chapterId, novelId) as { id: number; title: string; content: string; status: string } | undefined
  if (!chapter) throw new Error('chapter not found')
  if (chapter.content.trim()) throw new Error('章节已有正文（生产模式只用于空章节）')

  // v0.8.0（审查 #5）：原子抢占——复用 generateChapter 的 claim 语义（status 门禁），
  // 防 produce-chapter 与整本生产/SSE 生成并发写同一章（双倍费用 + 后写覆盖先写）
  const claimed = db
    .prepare(
      "UPDATE chapter SET status = 'generating', updated_at = datetime('now') WHERE id = ? AND novel_id = ? AND status NOT IN ('generating')"
    )
    .run(chapterId, novelId)
  if (Number(claimed.changes) === 0) {
    throw new Error('章节正在生成中（或状态不允许），请等待完成')
  }

  const outputs: StepOutput[] = []
  const degradedReasons: string[] = []
  const draftParts: string[] = [] // 片段合并（draft/scene/dialogue）
  let outline: { title?: string; scenes?: Array<{ purpose?: string; summary?: string }> } | null = null
  let finalContent = ''

  try {

  for (let i = 0; i < solution.steps.length; i++) {
    if (opts.signal?.aborted) break
    const step = solution.steps[i]
    if (step.stage !== 'whole_book') {
      throw new Error(`生产模式方案包含非生产步骤（${step.role}）——请仅用章节生产步骤`)
    }
    // v0.9.0（审查 #22）：step.if 条件分支（对齐 runSolutionById——对上一步输出长度判断；首步无条件执行）
    if (step.if && outputs.length > 0) {
      const last = outputs[outputs.length - 1]
      const val = last.output.length
      const { op, value } = step.if
      const hit = op === '<' ? val < value : op === '>' ? val > value : val === value
      if (!hit) {
        outputs.push({
          stepIndex: i,
          role: step.role,
          stage: step.stage,
          output: '（条件不满足，跳过）',
          ok: true,
          ms: 0
        })
        continue
      }
    }
    const prod = step.production ?? { output: 'draft' as const, reviewRounds: 1 }
    const t0 = Date.now()
    try {
      const agent = db.prepare('SELECT name, system_prompt, description, body_md FROM agent WHERE id = ?').get(step.agentId) as
        | { name: string; system_prompt: string; description: string; body_md: string }
        | undefined
      if (!agent) throw new Error(`步骤 ${step.role} 引用不存在的智能体 #${step.agentId}`)

      const instruction = OUTPUT_INSTRUCTION[prod.output] ?? OUTPUT_INSTRUCTION.draft
      const prevBlock =
        outputs.length > 0
          ? `\n\n【已完成步骤输出】\n${outputs.map((o, idx) => `步骤${idx + 1}·${o.role}：\n${o.output.slice(0, 2000)}`).join('\n---\n')}`
          : ''

      // v0.8.0（审查 #7）：纯文本类步骤（draft/scene/dialogue/final）不注入 JSON_FORMAT——
      // 此前"只输出 JSON"指令与纯文本解析互相矛盾，模型按 JSON 包装时包装符会作为正文落库
      const jsonOutput = prod.output === 'outline' || prod.output === 'review'
      const formatRule = jsonOutput ? `\n${JSON_FORMAT}\n\n` : '\n请只输出正文文本，不要 JSON、不要代码块标记、不要解释。\n\n'

      const prompt = [
        agent.system_prompt || agent.body_md || `你是${agent.name}。`,
        agent.description ? `\n职责：${agent.description}` : '',
        agent.body_md ? `\n\n${agent.body_md}` : '',
        '\n\n章节目标：',
        chapter.title ? `《${chapter.title}》` : '（未命名章节）',
        // v0.12.0（批D/P31）：卷章定位注入——方案步骤感知章在卷中的角色（开篇/推进/收尾）
        chapterPositionBlock(db, novelId, chapterId),
        // v0.15.0：创作约束注入（硬约束+简报+引导）——方案步骤遵循用户强调的事项
        constraintsBlock(db, novelId) ? `\n\n${constraintsBlock(db, novelId)}` : '',
        `${formatRule}${instruction}`,
        prevBlock,
        `\n\n（步骤 ${i + 1}/${solution.steps.length}，请只完成本步骤职责）`
      ].join('\n')

      let result: string
      if (prod.output === 'outline') {
        const r = await withTimeout(
          (signal) =>
            callLlmJson<{ outline: { title?: string; scenes?: Array<{ purpose?: string; summary?: string }> } }>(
              db,
              'extraction',
              {
                novelId,
                signal,
                messages: [{ role: 'user', content: prompt }],
                // v0.9.0：JSON 结构输出预算下限 4096——此前默认 2048 且 step.maxTokens 常为 null，
                // flash 输出稍长即被截断（JSON 解析失败 → 大纲步骤降级，标题/场景丢失）
                maxTokens: Math.max(step.maxTokens ?? 2048, 4096)
              },
              (obj) => {
                // v0.9.0：兼容两种形态——prompt 指令为顶层 {"title","scenes"}，
                // 模型有时按字面输出顶层、有时输出 {outline:{...}} 包装（此前只认包装 → 大纲步骤降级）
                const r = obj as Record<string, unknown>
                const o = (r.outline as Record<string, unknown> | undefined) ?? r
                if (o && typeof o === 'object') {
                  const or = o as { title?: unknown; scenes?: unknown }
                  return {
                    outline: {
                      title: typeof or.title === 'string' ? or.title : undefined,
                      scenes: Array.isArray(or.scenes) ? (or.scenes as Array<{ purpose?: string; summary?: string }>) : undefined
                    }
                  }
                }
                return null
              },
              `production-outline-${i}`
            ),
          STEP_TIMEOUT_MS
        )
        outline = r.outline
        result = JSON.stringify(r.outline)
      } else if (prod.output === 'review') {
        // v0.9.0（审查 #22）：reviewRounds 多轮审校——按轮数重复审校，产出合并（此前声明字段但只审一轮）
        const rounds = Math.min(prod.reviewRounds ?? 1, 3)
        const allIssues: Array<{ severity: string; problem: string; suggestion: string }> = []
        let verdict = '通过'
        for (let round = 1; round <= rounds; round++) {
          const roundPrompt = round > 1 ? `${prompt}\n\n（第 ${round}/${rounds} 轮复审：聚焦上一轮已发现问题的修复效果与遗漏）` : prompt
          const r = await withTimeout(
            (signal) =>
              callLlmJson<{ issues: Array<{ severity: string; problem: string; suggestion: string }>; verdict: string }>(
                db,
                'extraction',
                {
                  novelId,
                  signal,
                  messages: [{ role: 'user', content: roundPrompt }],
                  maxTokens: step.maxTokens ?? 2048
                },
                (obj) => {
                  const o = obj as Record<string, unknown>
                  return {
                    issues: Array.isArray(o.issues)
                      ? o.issues.map((x) => {
                          const xi = x as Record<string, unknown>
                          return {
                            severity: String(xi.severity ?? 'medium'),
                            problem: String(xi.problem ?? ''),
                            suggestion: String(xi.suggestion ?? '')
                          }
                        })
                      : [],
                    verdict: String(o.verdict ?? '通过')
                  }
                },
                `production-review-${i}-r${round}`
              ),
            STEP_TIMEOUT_MS
          )
          for (const issue of r.issues) {
            if (!allIssues.some((e) => e.problem === issue.problem)) allIssues.push(issue)
          }
          if (r.verdict !== '通过') verdict = r.verdict
        }
        result = JSON.stringify({ issues: allIssues, verdict })
      } else if (prod.output === 'final') {
        // P30 修复：正文类产出走 callLlm（纯文本，不做 JSON 解析）——flash 输出纯文本被 JSON 校验误杀
        const llm = await import('./llm')
        const r = await withTimeout(
          (signal) =>
            llm.callLlm(db, 'extraction', {
              novelId,
              signal,
              messages: [{ role: 'user', content: prompt }],
              maxTokens: step.maxTokens ?? 8192
            }),
          STEP_TIMEOUT_MS
        )
        const text = r.content.trim()
        if (text.length < 100) throw new Error('final 产出过短')
        finalContent = text
        result = finalContent.slice(0, 500) + '…'
      } else {
        // draft / scene / dialogue：正文片段（收集合并）——P30 修复：纯文本输出不解析 JSON
        const llm = await import('./llm')
        const r = await withTimeout(
          (signal) =>
            llm.callLlm(db, 'extraction', {
              novelId,
              signal,
              messages: [{ role: 'user', content: prompt }],
              maxTokens: step.maxTokens ?? 4096
            }),
          STEP_TIMEOUT_MS
        )
        const text = r.content.trim()
        if (text.length < 50) throw new Error('片段产出过短')
        draftParts.push(text)
        result = r.content.slice(0, 300) + '…'
      }

      outputs.push({ stepIndex: i, role: step.role, stage: 'whole_book', output: result, ok: true, ms: Date.now() - t0 })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      outputs.push({ stepIndex: i, role: step.role, stage: 'whole_book', output: '', ok: false, error: message, ms: Date.now() - t0 })
      degradedReasons.push(`${step.role}: ${message}`)
    }
  }

  // 最终正文：final 步骤优先；无 final 步骤时合并片段（标题用大纲标题）
  let content = finalContent
  if (!content.trim() && draftParts.length > 0) {
    content = draftParts.join('\n\n')
  }
  if (!content.trim()) {
    const reasons = degradedReasons.length > 0
      ? degradedReasons.join('; ').slice(0, 500)
      : outputs.map((o) => `${o.role}:${o.error ?? '?'}`).join('; ').slice(0, 500)
    throw new Error(`生产流水线未产出正文（所有产出步骤失败）：${reasons || '未知原因'}`)
  }
  // v0.15.0：主角名约束替换（方案流水线产出同样对齐规范名）
  content = replaceProtagonistName(db, novelId, content)
  const title = outline?.title?.trim() || chapter.title || ''

  // 落库 + 版本快照 + 状态（v0.21.0 审查 N1：AI 产出记账——流水线直接落库不走客户端 delta）
  const wordCount = (content.match(/[\u4e00-\u9fff]/g) ?? []).length
  db.prepare('INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, ?)').run(chapterId, content, 'AI 生产（方案流水线）')
  db.prepare(
    "UPDATE chapter SET title = CASE WHEN ? != '' THEN ? ELSE title END, content = ?, word_count = ?, status = 'written', ai_words = ai_words + ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title, title, content, wordCount, wordCount, chapterId)

  return {
    content,
    wordCount,
    title: title || null,
    outputs,
    degraded: degradedReasons.length > 0,
    degradedReasons
  }
  } catch (err) {
    // 抢占复位：失败时释放 claim（status='generating' → 'failed'），
    // 使调用方（整本生产回退 generateChapter）可用，且不残留"永久生成中"
    db.prepare("UPDATE chapter SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'generating'").run(chapterId)
    throw err
  }
}
