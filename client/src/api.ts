import type {
  BeatData,
  ChapterSummary,
  CharacterData,
  NovelDetail,
  NovelSummary,
  VolumeData,
  WorldData
} from './types'

let cachedBaseUrl: string | null = null

export function getApiBaseUrl(): string {
  if (cachedBaseUrl) return cachedBaseUrl
  return 'http://127.0.0.1:3000/api'
}

export function setApiBaseUrl(url: string): void {
  cachedBaseUrl = url
}

// P20（S1）：本地 API 鉴权 token（Electron renderer 经 preload 注入；浏览器调试为空则跳过）
export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (typeof window !== 'undefined') {
    const token = (window as unknown as { novelStudio?: { serverToken?: string } })?.novelStudio?.serverToken
    if (token) h['X-App-Token'] = token
  }
  return h
}

// P20（C3）：客户端超时分级——普通 30s；AI 同步长任务 120s（服务端 OpenAI 超时 120-300s）
const DEFAULT_TIMEOUT = 30_000
const LONG_TIMEOUT = 120_000

export async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  // v0.9.0（审查 M4）：合并 headers 而非覆盖——此前 `...init` 在 init.headers 存在时
  // 会整体覆盖 authHeaders()（丢 X-App-Token / Content-Type）
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT)
  })
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body
}

const base = getApiBaseUrl

async function j<T>(path: string, init?: RequestInit, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    headers: authHeaders(),
    signal: init?.signal ?? AbortSignal.timeout(timeout),
    ...init
  })
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body as T
}

// AI 长任务专用（120s 超时，防幻象失败）
function js<T>(path: string, init?: RequestInit): Promise<T> {
  return j<T>(path, init, LONG_TIMEOUT)
}

