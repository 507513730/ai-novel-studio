import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'
import { buildFrozenContext } from './context'

// ============================================================
// P3 拆书工作台（拆书优先，RAG 为可选子项）
// 三档拆书（快速/标准/完整）+ 五维报告
// + 角色档案四档 + 形象演变（覆盖率扫描）
// ============================================================

export type AnalysisDepth = 'quick' | 'standard' | 'full'

export interface Evidence {
  chapterId: number
  quote: string
}

export interface Dimension {
  summary: string
  evidence: Evidence[]
}

export interface AnalysisReport {
  depth: AnalysisDepth
  genre: Dimension
  structure: Dimension
  characters: Dimension
  world: Dimension
  style: Dimension
  strengths: string[]
  weaknesses: string[]
}

// P18 D2：五维结构化输出（结论 + 章节证据引用，quote 必须原文逐字）
const PROMPTS: Record<AnalysisDepth, string> = {
  quick: `你是拆书分析师。快速拆解以下小说（重点：题材定位、主线结构、人物亮点），输出 JSON：
{"genre": {"summary": "题材定位", "evidence": [{"chapterId": 数字, "quote": "原文逐字片段"}]}, "structure": {"summary": "剧情结构", "evidence": []}, "characters": {"summary": "人物系统", "evidence": []}, "world": {"summary": "世界设定", "evidence": []}, "style": {"summary": "写法技法", "evidence": []}, "strengths": ["优点"], "weaknesses": ["缺点"]}
约束：每维 evidence 引用的 chapterId 必须是【第 N 章】标记中的 N，quote 必须摘自该章原文逐字，最多 3 条；无对应原文的维度 evidence 可为空数组。`,
  standard: `你是拆书分析师。标准拆解以下小说（五维：题材定位/剧情结构/人物系统/世界设定/写法技法），每维 200-400 字，输出 JSON：
{"genre": {"summary": "题材定位", "evidence": [{"chapterId": 数字, "quote": "原文逐字片段"}]}, "structure": {"summary": "剧情结构", "evidence": []}, "characters": {"summary": "人物系统", "evidence": []}, "world": {"summary": "世界设定", "evidence": []}, "style": {"summary": "写法技法", "evidence": []}, "strengths": ["优点"], "weaknesses": ["缺点"]}
约束：每维 evidence 引用的 chapterId 必须是【第 N 章】标记中的 N，quote 必须摘自该章原文逐字，最多 3 条；无对应原文的维度 evidence 可为空数组。`,
  full: `你是资深拆书分析师。完整拆解以下小说（五维深度分析，每维 400-800 字，含：题材的市场定位与同类对比、剧情结构的起承转合与伏笔系统、人物系统的弧光与关系网、世界设定的规则自洽性、写法技法的句式/节奏/对话特征），输出 JSON：
{"genre": {"summary": "题材定位", "evidence": [{"chapterId": 数字, "quote": "原文逐字片段"}]}, "structure": {"summary": "剧情结构", "evidence": []}, "characters": {"summary": "人物系统", "evidence": []}, "world": {"summary": "世界设定", "evidence": []}, "style": {"summary": "写法技法", "evidence": []}, "strengths": ["优点"], "weaknesses": ["缺点"]}
约束：每维 evidence 引用的 chapterId 必须是【第 N 章】标记中的 N，quote 必须摘自该章原文逐字，最多 3 条；无对应原文的维度 evidence 可为空数组。`
}

export function analysisPrompt(depth: AnalysisDepth, chaptersText: string): string {
  return `${PROMPTS[depth]}\n\n【小说内容】\n${chaptersText}\n\n只输出 JSON。`
}

