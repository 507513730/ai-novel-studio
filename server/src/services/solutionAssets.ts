import type { DatabaseSync } from 'node:sqlite'

// ============================================================
// P21-1：智能体资产化工具
// 支持 Feelfish 风格 agent 定义（YAML frontmatter + Markdown 正文）：
//   ---
//   name: 场景描写师
//   description: ...
//   tools: all
//   skills: [mc-xxx]
//   ---
//   1. 核心职责 ...
// ============================================================

export interface AgentFrontmatter {
  name?: string
  description?: string
  tools?: string
  skills?: string[]
}

export interface ParsedAgentMd {
  frontmatter: AgentFrontmatter
  body: string
  raw: string
}

/** 解析 YAML frontmatter（仅支持 Feelfish 用到的标量/数组子集；解析失败返回空 frontmatter） */
export function parseAgentMd(content: string): ParsedAgentMd {
  const trimmed = content.replace(/^\uFEFF/, '').trimStart()
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed, raw: content }
  }
  const end = trimmed.indexOf('\n---', 3)
  if (end < 0) return { frontmatter: {}, body: trimmed, raw: content }
  const fmRaw = trimmed.slice(3, end).trim()
  const body = trimmed.slice(end + 4).trimStart()
  const frontmatter: AgentFrontmatter = {}
  for (const line of fmRaw.split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/)
    if (!m) continue
    const [, key, value] = m
    if (key === 'skills') {
      const arr = value
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      frontmatter.skills = arr
    } else if (key === 'name' || key === 'description' || key === 'tools') {
      ;(frontmatter as Record<string, string>)[key] = value.trim()
    }
  }
  return { frontmatter, body, raw: content }
}

// ---------- 方案（solution）数据类型 ----------

export type SolutionStage = 'post_generate' | 'review' | 'whole_book'

export interface SolutionStep {
  agentId: number
  role: string
  stage: SolutionStage
  include?: string[]
  maxTokens?: number
  // P21-5c 预留：条件分支（依赖上一步输出字段）
  if?: { field: string; op: '<' | '>' | '=='; value: number } | null
  // P30：生产模式字段（stage='whole_book' 时生效——章节生产流水线）
  production?: {
    // 每步产出类型：outline=本章大纲 / draft=正文片段 / dialogue=对话 / scene=场景 / review=审校意见 / final=最终合并
    output: 'outline' | 'draft' | 'dialogue' | 'scene' | 'review' | 'final'
    // 审校步骤的修订轮数（默认 1；仅 review 步骤有效）
    reviewRounds?: number
  }
}

export interface Solution {
  id: number
  name: string
  description: string
  primaryAgentId: number | null
  steps: SolutionStep[]
  version: number
  enabled: number
  createdAt: string
  updatedAt: string
}

const STEP_SCHEMA = (s: unknown): s is SolutionStep => {
  if (typeof s !== 'object' || s === null) return false
  const r = s as Record<string, unknown>
  if (typeof r.agentId !== 'number' || typeof r.role !== 'string') return false
  if (r.stage !== 'post_generate' && r.stage !== 'review' && r.stage !== 'whole_book') return false
  // P30：production 字段校验（stage='whole_book' 时建议但非强制）
  if (r.production !== undefined && r.production !== null) {
    const p = r.production as Record<string, unknown>
    if (typeof p.output !== 'string') return false
    const outputs = ['outline', 'draft', 'dialogue', 'scene', 'review', 'final']
    if (!outputs.includes(p.output)) return false
  }
  return true
}

/** 解析 steps_json（宽松：非法 step 丢弃） */
export function parseSolutionSteps(json: string): SolutionStep[] {
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter(STEP_SCHEMA)
  } catch {
    return []
  }
}

export function loadSolution(db: DatabaseSync, id: number): Solution | null {
  const row = db.prepare('SELECT * FROM solution WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return null
  return {
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description),
    primaryAgentId: row.primary_agent_id === null ? null : Number(row.primary_agent_id),
    steps: parseSolutionSteps(String(row.steps_json)),
    version: Number(row.version),
    enabled: Number(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

export function listSolutions(db: DatabaseSync): Solution[] {
  const rows = db
    .prepare('SELECT * FROM solution ORDER BY id DESC')
    .all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    description: String(r.description),
    primaryAgentId: r.primary_agent_id === null ? null : Number(r.primary_agent_id),
    steps: parseSolutionSteps(String(r.steps_json)),
    version: Number(r.version),
    enabled: Number(r.enabled),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  }))
}

