import type { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'
import { loadSolution, type SolutionStep } from './solutionAssets'
import { buildChapterWriteContext } from './context'
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`step timeout after ${ms}ms`)), ms)
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

  // 技能挂载（body 拼入）
  const skillIds = (JSON.parse(agent.skills_json || '[]') as string[]) ?? []
  let skillText = ''
  if (skillIds.length > 0) {
    const placeholders = skillIds.map(() => '?').join(',')
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
    // 条件分支（P21-5c 预留：仅支持对上一步输出长度判断）
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
    try {
      const prompt = buildStepPrompt(db, novelId, chapterId, step, prevOutputs)
      const result = await withTimeout(
        callLlmJson<{ result: string }>(
          db,
          'extraction',
          {
            novelId,
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