// P18 D2：维度解析（兼容旧 string 格式 → {summary, evidence: []}）
function parseDim(v: unknown, validIds: Set<number>): Dimension {
  if (typeof v === 'string') return { summary: v, evidence: [] }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const summary = typeof o.summary === 'string' ? o.summary : ''
    const evidence: Evidence[] = []
    if (Array.isArray(o.evidence)) {
      for (const e of o.evidence) {
        const x = e as Record<string, unknown>
        const cid = Number(x.chapterId)
        if (Number.isInteger(cid) && validIds.has(cid) && typeof x.quote === 'string' && x.quote.trim()) {
          evidence.push({ chapterId: cid, quote: x.quote.trim().slice(0, 200) })
        }
      }
    }
    return { summary, evidence }
  }
  return { summary: '', evidence: [] }
}

function parseReport(obj: unknown, validIds: Set<number>): AnalysisReport | null {
  if (!obj || typeof obj !== 'object') return null
  const r = obj as Record<string, unknown>
  const genre = parseDim(r.genre, validIds)
  const structure = parseDim(r.structure, validIds)
  if (!genre.summary || !structure.summary) return null
  return {
    depth: 'standard',
    genre,
    structure,
    characters: parseDim(r.characters, validIds),
    world: parseDim(r.world, validIds),
    style: parseDim(r.style, validIds),
    strengths: Array.isArray(r.strengths) ? r.strengths.map(String) : [],
    weaknesses: Array.isArray(r.weaknesses) ? r.weaknesses.map(String) : []
  }
}

export async function runBookAnalysis(
  db: DatabaseSync,
  novelId: number,
  depth: AnalysisDepth = 'standard'
): Promise<AnalysisReport> {
  const novel = db.prepare('SELECT title, framing_json, inspiration FROM novel WHERE id = ?').get(novelId) as
    | { title: string; framing_json: string; inspiration: string }
    | undefined
  if (!novel) throw new Error('novel not found')
  const frozen = buildFrozenContext(db, novelId)

  // 取正文（按深度限制章节数，控制 token）；P18 D2：带 id + 章节编号供证据引用
  const chapterLimit = depth === 'quick' ? 3 : depth === 'standard' ? 10 : 30
  const chapters = db
    .prepare(
      "SELECT id, title, content FROM chapter WHERE novel_id = ? AND content != '' ORDER BY id LIMIT ?"
    )
    .all(novelId, chapterLimit) as Array<{ id: number; title: string; content: string }>

  const validIds = new Set(chapters.map((c) => c.id))
  const chaptersText = chapters
    .map((c) => `【第 ${c.id} 章】${c.title}\n${c.content.slice(0, 1500)}`)
    .join('\n\n')

  const report = await callLlmJson<AnalysisReport>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: analysisPrompt(depth, chaptersText)
        }
      ],
      maxTokens: 8192
    },
    (obj) => {
      const r = parseReport(obj, validIds)
      if (r) r.depth = depth
      return r
    },
    `analysis-${depth}`
  )

  // 落库
  db.prepare(
    "INSERT INTO book_analysis (novel_id, depth, result_json, status) VALUES (?, ?, ?, 'done')"
  ).run(novelId, depth, JSON.stringify(report))

  void novel
  void frozen
  return report
}

// ---------- 角色档案（四档） ----------
export type CharacterProfileDepth = 'brief' | 'standard' | 'deep' | 'full'

const CHAR_PROMPTS: Record<CharacterProfileDepth, string> = {
  brief: `输出角色的简要档案 JSON：{"name": "姓名", "identity": "身份", "personality": "性格（30字）", "goal": "目标"}`,
  standard: `输出角色的标准档案 JSON：{"name": "姓名", "identity": "身份", "appearance": "外貌", "personality": "性格", "goal": "目标", "weakness": "弱点", "relations": ["关系"]}`,
  deep: `输出角色的深入档案 JSON（结合原文片段）：{"name": "姓名", "identity": "身份", "appearance": "外貌", "personality": "性格（含成长变化）", "motivation": "深层动机", "arc": "成长弧光", "relations": [{"who": "对象", "how": "关系"}]}`,
  full: `输出角色的完整档案 JSON（深度分析）：{"name": "姓名", "identity": "身份", "appearance": "外貌（含标志性特征）", "personality": "性格（含矛盾面）", "motivation": "深层动机", "arc": "成长弧光（起始-变化-终态）", "relations": [{"who": "对象", "how": "关系", "tension": "张力"}], "quotes": ["代表性台词"]}`
}

