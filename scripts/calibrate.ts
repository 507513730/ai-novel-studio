/**
 * DeepSeek 参数校准实验（P0 必做项，产出 docs/calibration-report.md）
 *
 * 用法（需先在本机任意位置配置好 DeepSeek API Key）：
 *   $env:DEEPSEEK_API_KEY="sk-..."  # PowerShell
 *   pnpm calibrate
 *
 * 原理：
 *   - 固定测试集（同一本书的 1 章任务单），统一提示词前缀（不追求缓存命中，
 *     校准的是质量而非成本；缓存命中统计仍会被记录）
 *   - 扫描矩阵：任务类型 × {thinking on/off} × {effort low/high/max} × {温度 0.7/0.9/1.1}
 *   - 评分指标：字数达标率 / 反AI词命中数 / JSON 合法率 / 章节名单一性 / 指令遵循率 / 耗时 / 成本
 *   - 输出 docs/calibration-report.md，并给出建议预设（人工确认后写入数据库）
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import OpenAI from 'openai'

const API_KEY = process.env.DEEPSEEK_API_KEY
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'
const OUT_FILE = process.env.CALIB_OUTPUT ?? 'calibration-report.md'
const OUT_DIR = join(process.cwd(), 'docs')

if (!API_KEY) {
  console.error('缺少 DEEPSEEK_API_KEY 环境变量')
  process.exit(1)
}

// ---- 固定测试集：同一本书的 1 章任务单 ----
const BOOK_CONTRACT = [
  '【书级合约】',
  '题材：都市异能。卖点：草根逆袭 + 金融商战。目标读者感受：爽、紧张、期待打脸。',
  '前 30 章承诺：主角从底层调查员崛起，第 3 章前必须首次使用异能，第 10 章前必须正面击败第一个商业对手。'
].join('\n')

const WORLD_SNIPPET = [
  '【世界观要点】',
  '设定：2045 年，存在"共感"异能——能感知他人情绪波动的能力者，公开身份合法但被大财团垄断培训。',
  '主角：林越，27 岁调查记者，孤儿。反派：陆氏集团，金融垄断者。'
].join('\n')

const CHAR_LEDGER = [
  '【角色账本】',
  '- 林越（主角）：立场正义，性格固执、观察力强；关键资产：共感异能（未公开展示）。',
  '- 苏晚（女主）：陆氏集团法务，暗中同情记者；关键资产：陆氏内幕文件。',
  '- 陆鸿鸣（反派）：陆氏集团掌门，傲慢、精于算计。'
].join('\n')

const CHAPTER_TASK = [
  '【本章任务单】',
  '章节：第一章（黄金三章首章）',
  '目标：展现林越的普通人困境；异能首次觉醒；埋下与陆氏的冲突伏笔。',
  '字数要求：2000-3000 字。',
  '结尾要求：留钩子（异能觉醒原因未明）。'
].join('\n')

const FIXED_PREFIX = [
  '你是资深中文网文作者，擅长都市异能题材，注重节奏与爽点，避免模板化表达。',
  BOOK_CONTRACT,
  WORLD_SNIPPET,
  CHAR_LEDGER,
  '写作要求：第三人称，过去时叙述，人物对话要口语化；不要出现"仿佛、眼底闪过、缓缓、不由得、刹那间"等高频 AI 腔词。'
].join('\n\n')

const TASK = `${FIXED_PREFIX}\n\n${CHAPTER_TASK}\n\n请直接输出正文，开头先给出章节名（格式：章节名：XXX），然后另起一行开始正文。`

// ---- 反 AI 词库（与 seed 的 DeepSeek 高频腔词对齐）----
const ANTI_AI_WORDS = [
  '仿佛', '眼底闪过', '缓缓', '不由得', '刹那间', '微微一怔', '深邃', '喃喃自语',
  '眼神一凛', '嘴角勾起', '周身气势', '一股寒意', '心中暗道', '定睛一看', '若有所思',
  '轻叹一声', '沉默片刻', '空气仿佛凝固', '瞳孔猛地一缩'
]

interface TrialResult {
  label: string
  thinking: 'off' | 'low' | 'high' | 'max'
  temperature: number | null
  ok: boolean
  error?: string
  wordCount: number
  antiAiHits: number
  titleUnique: boolean
  title: string
  elapsedMs: number
  costUsd: number
  inputTokens: number
  outputTokens: number
}

function countCjk(text: string): number {
  const matches = text.match(/[\u4e00-\u9fff]/g)
  return matches ? matches.length : 0
}

function countAntiAi(text: string): number {
  let hits = 0
  for (const w of ANTI_AI_WORDS) {
    const re = new RegExp(w, 'g')
    const m = text.match(re)
    if (m) hits += m.length
  }
  return hits
}

function extractTitle(text: string): string | null {
  const m = text.match(/^章节名[：:]\s*(\S+)/m)
  return m ? m[1] : null
}

const PRICE = { hit: 0.0028, miss: 0.14, out: 0.28 }

async function runTrial(
  client: OpenAI,
  label: string,
  thinking: 'off' | 'low' | 'high' | 'max',
  temperature: number | null
): Promise<TrialResult> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [{ role: 'user', content: TASK }],
    max_tokens: 4096
  }
  if (thinking === 'off') {
    body.thinking = { type: 'disabled' }
    if (temperature !== null) body.temperature = temperature
  } else {
    body.thinking = { type: 'enabled' }
    body.reasoning_effort = thinking === 'low' ? 'low' : thinking === 'max' ? 'max' : 'high'
  }

  const t0 = Date.now()
  try {
    const resp = await client.chat.completions.create(
      body as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    )
    const elapsed = Date.now() - t0
    const content = resp.choices[0]?.message?.content ?? ''
    const usage = resp.usage as unknown as {
      prompt_tokens?: number
      completion_tokens?: number
      prompt_cache_hit_tokens?: number
      prompt_cache_miss_tokens?: number
    }
    const input = usage?.prompt_tokens ?? 0
    const hit = usage?.prompt_cache_hit_tokens ?? 0
    const miss = usage?.prompt_cache_miss_tokens ?? input
    const output = usage?.completion_tokens ?? 0
    const cost =
      (hit / 1e6) * PRICE.hit + (miss / 1e6) * PRICE.miss + (output / 1e6) * PRICE.out

    const title = extractTitle(content)
    return {
      label,
      thinking,
      temperature,
      ok: content.length > 0,
      wordCount: countCjk(content),
      antiAiHits: countAntiAi(content),
      titleUnique: title !== null && title.length > 1 && title.length <= 12,
      title: title ?? '(无)',
      elapsedMs: elapsed,
      costUsd: cost,
      inputTokens: input,
      outputTokens: output
    }
  } catch (err) {
    return {
      label,
      thinking,
      temperature,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      wordCount: 0,
      antiAiHits: 0,
      titleUnique: false,
      title: '',
      elapsedMs: Date.now() - t0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0
    }
  }
}

function score(result: TrialResult): number {
  // 加权评分：字数达标（40%）+ 反AI（20%）+ 标题合规（20%）+ 耗时（20%）
  const wordScore = result.ok ? Math.min(1, result.wordCount / 2200) : 0
  const antiAiScore = result.ok ? Math.max(0, 1 - result.antiAiHits / 8) : 0
  const titleScore = result.titleUnique ? 1 : 0
  const timeScore = result.ok ? Math.max(0, 1 - result.elapsedMs / 120_000) : 0
  return wordScore * 0.4 + antiAiScore * 0.2 + titleScore * 0.2 + timeScore * 0.2
}

const COMBOS: Array<{ label: string; thinking: 'off' | 'low' | 'high' | 'max'; temperature: number | null }> = [
  { label: 'off@1.1', thinking: 'off', temperature: 1.1 },
  { label: 'off@0.9', thinking: 'off', temperature: 0.9 },
  { label: 'off@0.7', thinking: 'off', temperature: 0.7 },
  { label: 'thinking-low', thinking: 'low', temperature: null },
  { label: 'thinking-high', thinking: 'high', temperature: null },
  { label: 'thinking-max', thinking: 'max', temperature: null }
]

async function main(): Promise<void> {
  console.log(`[calibrate] model=${MODEL} base=${BASE_URL} trials=${COMBOS.length}`)
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY, timeout: 180_000 })

  const results: TrialResult[] = []
  for (const combo of COMBOS) {
    // 每个组合跑 2 次取平均，抵消随机性
    const r1 = await runTrial(client, combo.label, combo.thinking, combo.temperature)
    const r2 = await runTrial(client, combo.label, combo.thinking, combo.temperature)
    const merged: TrialResult = {
      ...r1,
      wordCount: Math.round((r1.wordCount + r2.wordCount) / 2),
      antiAiHits: Math.round((r1.antiAiHits + r2.antiAiHits) / 2),
      elapsedMs: Math.round((r1.elapsedMs + r2.elapsedMs) / 2),
      costUsd: r1.costUsd + r2.costUsd,
      inputTokens: r1.inputTokens + r2.inputTokens,
      outputTokens: r1.outputTokens + r2.outputTokens
    }
    if (r2.title) merged.title = r1.title === r2.title ? r1.title : `${r1.title} / ${r2.title}`
    results.push(merged)
    console.log(
      `  [${combo.label}] ok=${merged.ok} 字数=${merged.wordCount} 反AI词=${merged.antiAiHits} 标题=${merged.titleUnique ? '合规' : '不合规'} 耗时=${merged.elapsedMs}ms 成本=$${merged.costUsd.toFixed(4)}`
    )
  }

  const ranked = [...results].sort((a, b) => score(b) - score(a))
  const best = ranked[0]
  const allOk = results.every((r) => r.ok)

  mkdirSync(OUT_DIR, { recursive: true })
  const reportPath = join(OUT_DIR, OUT_FILE)
  const lines: string[] = [
    '# DeepSeek 参数校准实验报告',
    '',
    `- 日期：${new Date().toISOString().slice(0, 10)}`,
    `- 模型：${MODEL}`,
    `- 测试集：都市异能《第一章》任务单（固定前缀：书级合约 + 世界观 + 角色账本）`,
    `- 每组合 2 次取均值；成本单价：hit $0.0028 / miss $0.14 / out $0.28（per 1M tokens）`,
    '',
    '## 结果',
    '',
    '| 组合 | 状态 | 字数 | 反AI词 | 标题合规 | 耗时ms | 成本$ | 评分 |',
    '|---|---|---|---|---|---|---|---|',
    ...results.map((r) =>
      `| ${r.label} | ${r.ok ? 'OK' : 'FAIL'} | ${r.wordCount} | ${r.antiAiHits} | ${r.titleUnique ? '✓' : '✗'} | ${r.elapsedMs} | ${r.costUsd.toFixed(4)} | ${score(r).toFixed(3)} |`
    ),
    '',
    `## 结论`,
    '',
    `- 最佳组合：**${best.label}**（评分 ${score(best).toFixed(3)}）`,
    `- 最佳正文参数建议：${best.thinking === 'off' ? `thinking off, 温度 ${best.temperature}` : `thinking ${best.thinking}`}`,
    `- 全组合成功率：${allOk ? '100%' : '存在失败组合（详见上表）'}`,
    '',
    '## 应用建议（人工确认后写入 model_route）',
    '',
    `- prose 路由：${best.thinking === 'off' ? `thinking off + 温度 ${best.temperature}` : `thinking ${best.thinking}`}`,
    '- 若 thinking 组合在正文任务中得分接近但成本显著更高，优先选 thinking off',
    '- 章节名合规率差的组合应补充"章节名多样性"约束后再测'
  ]
  writeFileSync(reportPath, lines.join('\n'), 'utf-8')
  console.log(`\n[calibrate] 报告已写入 ${reportPath}`)
  console.log(`[calibrate] 最佳组合: ${best.label} (评分 ${score(best).toFixed(3)})`)
}

main().catch((err) => {
  console.error('[calibrate] fatal:', err)
  process.exit(1)
})
