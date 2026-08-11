import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'

// ============================================================
// P4 写法引擎（services/styleEngine.ts）
// 特征提取（示例文本 → 特征池+样本）→ 规则编译 → 绑定注入
// + 反 AI 规则参与检测/修正
// ============================================================

export interface StyleFeature {
  id: string
  name: string
  description: string
  enabled: boolean
  category: 'syntax' | 'vocabulary' | 'rhythm' | 'dialogue' | 'description' | 'other'
}

export interface CompiledStyleRules {
  enabledFeatures: StyleFeature[]
  rules: string[] // 编译后的指令
  antiAiRules: string[] // 反 AI 词库
}

// ---------- 特征提取 ----------
const EXTRACT_PROMPT = `你是写作风格分析师。分析以下示例文本，提取写作特征（句式/词汇/节奏/对话/描写手法），输出 JSON：
{"features": [{"name": "特征名", "description": "特征描述（含示例）", "category": "syntax|vocabulary|rhythm|dialogue|description|other"}]}
要求：8-15 个特征，每个特征 description 30-80 字。`

export async function extractStyleFeatures(
  db: DatabaseSync,
  novelId: number,
  sampleText: string,
  name: string
): Promise<StyleFeature[]> {
  const features = await callLlmJson<StyleFeature[]>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: `${EXTRACT_PROMPT}\n\n【示例文本】\n${sampleText.slice(0, 6000)}\n\n只输出 JSON。`
        }
      ],
      maxTokens: 4096
    },
    (obj) => {
      const arr = (obj as { features?: unknown }).features
      if (!Array.isArray(arr) || arr.length === 0) return null
      const out: StyleFeature[] = []
      for (const f of arr) {
        const r = f as Record<string, unknown>
        if (!r.name || !r.description) return null
        out.push({
          id: `f${out.length + 1}`,
          name: String(r.name),
          description: String(r.description),
          enabled: true,
          category: (r.category as StyleFeature['category']) ?? 'other'
        })
      }
      return out
    },
    'style-extract'
  )

  db.prepare(
    'INSERT INTO style_asset (novel_id, name, features_json, samples_json, anti_ai_rules_json) VALUES (?, ?, ?, ?, ?)'
  ).run(
    novelId,
    name,
    JSON.stringify(features),
    JSON.stringify([sampleText.slice(0, 3000)]),
    '[]'
  )
  return features
}

// ---------- 规则编译 ----------
export function compileStyleRules(features: StyleFeature[], antiAiWords: string[]): CompiledStyleRules {
  const enabled = features.filter((f) => f.enabled)
  const rules = enabled.map(
    (f) => `【写法·${f.name}】${f.description}`
  )
  const antiAiRules =
    antiAiWords.length > 0
      ? [`【反 AI 词禁令】本章正文严禁出现以下词汇/句式：${antiAiWords.join('、')}`]
      : []
  return { enabledFeatures: enabled, rules, antiAiRules }
}

// ---------- 反 AI 检测（规则命中 → 标记） ----------
export function detectAntiAiHits(text: string, antiAiWords: string[]): Array<{ word: string; count: number }> {
  const hits: Array<{ word: string; count: number }> = []
  for (const w of antiAiWords) {
    if (!w) continue
    const matches = text.match(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
    if (matches) hits.push({ word: w, count: matches.length })
  }
  return hits.sort((a, b) => b.count - a.count)
}

// P20（U8）：从「反 AI 词禁令」规则块解析禁用词（从 style.ts 移入共用，生成链路复用）
export function extractAntiAiWordsFromRules(rules: string[]): string[] {
  const words: string[] = []
  for (const rule of rules) {
    const m = rule.match(/严禁出现以下词汇\/句式：(.+)/)
    if (m) {
      for (const w of m[1].split(/[、，,]/)) words.push(w.trim())
    }
  }
  return words.filter(Boolean)
}

// ---------- 绑定到书（返回注入文本，供 context 组装器用） ----------
export function getBoundStyleRules(db: DatabaseSync, novelId: number): CompiledStyleRules | null {
  // 取该书最近一条 style_asset（或全局），返回编译后的规则
  const asset = db
    .prepare(
      'SELECT id, features_json, anti_ai_rules_json FROM style_asset WHERE novel_id = ? ORDER BY id DESC LIMIT 1'
    )
    .get(novelId) as { id: number; features_json: string; anti_ai_rules_json: string } | undefined
  if (!asset) return null
  const features = JSON.parse(asset.features_json || '[]') as StyleFeature[]
  if (features.length === 0) return null
  const antiAiWords = JSON.parse(asset.anti_ai_rules_json || '[]') as string[]
  // 补充全局反 AI 词库（prompt_asset 里 seed 的）
  const globalAntiAi = db
    .prepare("SELECT template FROM prompt_asset WHERE task_type IN ('anti_ai_lexicon','anti_ai_template')")
    .all() as Array<{ template: string }>
  for (const g of globalAntiAi) {
    try {
      const words = JSON.parse(g.template) as string[]
      for (const w of words) {
        if (!antiAiWords.includes(w)) antiAiWords.push(w)
      }
    } catch {
      /* ignore */
    }
  }
  return compileStyleRules(features, antiAiWords)
}

// ---------- 试写对比 ----------
export async function trialWrite(
  db: DatabaseSync,
  novelId: number,
  taskText: string
): Promise<{ output: string; usedRules: string[] }> {
  const bound = getBoundStyleRules(db, novelId)
  const rulesText = bound
    ? [...bound.rules, ...bound.antiAiRules].join('\n')
    : '（未绑定写法资产）'
  const output = await callLlmJson<{ content: string }>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: `你是小说作者，按以下写法要求试写一段：\n${rulesText}\n\n【试写任务】\n${taskText}\n\n输出 JSON：{"content": "试写正文（200-400 字）"}`
        }
      ],
      maxTokens: 2048
    },
    (obj) => {
      const r = obj as Record<string, unknown>
      return typeof r.content === 'string' && r.content.length > 50 ? { content: r.content } : null
    },
    'style-trial'
  )
  return { output: output.content, usedRules: bound ? bound.rules : [] }
}