export const novelApi = {
  list: (): Promise<{ novels: NovelSummary[] }> => j('/novels'),
  create: (inspiration: string): Promise<{ id: number }> =>
    j('/novels', { method: 'POST', body: JSON.stringify({ inspiration }) }),
  detail: (id: number): Promise<{ novel: NovelDetail }> => j(`/novels/${id}`),
  patch: (id: number, patch: Record<string, unknown>): Promise<{ ok: boolean }> =>
    j(`/novels/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: number): Promise<{ ok: boolean }> => j(`/novels/${id}`, { method: 'DELETE' }),
  directions: (id: number, directionId?: string): Promise<{ directions: NovelDetail['direction'] }> =>
    js(`/novels/${id}/directions`, { method: 'POST', body: JSON.stringify(directionId ? { directionId } : {}) }),
  titles: (id: number, direction: unknown): Promise<{ titles: string[] }> =>
    js(`/novels/${id}/titles`, { method: 'POST', body: JSON.stringify({ direction }) }),
  framing: (id: number, body: { title?: string; direction?: unknown; notes?: string }): Promise<{ framing: Record<string, unknown> }> =>
    js(`/novels/${id}/framing`, { method: 'POST', body: JSON.stringify(body) }),
  // P13 G7：字段级 AI 重写
  framingField: (id: number, field: string): Promise<{ framing: Record<string, unknown> }> =>
    js(`/novels/${id}/framing/field`, { method: 'POST', body: JSON.stringify({ field }) }),
  macro: (id: number): Promise<{ macro: Record<string, unknown> }> =>
    js(`/novels/${id}/macro`, { method: 'POST' }),
  exportUrl: (id: number, format: 'txt' | 'md' | 'epub'): string =>
    `${base()}/novels/${id}/export?format=${format}`,

  // P11-3：流派管理
  genres: (novelId?: number): Promise<{ genres: Array<{ id: number; name: string; novelId: number | null; custom: boolean }> }> =>
    j(`/genres${novelId ? `?novelId=${novelId}` : ''}`),
  genreCreate: (name: string, novelId?: number): Promise<{ id: number; name: string }> =>
    j('/genres', { method: 'POST', body: JSON.stringify({ name, novelId: novelId ?? null }) }),

  // P12 A1：任务中心
  jobs: (): Promise<{ jobs: Array<{ id: number; type: string; status: string; progress: number; payload: Record<string, unknown>; result: Record<string, unknown>; error: string | null; createdAt: string }> }> =>
    j('/jobs'),
  jobRetry: (id: number, model?: string): Promise<{ ok: boolean }> =>
    j(`/jobs/${id}/retry`, { method: 'POST', body: JSON.stringify(model ? { model } : {}) }),
  jobCancel: (id: number): Promise<{ ok: boolean }> => j(`/jobs/${id}/cancel`, { method: 'POST' }),

  // P13 G1：换模型重试的模型清单（model-routes 去重）
  modelRoutes: (): Promise<{ routes: Array<{ model: string }> }> => j('/settings/model-routes'),

  world: (id: number): Promise<{ world: WorldData }> => j(`/novels/${id}/world`),
  worldPatch: (id: number, patch: Partial<WorldData>): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/world`, { method: 'PATCH', body: JSON.stringify(patch) }),
  worldGenerate: (id: number, guidance?: string): Promise<{ manual: WorldData['manual']; factions: WorldData['factions']; map: WorldData['map'] }> =>
    js(`/novels/${id}/world/generate`, { method: 'POST', body: guidance ? JSON.stringify({ guidance }) : undefined }),

  characters: (id: number): Promise<{ characters: CharacterData[] }> => j(`/novels/${id}/characters`),
  characterCreate: (id: number, body: { name: string; profile?: Record<string, string>; status?: string }): Promise<{ id: number }> =>
    j(`/novels/${id}/characters`, { method: 'POST', body: JSON.stringify(body) }),
  characterPatch: (id: number, charId: number, patch: Record<string, unknown>): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/characters/${charId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  characterDelete: (id: number, charId: number): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/characters/${charId}`, { method: 'DELETE' }),
  charactersGenerate: (id: number, guidance?: string): Promise<{ characters: Array<Record<string, string>> }> =>
    js(`/novels/${id}/characters/generate`, { method: 'POST', body: guidance ? JSON.stringify({ guidance }) : undefined }),

  volumes: (id: number): Promise<{ volumes: VolumeData[] }> => j(`/novels/${id}/volumes`),
  volumesGenerate: (id: number, chaptersPerVolume: number, guidance?: string): Promise<{ volumes: unknown[] }> =>
    js(`/novels/${id}/volumes/generate`, { method: 'POST', body: JSON.stringify({ chaptersPerVolume, guidance }) }),
  // P13 G4：卷战略评审
  volumeCritique: (id: number, volId: number): Promise<{ critique: { score: number; risks: string[]; suggestion: string } }> =>
    js(`/novels/${id}/volumes/${volId}/critique`, { method: 'POST' }),
  volumeDelete: (id: number, volId: number): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/volumes/${volId}`, { method: 'DELETE' }),
  // P23（N3）：手动创建卷
  volumeCreate: (id: number, title: string): Promise<{ id: number }> =>
    j(`/novels/${id}/volumes`, { method: 'POST', body: JSON.stringify({ title }) }),

  beats: (id: number, volId: number): Promise<{ beats: BeatData[] }> =>
    j(`/novels/${id}/volumes/${volId}/beats`),
  beatsGenerate: (id: number, volId: number, guidance?: string): Promise<{ beats: unknown[] }> =>
    js(`/novels/${id}/volumes/${volId}/beats/generate`, { method: 'POST', body: guidance ? JSON.stringify({ guidance }) : undefined }),

  chapters: (id: number): Promise<{ chapters: ChapterSummary[] }> => j(`/novels/${id}/chapters`),
  chapterDetail: (id: number, chapterId: number): Promise<{ chapter: ChapterSummary & { content: string } }> =>
    j(`/novels/${id}/chapters/${chapterId}`),
  chapterPatch: (id: number, chapterId: number, patch: Record<string, unknown>): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/chapters/${chapterId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  chaptersGenerate: (id: number, volId: number, guidance?: string): Promise<{ chapters: unknown[] }> =>
    js(`/novels/${id}/volumes/${volId}/chapters/generate`, { method: 'POST', body: guidance ? JSON.stringify({ guidance }) : undefined }),
  chapterRefine: (id: number, chapterId: number): Promise<{ goal: Record<string, unknown> }> =>
    js(`/novels/${id}/chapters/${chapterId}/refine`, { method: 'POST' }),
  // P12 A4：批量细化（范围 + 幂等续跑）
  refineRange: (id: number, from: number, to: number): Promise<{ done: number[]; skipped: number[] }> =>
    js(`/novels/${id}/chapters/refine-range`, { method: 'POST', body: JSON.stringify({ from, to }) }),

  review: (id: number, chapterId: number): Promise<{ review: Record<string, unknown> }> =>
    js(`/novels/${id}/chapters/${chapterId}/review`, { method: 'POST' }),
  aiAction: (
    id: number,
    chapterId: number,
    body: { action: string; selection?: string; instruction?: string; cursorPosition?: number }
  ): Promise<{ action: string; isInsert: boolean; content: string; appliedAt?: number }> =>
    js(`/novels/${id}/chapters/${chapterId}/ai-action`, { method: 'POST', body: JSON.stringify(body) }),
  contextPreview: (id: number, chapterId: number): Promise<{ sections: Array<{ key: string; label: string; chars: number; tokens: number }>; totalTokens: number; budgetLimit: number }> =>
    j(`/novels/${id}/chapters/${chapterId}/context-preview`),
  versions: (id: number, chapterId: number): Promise<{ versions: Array<{ id: number; note: string; createdAt: string; wordCount: number; preview: string }> }> =>
    j(`/novels/${id}/chapters/${chapterId}/versions`),
  createVersion: (id: number, chapterId: number, note?: string): Promise<{ versionId: number }> =>
    j(`/novels/${id}/chapters/${chapterId}/versions`, { method: 'POST', body: JSON.stringify({ note }) }),
  // v0.9.0：修复乱码注释（此前 P20 U1 注释为编码损坏）
  // P20（U1）：版本详情 / 恢复
  chapterVersionDetail: (id: number, chapterId: number, versionId: number): Promise<{ version: { id: number; content: string; note: string; created_at: string } }> =>
    j(`/novels/${id}/chapters/${chapterId}/versions/${versionId}`),
  chapterVersionRestore: (id: number, chapterId: number, versionId: number): Promise<{ content: string; wordCount: number }> =>
    js(`/novels/${id}/chapters/${chapterId}/versions/${versionId}/restore`, { method: 'POST' }),
  fix: (id: number, chapterId: number): Promise<{ fixed: boolean; round: number; content: string; rescore?: { score: number; needsFix: boolean; passed: boolean } }> =>
    js(`/novels/${id}/chapters/${chapterId}/fix`, { method: 'POST' }),
  backfill: (id: number, chapterId: number): Promise<Record<string, unknown>> =>
    js(`/novels/${id}/chapters/${chapterId}/backfill`, { method: 'POST' }),
  confirmState: (id: number, characterStates: Array<{ name: string; state: string }>): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/confirm-state`, { method: 'POST', body: JSON.stringify({ characterStates }) }),
  pending: (id: number): Promise<{ pendingFacts: Array<{ id: number; content: string; chapter_id: number }>; pendingCharacters: Array<{ id: number; name: string; profile: Record<string, string> }> }> =>
    j(`/novels/${id}/pending`)
}

export const automationApi = {
  directorRun: (id: number, mode: 'auto' | 'supervised', chaptersPerVolume: number): Promise<{ jobId: number }> =>
    js(`/novels/${id}/director/run`, { method: 'POST', body: JSON.stringify({ mode, chaptersPerVolume }) }),
  directorResume: (id: number): Promise<{ jobId: number; resumedFrom: string }> =>
    j(`/novels/${id}/director/resume`, { method: 'POST' }),
  directorCancel: (id: number): Promise<{ cancelled: boolean }> =>
    j(`/novels/${id}/director/cancel`, { method: 'POST' }),
  directorStatus: (id: number): Promise<Record<string, unknown>> =>
    j(`/novels/${id}/director/status`),
  produce: (id: number, range?: { from?: number; to?: number }): Promise<{ jobId: number; pending: number }> =>
    js(`/novels/${id}/produce`, { method: 'POST', body: JSON.stringify(range ?? {}) }),
  novelStatus: (id: number): Promise<Record<string, unknown>> => j(`/novels/${id}/status`),
  jobs: (): Promise<{ jobs: Array<Record<string, unknown>> }> => j('/jobs'),
  // P19 ③：清理已完成任务（保留 running）
  jobsClearDone: (): Promise<{ deleted: number }> => j('/jobs/done', { method: 'DELETE' }),
  hubChat: (id: number, message: string): Promise<{ reply: string; toolCalls: string[] }> =>
    js(`/novels/${id}/hub/chat`, { method: 'POST', body: JSON.stringify({ message }) }),
  // v0.10.0（批B/I2）：质量债自动修复
  debts: (id: number): Promise<{ pendingDebts: number }> => j(`/novels/${id}/debts`),
  debtsFix: (id: number): Promise<{ jobId: number }> => js(`/novels/${id}/debts/fix`, { method: 'POST' })
}


// P21：创造工坊 API（方案 / 技能 / 智能体 / 试运行 / 导入导出）
export const studioApi = {
  solutions: (): Promise<{ solutions: Array<Record<string, unknown>> }> => j('/solutions'),
  solutionDetail: (id: number): Promise<{ solution: Record<string, unknown> }> => j(`/solutions/${id}`),
  solutionCreate: (body: { name: string; description?: string; primaryAgentId?: number | null; steps?: Array<Record<string, unknown>> }): Promise<{ id: number }> =>
    js('/solutions', { method: 'POST', body: JSON.stringify(body) }),
  solutionPatch: (id: number, body: Record<string, unknown>): Promise<{ ok: boolean }> =>
    j(`/solutions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  solutionDelete: (id: number): Promise<{ ok: boolean }> => j(`/solutions/${id}`, { method: 'DELETE' }),
  solutionVersions: (id: number): Promise<{ versions: Array<Record<string, unknown>> }> => j(`/solutions/${id}/versions`),
  solutionRun: (id: number, novelId: number, chapterId: number, humanOverride?: Record<string, string>): Promise<{ run: Record<string, unknown>; summary: string }> =>
    js(`/solutions/${id}/run`, { method: 'POST', body: JSON.stringify({ novelId, chapterId, humanOverride }) }),
  solutionGenerate: (body: { description: string; genre?: string }): Promise<{ name: string; description: string; steps: Array<Record<string, unknown>> }> =>
    js('/solutions/generate', { method: 'POST', body: JSON.stringify(body) }),
  solutionProduceChapter: (id: number, novelId: number, chapterId: number): Promise<{ content: string; wordCount: number; title: string | null; degraded: boolean; outputs: Array<{ role: string; ok: boolean }> }> =>
    js(`/solutions/${id}/produce-chapter`, { method: 'POST', body: JSON.stringify({ novelId, chapterId }) }),
  solutionExport: (id: number): Promise<string> => j(`/solutions/${id}/export`),
  solutionImport: (bundle: string): Promise<{ solutionId: number; name: string }> =>
    js('/solutions/import', { method: 'POST', body: JSON.stringify({ bundle }) }),
  feelfishImport: (body: { agents: Array<string | { filename: string; content: string }>; solution?: { name: string; description?: string; agents: Array<{ id: string }>; primaryAgentId?: string | null }; primaryAgentId?: string | null }): Promise<{ id: number; name: string; agentCount: number }> =>
    js('/solutions/import-feelfish', { method: 'POST', body: JSON.stringify(body) }),
  skills: (): Promise<{ skills: Array<Record<string, unknown>> }> => j('/skills'),
  skillCreate: (body: { name: string; description?: string; body_md?: string }): Promise<{ id: number }> =>
    js('/skills', { method: 'POST', body: JSON.stringify(body) }),
  skillDelete: (id: number): Promise<{ ok: boolean }> => j(`/skills/${id}`, { method: 'DELETE' }),
  agentCreateCustom: (body: { name: string; description?: string; body_md?: string; skills?: string[] }): Promise<{ id: number }> =>
    js('/agents/custom', { method: 'POST', body: JSON.stringify(body) }),
  runTargets: (novelId: number): Promise<{ chapters: Array<{ id: number; title: string; status: string }> }> =>
    j(`/run-targets/${novelId}`)
}


// P23 批1：资产库统一（上传/粘贴/手动 → AI 提取 → 保存）
export const assetsApi = {
  importFile: (filename: string, base64: string, asChapters = false): Promise<{ title: string; text: string; chapters?: Array<{ title: string; content: string }>; chapterCount?: number }> =>
    js('/import/file', { method: 'POST', body: JSON.stringify({ filename, base64, asChapters }) }),
  extract: (type: string, text: string, title?: string): Promise<{ type: string; draft: Record<string, unknown> }> =>
    js('/assets/extract', { method: 'POST', body: JSON.stringify({ type, text, title }) }),
  knowledgeCreate: (body: { title: string; content: string; status?: string }): Promise<{ id: number }> =>
    js('/knowledge', { method: 'POST', body: JSON.stringify(body) }),
  worldTemplateCreate: (body: { name: string; manual?: Record<string, string>; factions?: string[]; map?: Record<string, string>; timeline?: string[] }): Promise<{ id: number }> =>
    js('/world-templates', { method: 'POST', body: JSON.stringify(body) }),
  genrePatch: (id: number, body: Record<string, unknown>): Promise<{ ok: boolean }> =>
    j(`/genres/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  antiAiAssetCreate: (body: { name: string; words: string[] }): Promise<{ id: number }> =>
    js('/anti-ai/assets', { method: 'POST', body: JSON.stringify(body) }),
  titlesGenerate: (body: { description: string; style?: string }): Promise<{ titles: Array<{ title: string; reason: string }> }> =>
    js('/titles/generate', { method: 'POST', body: JSON.stringify(body) }),
  baseCharacterCreate: (body: { name: string; profile?: Record<string, string> }): Promise<{ id: number }> =>
    js('/base-characters', { method: 'POST', body: JSON.stringify(body) }),
  styleAssetCreate: (body: { name: string; features: Array<{ category: string; name: string; description: string }>; antiAiWords?: string[]; sample?: string }): Promise<{ id: number }> =>
    js('/style-assets', { method: 'POST', body: JSON.stringify(body) }),
  importBook: (body: { title: string; chapters: Array<{ title: string; content: string }> }): Promise<{ id: number; chapterCount: number }> =>
    js('/import/book', { method: 'POST', body: JSON.stringify(body) }),
  chapterCreate: (novelId: number, body: { title?: string; volumeId?: number | null }): Promise<{ id: number }> =>
    js(`/novels/${novelId}/chapters`, { method: 'POST', body: JSON.stringify(body) }),
  promptCreate: (body: { name: string; template: string; notes?: string }): Promise<{ id: number }> =>
    js('/prompts', { method: 'POST', body: JSON.stringify(body) }),
  promptRestore: (id: number): Promise<{ ok: boolean }> => j(`/prompts/${id}/restore`, { method: 'POST' })
}

export const hub = {
  // v0.9.0（审查 #15）：支持 AbortSignal（HubChat 切换书/卸载时中止在途对话）
  chat: (id: number, message: string, signal?: AbortSignal): Promise<{ reply: string; toolCalls: string[] }> =>
    js(`/novels/${id}/hub/chat`, { method: 'POST', body: JSON.stringify({ message }), signal })
}

export const analysisApi = {
  run: (id: number, depth: 'quick' | 'standard' | 'full'): Promise<{ report: Record<string, unknown> }> =>
    js(`/novels/${id}/analysis`, { method: 'POST', body: JSON.stringify({ depth }) }),
  list: (id: number): Promise<{ analyses: Array<{ id: number; depth: string; result: Record<string, unknown>; createdAt: string }> }> =>
    js(`/novels/${id}/analysis`),
  character: (id: number, name: string, depth: 'brief' | 'standard' | 'deep' | 'full'): Promise<{ profile: Record<string, unknown> }> =>
    js(`/novels/${id}/analysis/character`, { method: 'POST', body: JSON.stringify({ name, depth }) }),
  evolution: (id: number, name: string, coverage: string): Promise<{ evolution: Array<Record<string, unknown>> }> =>
    js(`/novels/${id}/analysis/evolution`, { method: 'POST', body: JSON.stringify({ name, coverage }) }),
  publishKb: (id: number, analysisId: number): Promise<{ kbDocId: number }> =>
    j(`/novels/${id}/analysis/${analysisId}/publish-kb`, { method: 'POST' }),
  toStyle: (id: number, analysisId: number): Promise<{ styleAssetId: number }> =>
    j(`/novels/${id}/analysis/${analysisId}/to-style`, { method: 'POST' })
}

export const styleApi = {
  extract: (id: number, sample: string, name: string): Promise<{ features: Array<Record<string, unknown>> }> =>
    j(`/novels/${id}/style/extract`, { method: 'POST', body: JSON.stringify({ sample, name }) }),
  list: (id: number): Promise<{ assets: Array<{ id: number; name: string; features: Array<Record<string, unknown>>; antiAiWords: string[]; createdAt: string }> }> =>
    j(`/novels/${id}/style`),
  updateFeatures: (id: number, assetId: number, features: Array<Record<string, unknown>>): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/style/${assetId}`, { method: 'PATCH', body: JSON.stringify({ features }) }),  antiAiCheck: (id: number, text: string): Promise<{ hits: Array<{ word: string; count: number }>; total: number }> =>
    j(`/novels/${id}/style/anti-ai-check`, { method: 'POST', body: JSON.stringify({ text }) }),
  trial: (id: number, task: string): Promise<{ output: string; usedRules: string[] }> =>
    j(`/novels/${id}/style/trial`, { method: 'POST', body: JSON.stringify({ task }) }),
  external: (id: number, title: string, content: string): Promise<{ kbDocId: number }> =>
    j(`/novels/${id}/style/external`, { method: 'POST', body: JSON.stringify({ title, content }) }),
  // v0.14.0（批F/I5）：风格指纹（结构统计提取，无 LLM）
  fingerprint: (id: number, body: { name: string; text?: string; useNovel?: boolean }): Promise<{ id: number; description: string }> =>
    js(`/novels/${id}/style/fingerprint`, { method: 'POST', body: JSON.stringify(body) })
}

// P16 P1：反 AI 词库管理
export const antiAiApi = {
  list: (): Promise<{ assets: Array<{ id: number; name: string; type: string; words: string[] }> }> =>
    j('/novels/0/style/anti-ai/lexicon'),
  update: (id: number, words: string[]): Promise<{ ok: boolean }> =>
    j(`/novels/0/style/anti-ai/lexicon/${id}`, { method: 'PATCH', body: JSON.stringify({ words }) })
}

// P17-1：全局写法资产（/style-engine 全局页）
export const globalStyleApi = {
  list: (): Promise<{ assets: Array<{ id: number; novelId: number; name: string; global: boolean; novelTitle: string; features: Array<Record<string, unknown>> }> }> =>
    j('/novels/0/style/global'),
  create: (sample: string, name: string): Promise<{ features: Array<Record<string, unknown>> }> =>
    j('/novels/0/style/global', { method: 'POST', body: JSON.stringify({ sample, name }) }),
  importToNovel: (novelId: number, assetId: number): Promise<{ id: number }> =>
    j(`/novels/${novelId}/style/global/${assetId}/import`, { method: 'POST' })
}

// P17-2：资源页接口（推进模式库 / 世界样本库 / 知识库页）
export const resourcesApi = {
  storyModes: (): Promise<{ modes: Array<{ id: number; name: string; description: string; pattern: Record<string, unknown>; createdAt: string }> }> =>
    j('/story-modes'),
  storyModeCreate: (name: string, description: string, pattern: unknown): Promise<{ id: number }> =>
    j('/story-modes', { method: 'POST', body: JSON.stringify({ name, description, pattern }) }),
  storyModeDelete: (id: number): Promise<{ ok: boolean }> => j(`/story-modes/${id}`, { method: 'DELETE' }),
  worldTemplates: (): Promise<{ templates: Array<{ id: number; name: string; manual: Record<string, unknown>; factions: unknown[]; map: Record<string, unknown>; createdAt: string }> }> =>
    j('/world-templates'),
  worldTemplateFromNovel: (novelId: number, name: string): Promise<{ id: number }> =>
    j(`/world-templates/from-novel/${novelId}`, { method: 'POST', body: JSON.stringify({ name }) }),
  worldTemplateApply: (templateId: number, novelId: number): Promise<{ ok: boolean }> =>
    j(`/world-templates/${templateId}/apply/${novelId}`, { method: 'POST' }),
  worldTemplateDelete: (id: number): Promise<{ ok: boolean }> => j(`/world-templates/${id}`, { method: 'DELETE' }),
  knowledge: (): Promise<{ docs: Array<{ id: number; novelId: number; title: string; source: string; status: string; novelTitle: string; createdAt: string }> }> =>
    j('/knowledge'),
  knowledgeDelete: (id: number): Promise<{ ok: boolean }> => j(`/knowledge/${id}`, { method: 'DELETE' }),
  // P18 D1：基础角色模板库
  baseCharacters: (): Promise<{ templates: Array<{ id: number; name: string; profile: Record<string, unknown>; sourceNovelId: number | null; sourceTitle: string; createdAt: string }> }> =>
    j('/base-characters'),
  baseCharacterFromCharacter: (novelId: number, characterId: number): Promise<{ id: number }> =>
    j('/base-characters/from-character', { method: 'POST', body: JSON.stringify({ novelId, characterId }) }),
  baseCharacterApply: (templateId: number, novelId: number): Promise<{ id: number }> =>
    j(`/base-characters/${templateId}/apply`, { method: 'POST', body: JSON.stringify({ novelId }) }),
  baseCharacterDelete: (id: number): Promise<{ ok: boolean }> => j(`/base-characters/${id}`, { method: 'DELETE' })
}

export const agentsApi = {
  list: (): Promise<{ agents: Array<{ id: number; name: string; role: string; systemPrompt: string; description: string; bodyMd: string; skills: string[]; skillCount: number; enabled: boolean; custom: boolean }> }> =>
    j('/agents'),
  create: (body: { name: string; role?: string; systemPrompt: string }): Promise<{ id: number }> =>
    j('/agents', { method: 'POST', body: JSON.stringify(body) }),
  patch: (id: number, patch: Record<string, unknown>): Promise<{ ok: boolean }> =>
    j(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  // v0.9.0（审查 #12）：补 delete——此前缺失迫使页面裸 fetch（dev 下拿到 index.html 假成功"已删除"）
  remove: (id: number): Promise<{ ok: boolean }> => j(`/agents/${id}`, { method: 'DELETE' }),
  // P29：技能挂载/卸载（body_md 结构化智能体）
  skillAttach: (agentId: number, skillId: number): Promise<{ ok: boolean }> =>
    j(`/agents/${agentId}/skills`, { method: 'POST', body: JSON.stringify({ skillId }) }),
  skillDetach: (agentId: number, skillId: number): Promise<{ ok: boolean }> =>
    j(`/agents/${agentId}/skills/${skillId}`, { method: 'DELETE' }),
  createCustom: (body: { name: string; description?: string; body_md?: string }): Promise<{ id: number }> =>
    js('/agents/custom', { method: 'POST', body: JSON.stringify(body) }),
  teamReview: (id: number, chapterId: number): Promise<{ review: Record<string, unknown> }> =>
    js(`/novels/${id}/team/review`, { method: 'POST', body: JSON.stringify({ chapterId }) })
}

// SSE 流式生成
export interface GenerateHandlers {
  onThinking?: (text: string) => void
  onDelta?: (text: string) => void
  onDone?: (payload: { content: string; wordCount: number; usage: Record<string, number> }) => void
  onAborted?: (payload: { content: string; wordCount: number }) => void
  onError?: (message: string) => void
  onContext?: (payload: Record<string, unknown>) => void
}

export async function generateChapterSse(
  novelId: number,
  chapterId: number,
  handlers: GenerateHandlers,
  signal?: AbortSignal,
  include?: string[],
  guidance?: string
): Promise<void> {
  const params = include && include.length > 0 ? `?include=${include.join(',')}` : ''
  let accumulated = ''
  let res: Response
  try {
    res = await fetch(`${base()}/novels/${novelId}/chapters/${chapterId}/generate${params}`, {
      method: 'POST',
      headers: authHeaders(),
      signal,
      body: guidance ? JSON.stringify({ guidance }) : undefined
    })
  } catch (err) {
    // P2.2 修复 #2：AbortError（用户取消）→ onAborted；其他网络错误 → onError
    // P9 A2：fetch 阶段被取消 → 兜底携带累积内容（此时尚未收到任何流，accumulated 为空）
    if (signal?.aborted) {
      handlers.onAborted?.({ content: accumulated, wordCount: accumulated.length })
    } else {
      handlers.onError?.(err instanceof Error ? err.message : String(err))
    }
    return
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    handlers.onError?.(body?.error ?? `HTTP ${res.status}`)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const events = buf.split('\n\n')
      buf = events.pop() ?? ''
      for (const evt of events) {
        let type = 'message'
        let data = ''
        for (const line of evt.split('\n')) {
          if (line.startsWith('event: ')) type = line.slice(7)
          else if (line.startsWith('data: ')) data += line.slice(6)
        }
        if (!data) continue
        // P20（D1）：单事件解析失败只跳过该事件，不毁整个流（已生成内容保留）
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(data) as Record<string, unknown>
        } catch {
          console.warn('[sse] 忽略畸形事件:', type, data.slice(0, 80))
          continue
        }
        if (type === 'thinking') handlers.onThinking?.(String(payload.delta ?? ''))
        else if (type === 'delta') {
          const text = String(payload.text ?? '')
          accumulated += text
          handlers.onDelta?.(text)
        } else if (type === 'context') handlers.onContext?.(payload)
        // v0.9.0（审查 M4）：结构校验替代 as never——服务端降级路径省略 usage 时不再 TypeError
        else if (type === 'done') {
          handlers.onDone?.({
            content: String(payload.content ?? ''),
            wordCount: Number(payload.wordCount ?? 0),
            usage: {
              cacheHit: Number((payload.usage as { cacheHit?: unknown } | undefined)?.cacheHit ?? 0)
            }
          })
        } else if (type === 'aborted') {
          handlers.onAborted?.({
            content: String(payload.content ?? ''),
            wordCount: Number(payload.wordCount ?? 0)
          })
        } else if (type === 'error') handlers.onError?.(String(payload.message ?? '未知错误'))
      }
    }
  } catch (err) {
    // P2.2 修复 #2：读取中断（用户取消或连接断开）
    // P9 A2：abort 后客户端停止读取，服务端 aborted 事件收不到 → 兜底携带已累积内容
    if (signal?.aborted) {
      handlers.onAborted?.({ content: accumulated, wordCount: accumulated.length })
    } else {
      handlers.onError?.(err instanceof Error ? err.message : String(err))
    }
  }
}