export async function analyzeCharacter(
  db: DatabaseSync,
  novelId: number,
  characterName: string,
  depth: CharacterProfileDepth = 'standard'
): Promise<Record<string, unknown>> {
  const novel = db.prepare('SELECT title FROM novel WHERE id = ?').get(novelId) as
    | { title: string }
    | undefined
  // 取该角色出场的章节片段
  const chapters = db
    .prepare(
      "SELECT title, content FROM chapter WHERE novel_id = ? AND content != '' AND content LIKE ? ORDER BY id LIMIT 5"
    )
    .all(novelId, `%${characterName}%`) as Array<{ title: string; content: string }>
  const excerpts = chapters.map((c) => `【${c.title}】\n${c.content.slice(0, 1200)}`).join('\n\n')

  const result = await callLlmJson<Record<string, unknown>>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: `你是角色分析师。分析角色「${characterName}」：${CHAR_PROMPTS[depth]}\n\n【出场片段】\n${excerpts}\n\n只输出 JSON。`
        }
      ],
      maxTokens: 4096
    },
    (obj) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null),
    `character-${depth}`
  )

  // 回写角色 profile（合并）
  const char = db
    .prepare('SELECT id, profile_json FROM character WHERE novel_id = ? AND name = ?')
    .get(novelId, characterName) as { id: number; profile_json: string } | undefined
  if (char) {
    const profile = JSON.parse(char.profile_json || '{}') as Record<string, unknown>
    db.prepare('UPDATE character SET profile_json = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
      JSON.stringify({ ...profile, ...result }),
      char.id
    )
  }
  void novel
  return result
}

// ---------- 形象演变（覆盖率扫描） ----------
export async function analyzeCharacterEvolution(
  db: DatabaseSync,
  novelId: number,
  characterName: string,
  coverage: 25 | 50 | 75 | 100
): Promise<Array<{ stage: string; appearance: string; emotion: string; state: string }>> {
  const total = db
    .prepare("SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND content != ''")
    .get(novelId) as { c: number }
  const limit = Math.max(1, Math.round((total.c * coverage) / 100))
  const chapters = db
    .prepare(
      "SELECT id, title, content FROM chapter WHERE novel_id = ? AND content != '' ORDER BY id LIMIT ?"
    )
    .all(novelId, limit) as Array<{ id: number; title: string; content: string }>
  const excerpts = chapters
    .filter((c) => c.content.includes(characterName))
    .map((c) => `【${c.title}】\n${c.content.slice(0, 1000)}`)
    .join('\n\n')

  const result = await callLlmJson<Array<{ stage: string; appearance: string; emotion: string; state: string }>>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: `你是形象演变分析师。扫描角色「${characterName}」在 ${coverage}% 覆盖率内的形象演变，输出 JSON：{"evolution": [{"stage": "阶段（如'初登场'）", "appearance": "外貌/服装", "emotion": "情绪状态", "state": "处境/关系"}]}，3-6 个阶段。\n\n【片段】\n${excerpts}\n\n只输出 JSON。`
        }
      ],
      maxTokens: 4096
    },
    (obj) => {
      const arr = (obj as { evolution?: unknown }).evolution
      if (!Array.isArray(arr) || arr.length === 0) return null
      return arr.map((e) => {
        const r = e as Record<string, unknown>
        return {
          stage: String(r.stage ?? ''),
          appearance: String(r.appearance ?? ''),
          emotion: String(r.emotion ?? ''),
          state: String(r.state ?? '')
        }
      })
    },
    `evolution-${coverage}`
  )
  return result
}
