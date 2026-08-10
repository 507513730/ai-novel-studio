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

export async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    signal: init?.signal ?? AbortSignal.timeout(60_000),
    ...init
  })
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body
}

const base = getApiBaseUrl

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    signal: init?.signal ?? AbortSignal.timeout(60_000),
    ...init
  })
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body as T
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
    j(`/novels/${id}/directions`, { method: 'POST', body: JSON.stringify(directionId ? { directionId } : {}) }),
  titles: (id: number, direction: unknown): Promise<{ titles: string[] }> =>
    j(`/novels/${id}/titles`, { method: 'POST', body: JSON.stringify({ direction }) }),
  framing: (id: number, body: { title?: string; direction?: unknown; notes?: string }): Promise<{ framing: Record<string, unknown> }> =>
    j(`/novels/${id}/framing`, { method: 'POST', body: JSON.stringify(body) }),
  // P13 G7：字段级 AI 重写
  framingField: (id: number, field: string): Promise<{ framing: Record<string, unknown> }> =>
    j(`/novels/${id}/framing/field`, { method: 'POST', body: JSON.stringify({ field }) }),
  macro: (id: number): Promise<{ macro: Record<string, unknown> }> =>
    j(`/novels/${id}/macro`, { method: 'POST' }),
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
  worldGenerate: (id: number): Promise<{ manual: WorldData['manual']; factions: WorldData['factions']; map: WorldData['map'] }> =>
    j(`/novels/${id}/world/generate`, { method: 'POST' }),

  characters: (id: number): Promise<{ characters: CharacterData[] }> => j(`/novels/${id}/characters`),
  characterCreate: (id: number, body: { name: string; profile?: Record<string, string>; status?: string }): Promise<{ id: number }> =>
    j(`/novels/${id}/characters`, { method: 'POST', body: JSON.stringify(body) }),
  characterPatch: (id: number, charId: number, patch: Record<string, unknown>): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/characters/${charId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  characterDelete: (id: number, charId: number): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/characters/${charId}`, { method: 'DELETE' }),
  charactersGenerate: (id: number): Promise<{ characters: Array<Record<string, string>> }> =>
    j(`/novels/${id}/characters/generate`, { method: 'POST' }),

  volumes: (id: number): Promise<{ volumes: VolumeData[] }> => j(`/novels/${id}/volumes`),
  volumesGenerate: (id: number, chaptersPerVolume: number): Promise<{ volumes: unknown[] }> =>
    j(`/novels/${id}/volumes/generate`, { method: 'POST', body: JSON.stringify({ chaptersPerVolume }) }),
  // P13 G4：卷战略评审
  volumeCritique: (id: number, volId: number): Promise<{ critique: { score: number; risks: string[]; suggestion: string } }> =>
    j(`/novels/${id}/volumes/${volId}/critique`, { method: 'POST' }),
  volumeDelete: (id: number, volId: number): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/volumes/${volId}`, { method: 'DELETE' }),

  beats: (id: number, volId: number): Promise<{ beats: BeatData[] }> =>
    j(`/novels/${id}/volumes/${volId}/beats`),
  beatsGenerate: (id: number, volId: number): Promise<{ beats: unknown[] }> =>
    j(`/novels/${id}/volumes/${volId}/beats/generate`, { method: 'POST' }),

  chapters: (id: number): Promise<{ chapters: ChapterSummary[] }> => j(`/novels/${id}/chapters`),
  chapterDetail: (id: number, chapterId: number): Promise<{ chapter: ChapterSummary & { content: string } }> =>
    j(`/novels/${id}/chapters/${chapterId}`),
  chapterPatch: (id: number, chapterId: number, patch: Record<string, unknown>): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/chapters/${chapterId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  chaptersGenerate: (id: number, volId: number): Promise<{ chapters: unknown[] }> =>
    j(`/novels/${id}/volumes/${volId}/chapters/generate`, { method: 'POST' }),
  chapterRefine: (id: number, chapterId: number): Promise<{ goal: Record<string, unknown> }> =>
    j(`/novels/${id}/chapters/${chapterId}/refine`, { method: 'POST' }),
  // P12 A4：批量细化（范围 + 幂等续跑）
  refineRange: (id: number, from: number, to: number): Promise<{ done: number[]; skipped: number[] }> =>
    j(`/novels/${id}/chapters/refine-range`, { method: 'POST', body: JSON.stringify({ from, to }) }),

  review: (id: number, chapterId: number): Promise<{ review: Record<string, unknown> }> =>
    j(`/novels/${id}/chapters/${chapterId}/review`, { method: 'POST' }),
  aiAction: (
    id: number,
    chapterId: number,
    body: { action: string; selection?: string; instruction?: string; cursorPosition?: number }
  ): Promise<{ action: string; isInsert: boolean; content: string; appliedAt?: number }> =>
    j(`/novels/${id}/chapters/${chapterId}/ai-action`, { method: 'POST', body: JSON.stringify(body) }),
  contextPreview: (id: number, chapterId: number): Promise<{ sections: Array<{ key: string; label: string; chars: number; tokens: number }>; totalTokens: number; budgetLimit: number }> =>
    j(`/novels/${id}/chapters/${chapterId}/context-preview`),
  versions: (id: number, chapterId: number): Promise<{ versions: Array<{ id: number; note: string; createdAt: string; wordCount: number; preview: string }> }> =>
    j(`/novels/${id}/chapters/${chapterId}/versions`),
  createVersion: (id: number, chapterId: number, note?: string): Promise<{ versionId: number }> =>
    j(`/novels/${id}/chapters/${chapterId}/versions`, { method: 'POST', body: JSON.stringify({ note }) }),
  fix: (id: number, chapterId: number): Promise<{ fixed: boolean; round: number; content: string; rescore?: { score: number; needsFix: boolean; passed: boolean } }> =>
    j(`/novels/${id}/chapters/${chapterId}/fix`, { method: 'POST' }),
  backfill: (id: number, chapterId: number): Promise<Record<string, unknown>> =>
    j(`/novels/${id}/chapters/${chapterId}/backfill`, { method: 'POST' }),
  confirmState: (id: number, characterStates: Array<{ name: string; state: string }>): Promise<{ ok: boolean }> =>
    j(`/novels/${id}/confirm-state`, { method: 'POST', body: JSON.stringify({ characterStates }) }),
  pending: (id: number): Promise<{ pendingFacts: Array<{ id: number; content: string; chapter_id: number }>; pendingCharacters: Array<{ id: number; name: string; profile: Record<string, string> }> }> =>
    j(`/novels/${id}/pending`)
}