/** 保存方案（每次保存写版本历史） */
export function saveSolution(
  db: DatabaseSync,
  id: number,
  patch: { name?: string; description?: string; primaryAgentId?: number | null; steps?: SolutionStep[]; enabled?: number; note?: string }
): void {
  const current = loadSolution(db, id)
  if (!current) throw new Error('solution not found')
  // 版本快照（steps 有变化时）
  if (patch.steps) {
    db.prepare('INSERT INTO solution_version (solution_id, steps_json, note) VALUES (?, ?, ?)').run(
      id,
      JSON.stringify(current.steps),
      patch.note ?? `v${current.version} 快照`
    )
  }
  const sets: string[] = []
  const params: Array<string | number | null> = []
  if (patch.name !== undefined) {
    sets.push('name = ?')
    params.push(patch.name)
  }
  if (patch.description !== undefined) {
    sets.push('description = ?')
    params.push(patch.description)
  }
  if (patch.primaryAgentId !== undefined) {
    sets.push('primary_agent_id = ?')
    params.push(patch.primaryAgentId)
  }
  if (patch.steps !== undefined) {
    sets.push('steps_json = ?')
    params.push(JSON.stringify(patch.steps))
    sets.push('version = version + 1')
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?')
    params.push(patch.enabled)
  }
  sets.push("updated_at = datetime('now')")
  if (sets.length === 0) return
  db.prepare(`UPDATE solution SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
}

export function createSolution(
  db: DatabaseSync,
  data: { name: string; description: string; primaryAgentId?: number | null; steps?: SolutionStep[] }
): number {
  const result = db
    .prepare(
      "INSERT INTO solution (name, description, primary_agent_id, steps_json, version) VALUES (?, ?, ?, ?, 1)"
    )
    .run(
      data.name,
      data.description,
      data.primaryAgentId ?? null,
      JSON.stringify(data.steps ?? [])
    )
  return Number(result.lastInsertRowid)
}

export function deleteSolution(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM solution WHERE id = ?').run(id)
}

// ---------- 市场接口（P21-4 预留：未来接 GitHub 目录/在线市场） ----------

export interface MarketProvider {
  readonly id: string
  readonly label: string
  /** 拉取方案列表（bundle 格式见 SolutionBundle） */
  fetchList(): Promise<Array<{ id: string; name: string; description: string }>>
  /** 拉取单个方案 bundle 文本 */
  fetchBundle(marketId: string): Promise<string>
}

/** 本地文件市场（当前唯一实现）：目录下的 *.solution.json */
export class LocalDirectoryMarket implements MarketProvider {
  readonly id = 'local'
  readonly label = '本地模板目录'
  constructor(_dir: string) {}
  async fetchList(): Promise<Array<{ id: string; name: string; description: string }>> {
    // 预留：扫描目录 *.solution.json 解析 name/description
    return []
  }
  async fetchBundle(_marketId: string): Promise<string> {
    throw new Error('本地目录市场尚未实现（P21-4 预留）')
  }
}

// 注册表（未来 addMarket(new GithubDirectoryMarket(...))）
const markets = new Map<string, MarketProvider>()
export function registerMarket(m: MarketProvider): void {
  markets.set(m.id, m)
}
export function listMarkets(): Array<{ id: string; label: string }> {
  return [...markets.values()].map((m) => ({ id: m.id, label: m.label }))
}

// ---------- 自包含导出/导入（P21-4） ----------

export interface SolutionBundle {
  app: 'AI-Novel-Studio'
  kind: 'solution'
  schemaVersion: 1
  exportedAt: string
  solution: {
    name: string
    description: string
    primaryAgentName?: string | null
    // v0.15.0：方案建议约束（随方案沉淀用户强调的事项）
    suggestedConstraints?: string[]
    steps: Array<Omit<SolutionStep, 'agentId'> & { agentName: string }>
  }
  agents: Array<{
    name: string
    role: string
    description: string
    system_prompt: string
    body_md: string
    skills: string[]
  }>
  skills: Array<{ name: string; description: string; body_md: string }>
}

// v0.11.0（批C/I3）：方案包（可移植创作资产 + 市场基础）——solution-pack 格式
// manifest 惯例（D83，对照 npm package.json）：name+version 唯一标识、变更必 bump version、
// 小写 kebab-case id、description/tags 为发现性字段
export interface SolutionPack {
  app: 'AI-Novel-Studio'
  kind: 'solution-pack'
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  exportedAt: string
  schemaVersion: 1
  metrics: {
    stepCount: number
    agentCount: number
    wholeBook: boolean
  }
  solution: SolutionBundle['solution']
  agents: SolutionBundle['agents']
  skills: SolutionBundle['skills']
  // v0.15.0：方案建议约束（导入时提示可应用——用户强调的事项随方案沉淀）
  suggestedConstraints?: string[]
  sampleBook?: {
    title: string
    worldSummary: string
    characterSummary: string
    chapters: Array<{ title: string; excerpt: string }>
  }
}

function kebabId(name: string): string {
  const hash = (s: string): string => {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
    return h.toString(36).slice(0, 6)
  }
  const kebab = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  // 中文等非拉丁名 → 退化占位 + hash 保证唯一（D83：id 小写 kebab-case、URL 安全）
  return (kebab || 'sol') + '-' + hash(name)
}

/** 样例快照：所选书 1-2 章正文片段 + 世界观/角色摘要 */
function buildSampleBook(db: DatabaseSync, novelId: number): SolutionPack['sampleBook'] {
  const novel = db.prepare('SELECT title, framing_json FROM novel WHERE id = ?').get(novelId) as
    | { title: string; framing_json: string }
    | undefined
  if (!novel) return undefined
  const chapters = db
    .prepare(
      "SELECT title, content FROM chapter WHERE novel_id = ? AND content != '' AND status IN ('written','reviewed','done') ORDER BY id LIMIT 2"
    )
    .all(novelId) as Array<{ title: string; content: string }>
  if (chapters.length === 0) return undefined
  const world = db
    .prepare('SELECT manual_json, factions_json FROM world WHERE novel_id = ?')
    .get(novelId) as { manual_json: string; factions_json: string } | undefined
  const chars = db
    .prepare("SELECT name, profile_json FROM character WHERE novel_id = ? AND status = 'roster' LIMIT 5")
    .all(novelId) as Array<{ name: string; profile_json: string }>
  return {
    title: novel.title || '未命名',
    worldSummary: [
      ...Object.entries(JSON.parse(world?.manual_json ?? '{}') as Record<string, unknown>).map(
        ([k, v]) => `${k}：${typeof v === 'string' ? v : JSON.stringify(v)}`
      ),
      ...((JSON.parse(world?.factions_json ?? '[]') as Array<{ name: string; desc: string }>).map(
        (f) => `势力 ${f.name}：${f.desc}`
      ))
    ]
      .slice(0, 6)
      .join('\n'),
    characterSummary: chars.map((c) => `${c.name}：${String(JSON.parse(c.profile_json || '{}').desc ?? '').slice(0, 60)}`).join('\n'),
    chapters: chapters.map((c) => ({ title: c.title || '未命名章节', excerpt: c.content.slice(0, 800) }))
  }
}

/** 方案 + 依赖资产导出为自包含方案包（solution-pack，市场格式；向后兼容旧 bundle 导入） */
export function exportSolutionBundle(
  db: DatabaseSync,
  id: number,
  opts: { sample?: { novelId: number } } = {}
): string {
  const sol = loadSolution(db, id)
  if (!sol) throw new Error('solution not found')
  const agentIds = new Set(sol.steps.map((s) => s.agentId))
  if (sol.primaryAgentId) agentIds.add(sol.primaryAgentId)
  const agents: SolutionBundle['agents'] = []
  const skillNames = new Set<string>()
  for (const aid of agentIds) {
    const row = db.prepare('SELECT * FROM agent WHERE id = ?').get(aid) as
      | Record<string, unknown>
      | undefined
    if (!row) continue
    const skills = (JSON.parse(String(row.skills_json ?? '[]')) as string[]) ?? []
    for (const sk of skills) skillNames.add(sk)
    agents.push({
      name: String(row.name),
      role: String(row.role),
      description: String(row.description ?? ''),
      system_prompt: String(row.system_prompt),
      body_md: String(row.body_md ?? ''),
      skills
    })
  }
  const skills: SolutionBundle['skills'] = []
  for (const sk of skillNames) {
    const skillRow = db.prepare('SELECT * FROM skill WHERE name = ? ORDER BY id LIMIT 1').get(sk) as
      | Record<string, unknown>
      | undefined
    skills.push({
      name: sk,
      description: String(skillRow?.description ?? ''),
      body_md: String(skillRow?.body_md ?? '')
    })
  }
  const primaryAgent = sol.primaryAgentId
    ? (db.prepare('SELECT name FROM agent WHERE id = ?').get(sol.primaryAgentId) as
        | { name: string }
        | undefined)
    : undefined
  const bundle: SolutionBundle = {
    app: 'AI-Novel-Studio',
    kind: 'solution',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    solution: {
      name: sol.name,
      description: sol.description,
      primaryAgentName: primaryAgent?.name ?? null,
      steps: sol.steps.map((s) => {
        const agentName = agents.find((a) => a.name === undefined) // 占位，下面重映射
        void agentName
        return { ...s, agentName: '' }
      })
    },
    agents,
    skills
  }
  // steps 的 agentName 需按 id 反查
  const nameById = new Map<number, string>()
  for (const aid of agentIds) {
    const row = db.prepare('SELECT name FROM agent WHERE id = ?').get(aid) as { name: string } | undefined
    if (row) nameById.set(aid, row.name)
  }
  bundle.solution.steps = sol.steps.map((s) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { agentId, ...rest } = s
    void agentId
    return { ...rest, agentName: nameById.get(s.agentId) ?? `agent-${s.agentId}` }
  })

  // v0.11.0（批C/I3）：包装为 solution-pack（市场格式）——旧 kind:'solution' 导入仍兼容
  const pack: SolutionPack = {
    app: 'AI-Novel-Studio',
    kind: 'solution-pack',
    id: kebabId(sol.name),
    name: sol.name,
    description: sol.description,
    version: `1.0.0`,
    tags: [],
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    metrics: {
      stepCount: sol.steps.length,
      agentCount: agents.length,
      wholeBook: sol.steps.some((s) => s.stage === 'whole_book')
    },
    solution: bundle.solution,
    agents: bundle.agents,
    skills: bundle.skills,
    // v0.15.0：建议约束随方案导出（编辑 bundle 或由导入透传而来）
    ...(bundle.solution.suggestedConstraints?.length
      ? { suggestedConstraints: bundle.solution.suggestedConstraints }
      : {}),
    ...(opts.sample?.novelId ? { sampleBook: buildSampleBook(db, opts.sample.novelId) } : {})
  }
  return JSON.stringify(pack, null, 2)
}

/** 导入 bundle / solution-pack（agent/skill 按名去重，创建新方案；返回方案 id + 样例摘要） */
export function importSolutionBundle(
  db: DatabaseSync,
  json: string
): { solutionId: number; name: string; version?: string; sampleBook?: SolutionPack['sampleBook'] } {
  const bundle = JSON.parse(json) as SolutionBundle | SolutionPack
  // v0.11.0（批C/I3）：兼容旧 kind:'solution' 与新 kind:'solution-pack'
  if (bundle.app !== 'AI-Novel-Studio' || (bundle.kind !== 'solution' && bundle.kind !== 'solution-pack')) {
    throw new Error('不是有效的方案导出文件')
  }
  // 1) skills
  const skillIdByName = new Map<string, number>()
  for (const sk of bundle.skills ?? []) {
    const existing = db.prepare('SELECT id FROM skill WHERE name = ? AND novel_id = 0').get(sk.name) as
      | { id: number }
      | undefined
    if (existing) {
      skillIdByName.set(sk.name, existing.id)
      continue
    }
    const rid = db
      .prepare('INSERT INTO skill (name, description, body_md, novel_id) VALUES (?, ?, ?, 0)')
      .run(sk.name, sk.description, sk.body_md)
    skillIdByName.set(sk.name, Number(rid.lastInsertRowid))
  }
  // 2) agents（按 role+name 去重）
  const agentIdByName = new Map<string, number>()
  for (const ag of bundle.agents ?? []) {
    const existing = db
      .prepare('SELECT id FROM agent WHERE name = ? LIMIT 1')
      .get(ag.name) as { id: number } | undefined
    if (existing) {
      agentIdByName.set(ag.name, existing.id)
      continue
    }
    const rid = db
      .prepare(
        "INSERT INTO agent (name, role, system_prompt, description, body_md, skills_json, tools_json, enabled, is_custom) VALUES (?, ?, ?, ?, ?, ?, '[]', 1, 1)"
      )
      .run(
        ag.name,
        ag.role ?? 'custom',
        ag.system_prompt ?? '',
        ag.description ?? '',
        ag.body_md ?? '',
        JSON.stringify(ag.skills ?? [])
      )
    agentIdByName.set(ag.name, Number(rid.lastInsertRowid))
  }
  // 3) solution
  const steps = (bundle.solution.steps ?? []).map((s) => {
    const agentId = agentIdByName.get(s.agentName) ?? null
    if (agentId === null) throw new Error(`方案引用未知智能体：${s.agentName}`)
    return {
      agentId,
      role: s.role,
      stage: s.stage,
      include: s.include,
      maxTokens: s.maxTokens,
      if: s.if ?? null,
      // v0.8.0（审查 #2）：导入保留 production——此前丢弃导致导出→导入往返丢配置
      production: s.production
    }
  })
  const primaryAgentId =
    bundle.solution.primaryAgentName != null ? (agentIdByName.get(bundle.solution.primaryAgentName) ?? null) : null
  const solutionId = createSolution(db, {
    name: bundle.solution.name,
    description: bundle.solution.description,
    primaryAgentId,
    steps
  })
  return {
    solutionId,
    name: bundle.solution.name,
    // v0.11.0（批C/I3）：solution-pack 元数据透传（前端展示；样例不进库）
    ...(bundle.kind === 'solution-pack'
      ? {
          version: bundle.version,
          sampleBook: (bundle as SolutionPack).sampleBook,
          // v0.15.0：方案建议约束透传（前端导入后提示可应用）
          ...(bundle.solution.suggestedConstraints?.length
            ? { suggestedConstraints: bundle.solution.suggestedConstraints }
            : {})
        }
      : {})
  }
}