export const automationApi = {
  directorRun: (id: number, mode: 'auto' | 'supervised', chaptersPerVolume: number): Promise<{ jobId: number }> =>
    j(`/novels/${id}/director/run`, { method: 'POST', body: JSON.stringify({ mode, chaptersPerVolume }) }),
  directorResume: (id: number): Promise<{ jobId: number; resumedFrom: string }> =>
    j(`/novels/${id}/director/resume`, { method: 'POST' }),
  directorCancel: (id: number): Promise<{ cancelled: boolean }> =>
    j(`/novels/${id}/director/cancel`, { method: 'POST' }),
  directorStatus: (id: number): Promise<Record<string, unknown>> =>
    j(`/novels/${id}/director/status`),
  produce: (id: number, range?: { from?: number; to?: number }): Promise<{ jobId: number; pending: number }> =>
    j(`/novels/${id}/produce`, { method: 'POST', body: JSON.stringify(range ?? {}) }),
  novelStatus: (id: number): Promise<Record<string, unknown>> => j(`/novels/${id}/status`),
  jobs: (): Promise<{ jobs: Array<Record<string, unknown>> }> => j('/jobs'),
  hubChat: (id: number, message: string): Promise<{ reply: string; toolCalls: string[] }> =>
    j(`/novels/${id}/hub/chat`, { method: 'POST', body: JSON.stringify({ message }) })
}

export const hub = {
  chat: (id: number, message: string): Promise<{ reply: string; toolCalls: string[] }> =>
    j(`/novels/${id}/hub/chat`, { method: 'POST', body: JSON.stringify({ message }) })
}

export const analysisApi = {
  run: (id: number, depth: 'quick' | 'standard' | 'full'): Promise<{ report: Record<string, unknown> }> =>
    j(`/novels/${id}/analysis`, { method: 'POST', body: JSON.stringify({ depth }) }),
  list: (id: number): Promise<{ analyses: Array<{ id: number; depth: string; result: Record<string, unknown>; createdAt: string }> }> =>
    j(`/novels/${id}/analysis`),
  character: (id: number, name: string, depth: 'brief' | 'standard' | 'deep' | 'full'): Promise<{ profile: Record<string, unknown> }> =>
    j(`/novels/${id}/analysis/character`, { method: 'POST', body: JSON.stringify({ name, depth }) }),
  evolution: (id: number, name: string, coverage: string): Promise<{ evolution: Array<Record<string, unknown>> }> =>
    j(`/novels/${id}/analysis/evolution`, { method: 'POST', body: JSON.stringify({ name, coverage }) }),
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
    j(`/novels/${id}/style/external`, { method: 'POST', body: JSON.stringify({ title, content }) })
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
  knowledgeDelete: (id: number): Promise<{ ok: boolean }> => j(`/knowledge/${id}`, { method: 'DELETE' })
}

export const agentsApi = {
  list: (): Promise<{ agents: Array<{ id: number; name: string; role: string; systemPrompt: string; enabled: boolean }> }> =>
    j('/agents'),
  create: (body: { name: string; role?: string; systemPrompt: string }): Promise<{ id: number }> =>
    j('/agents', { method: 'POST', body: JSON.stringify(body) }),
  patch: (id: number, patch: Record<string, unknown>): Promise<{ ok: boolean }> =>
    j(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  teamReview: (id: number, chapterId: number): Promise<{ review: Record<string, unknown> }> =>
    j(`/novels/${id}/team/review`, { method: 'POST', body: JSON.stringify({ chapterId }) })
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
  include?: string[]
): Promise<void> {
  const params = include && include.length > 0 ? `?include=${include.join(',')}` : ''
  let accumulated = ''
  let res: Response
  try {
    res = await fetch(`${base()}/novels/${novelId}/chapters/${chapterId}/generate${params}`, {
      method: 'POST',
      signal
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
        const payload = JSON.parse(data) as Record<string, unknown>
        if (type === 'thinking') handlers.onThinking?.(String(payload.delta ?? ''))
        else if (type === 'delta') {
          const text = String(payload.text ?? '')
          accumulated += text
          handlers.onDelta?.(text)
        } else if (type === 'context') handlers.onContext?.(payload)
        else if (type === 'done') handlers.onDone?.(payload as never)
        else if (type === 'aborted') handlers.onAborted?.(payload as never)
        else if (type === 'error') handlers.onError?.(String(payload.message ?? '未知错误'))
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
