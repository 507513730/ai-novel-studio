import OpenAI from 'openai'
import { DatabaseSync } from 'node:sqlite'
import { callLlm } from './llm/caller'
import type { LlmMessage } from './llm/types'
import { getRouteConfig } from './llm/routes'
import { directorProgress } from './director/checkpoint'
import { generateChapter } from './chapterGeneration/orchestrator'
import { enqueueDirectorJob } from './jobs/repository'

// ============================================================
// Creative Hub（PLAN §7.5 / P2 简化版）
// 对话中枢 + Planner（意图路由到导演/章节工具）+ Tool Registry
// + Runtime（工具调用循环）+ reasoning_content 回传（D1 硬约束）
// ============================================================

// P2.1 🟡8：动态书卡（注入书名/流派/状态，减少工具轮数）
export function buildHubSystemPrompt(db: DatabaseSync, novelId: number): string {
  const novel = db.prepare('SELECT title, genre, framing_json, inspiration FROM novel WHERE id = ?').get(novelId) as
    | { title: string; genre: string; framing_json: string; inspiration: string }
    | undefined
  const chapters = db
    .prepare("SELECT COUNT(*) AS c, SUM(CASE WHEN content != '' THEN 1 ELSE 0 END) AS written FROM chapter WHERE novel_id = ?")
    .get(novelId) as { c: number; written: number | null }
  const director = directorProgress(db, novelId)
  const framing = novel ? (JSON.parse(novel.framing_json || '{}') as { summary?: string }) : null

  const bookCard = [
    `【本书速览】`,
    `书名：${novel?.title ?? '未命名'}`,
    `流派：${novel?.genre || '未选择'}`,
    `灵感：${novel?.inspiration ?? ''}`,
    framing?.summary ? `梗概：${String(framing.summary).slice(0, 200)}` : '',
    `章节：${chapters.c}（已写 ${chapters.written ?? 0}）`,
    `导演：${director ? `${director.checkpoint.displayStatus}` : '未启动'}`
  ]
    .filter(Boolean)
    .join('\n')

  return `你是 AI 小说创作工作台的创作中枢（Creative Hub）。你可以：
- 回答关于小说创作的问题
- 调用工具来推进创作（导演规划、生成章节、查看状态）
- 用自然语言向用户解释每一步做了什么

${bookCard}

工具调用规则：
- 需要推进创作时，主动调用相应工具
- 调用工具后，用简洁中文向用户说明结果
- 用户问"自动导演/开书/整本规划" → 调用 director_run
- 用户问"写第 X 章/生成正文" → 调用 chapter_generate
- 用户问"进度/状态" → 调用 novel_status 或 director_status
- **写操作（create_character/patch_chapter）返回 pending_approval 时，必须向用户说明拟执行的操作并征得确认；用户确认后再次调用同一工具执行**

始终以中文回复，语气像一位懂创作的资深编辑。`
}

export function truncateToolResult(text: string, max = 2000): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `…（已截断，共 ${text.length} 字符）`
}

interface HubTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  mutating?: boolean // P5-1：写操作标记 → 走审批节点
  run: (args: Record<string, unknown>, db: DatabaseSync, novelId: number) => Promise<string> | string
}

function toolsFor(_db: DatabaseSync): HubTool[] {
  return [
    {
      name: 'novel_status',
      description: '查看小说当前状态（章节数、角色数、导演进度）',
      parameters: { type: 'object', properties: {} },
      run: (_args, db2, novelId) => {
        const chapters = db2
          .prepare('SELECT COUNT(*) AS c, SUM(CASE WHEN content != \'\' THEN 1 ELSE 0 END) AS written FROM chapter WHERE novel_id = ?')
          .get(novelId) as { c: number; written: number | null }
        const chars = db2
          .prepare('SELECT COUNT(*) AS c FROM character WHERE novel_id = ?')
          .get(novelId) as { c: number }
        const vols = db2
          .prepare('SELECT COUNT(*) AS c FROM volume WHERE novel_id = ?')
          .get(novelId) as { c: number }
        const director = directorProgress(db2, novelId)
        return JSON.stringify({
          chapters: chapters.c,
          written: chapters.written ?? 0,
          characters: chars.c,
          volumes: vols.c,
          director: director
            ? { stage: director.checkpoint.displayStatus, status: director.status }
            : '未启动'
        })
      }
    },
    {
      name: 'director_run',
      description: '启动自动导演全流程（灵感→方向→世界→角色→卷→章节规划），mode=auto 全自动',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['auto', 'supervised'], description: 'auto=全自动，supervised=每阶段确认' }
        }
      },
      run: (args, db2, novelId) => {
        // P2.1 修复 #2：走 job 表 + scheduler（执行面隔离，防并发）
        const mode = (args.mode as 'auto' | 'supervised') ?? 'auto'
        const enqueued = enqueueDirectorJob(db2, novelId, { mode })
        if ('conflict' in enqueued) {
          return JSON.stringify({ error: '导演任务已在运行或排队中' })
        }
        return JSON.stringify({
          started: true,
          jobId: enqueued.jobId,
          mode,
          note: '导演已排队后台执行，可稍后查看进度'
        })
      }
    },
    {
      name: 'director_status',
      description: '查看自动导演当前进度',
      parameters: { type: 'object', properties: {} },
      run: (_args, db2, novelId) => {
        const d = directorProgress(db2, novelId)
        if (!d) return JSON.stringify({ status: '未启动', hint: '可调用 director_run 启动' })
        return JSON.stringify({
          status: d.status,
          stage: d.checkpoint.stage,
          display: d.checkpoint.displayStatus,
          progress: d.checkpoint.progress,
          replanCount: d.checkpoint.replanCount,
          blockingReason: d.checkpoint.blockingReason ?? null,
          resumeAction: d.checkpoint.resumeAction ?? null
        })
      }
    },
    {
      name: 'chapter_generate',
      description: '生成指定章节的正文（需先有章节清单）',
      parameters: {
        type: 'object',
        properties: { chapterId: { type: 'number', description: '章节 ID（可用 chapters_list 查询）' } },
        required: ['chapterId']
      },
      run: async (args, db2, novelId) => {
        const chapterId = Number(args.chapterId)
        const ch = db2.prepare('SELECT id, title FROM chapter WHERE id = ? AND novel_id = ?').get(chapterId, novelId) as
          | { id: number; title: string }
          | undefined
        if (!ch) return JSON.stringify({ error: `章节 ${chapterId} 不存在` })
        try {
          // v0.17.0（审查 H4）：超时经 AbortSignal 真实中断生成请求（僵尸请求不再继续烧 token）
          const result = (await runToolWithSignal(
            (signal) => generateChapter(db2, novelId, chapterId, { signal }),
            TOOL_TIMEOUT_MS
          )) as { wordCount: number; aborted: boolean }
          return JSON.stringify({
            chapter: ch.title,
            wordCount: result.wordCount,
            ok: result.wordCount > 200,
            note: result.aborted ? '生成被中止' : '生成完成'
          })
        } catch (err) {
          // v0.17.0（审查 H4）：失败复位（generateChapter 已自复位，此处双保险防绕过）
          db2.prepare(
            "UPDATE chapter SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'generating'"
          ).run(chapterId)
          return JSON.stringify({ error: `生成失败: ${err instanceof Error ? err.message : String(err)}` })
        }
      }
    },
    {
      name: 'chapters_list',
      description: '列出小说全部章节',
      parameters: { type: 'object', properties: {} },
      run: (_args, db2, novelId) => {
        const rows = db2
          .prepare('SELECT id, title, status, word_count FROM chapter WHERE novel_id = ? ORDER BY id')
          .all(novelId) as Array<{ id: number; title: string; status: string; word_count: number }>
        return JSON.stringify(rows.map((r) => ({ id: r.id, title: r.title, status: r.status, words: r.word_count })))
      }
    },
    {
      // P5-1：写工具（建角色）——mutating，需用户确认后再次调用才执行
      name: 'create_character',
      description: '创建新角色（写操作，需用户确认）',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '角色名' },
          role: { type: 'string', description: '角色定位（主角/配角/反派）' },
          identity: { type: 'string', description: '身份' },
          personality: { type: 'string', description: '性格' },
          goal: { type: 'string', description: '目标' }
        },
        required: ['name']
      },
      mutating: true,
      run: (args, db2, novelId) => {
        const name = String(args.name ?? '').trim()
        if (!name) return JSON.stringify({ error: '角色名必填' })
        const result = db2
          .prepare(
            'INSERT INTO character (novel_id, name, profile_json, status) VALUES (?, ?, ?, ?)'
          )
          .run(
            novelId,
            name,
            JSON.stringify({
              role: String(args.role ?? ''),
              identity: String(args.identity ?? ''),
              personality: String(args.personality ?? ''),
              goal: String(args.goal ?? '')
            }),
            'pending'
          )
        return JSON.stringify({ ok: true, characterId: Number(result.lastInsertRowid), name, note: '已创建（待确认状态）' })
      }
    },
    {
      // P5-1：写工具（改章节标题/摘要）——mutating
      name: 'patch_chapter',
      description: '修改章节标题或摘要（写操作，需用户确认）',
      parameters: {
        type: 'object',
        properties: {
          chapterId: { type: 'number', description: '章节 ID' },
          title: { type: 'string', description: '新标题（可选）' },
          summary: { type: 'string', description: '新摘要（可选）' }
        },
        required: ['chapterId']
      },
      mutating: true,
      run: (args, db2, novelId) => {
        const chapterId = Number(args.chapterId)
        if (!Number.isInteger(chapterId) || chapterId <= 0) return JSON.stringify({ error: '章节 ID 无效' })
        const exists = db2
          .prepare('SELECT id FROM chapter WHERE id = ? AND novel_id = ?')
          .get(chapterId, novelId) as { id: number } | undefined
        if (!exists) return JSON.stringify({ error: `章节 ${chapterId} 不存在` })
        const sets: string[] = []
        const params: Array<string | number> = []
        if (typeof args.title === 'string' && args.title.trim()) {
          sets.push('title = ?')
          params.push(args.title.trim())
        }
        if (typeof args.summary === 'string' && args.summary.trim()) {
          sets.push('summary = ?')
          params.push(args.summary.trim())
        }
        if (sets.length === 0) return JSON.stringify({ error: 'title 或 summary 至少填一个' })
        sets.push("updated_at = datetime('now')")
        db2.prepare(`UPDATE chapter SET ${sets.join(', ')} WHERE id = ? AND novel_id = ?`).run(
          ...params,
          chapterId,
          novelId
        )
        return JSON.stringify({ ok: true, chapterId, note: '已修改' })
      }
    },
    {
      // P21-3：创作方案执行（hub 对话可触发；非 mutating——方案步骤可能含写操作需另行确认）
      name: 'run_solution',
      description: '对指定章节运行一个创作方案（agent 流水线），返回每步输出。先查 chapters_list 获取章节 id。',
      parameters: {
        type: 'object',
        properties: {
          solutionId: { type: 'number', description: '方案 ID（可先查 solutions）' },
          chapterId: { type: 'number', description: '章节 ID' }
        },
        required: ['solutionId', 'chapterId']
      },
      run: async (args, db2, novelId) => {
        const solutionId = Number(args.solutionId)
        const chapterId = Number(args.chapterId)
        if (!Number.isInteger(solutionId) || solutionId <= 0 || !Number.isInteger(chapterId) || chapterId <= 0) {
          return JSON.stringify({ error: '参数无效' })
        }
        const chapter = db2
          .prepare('SELECT id FROM chapter WHERE id = ? AND novel_id = ?')
          .get(chapterId, novelId) as { id: number } | undefined
        if (!chapter) return JSON.stringify({ error: `章节 ${chapterId} 不存在` })
        try {
          const { runSolutionById, summarizeRun } = await import('./solutionRunner')
          const run = await runSolutionById(db2, solutionId, novelId, chapterId)
          return JSON.stringify({
            ok: true,
            solutionId,
            degraded: run.degraded,
            degradedReasons: run.degradedReasons,
            outputs: run.outputs.map((o) => ({ role: o.role, ok: o.ok, output: o.output.slice(0, 500) })),
            summary: summarizeRun(run).slice(0, 2000)
          })
        } catch (err) {
          return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
  ]
}

export interface HubMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  reasoningContent?: string
  toolCallId?: string
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
}

export interface HubSession {
  id: number
  agentId: number | null
  novelId: number
  messages: HubMessage[]
  context: Record<string, unknown> // P5-1：审批提案存储
}

export function getOrCreateSession(db: DatabaseSync, novelId: number): HubSession {
  const row = db
    .prepare('SELECT id, agent_id, novel_id, messages_json, context_json FROM agent_session WHERE novel_id = ? ORDER BY id DESC LIMIT 1')
    .get(novelId) as { id: number; agent_id: number | null; novel_id: number; messages_json: string; context_json: string } | undefined
  if (row) {
    return {
      id: row.id,
      agentId: row.agent_id,
      novelId: row.novel_id,
      messages: JSON.parse(row.messages_json),
      context: JSON.parse(row.context_json || '{}')
    }
  }
  const result = db
    .prepare("INSERT INTO agent_session (agent_id, novel_id, messages_json, context_json) VALUES (NULL, ?, '[]', '{}')")
    .run(novelId)
  return { id: Number(result.lastInsertRowid), agentId: null, novelId, messages: [], context: {} }
}

export function saveSession(db: DatabaseSync, session: HubSession): void {
  db.prepare(
    'UPDATE agent_session SET messages_json = ?, context_json = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(JSON.stringify(session.messages.slice(-40)), JSON.stringify(session.context), session.id)
}

const MAX_TOOL_ROUNDS = 4
const HUB_TIMEOUT_MS = 180_000
// P20（M5）：工具调用级超时（长工具不拖死整体；generate 底层 300s 被收窄）
const TOOL_TIMEOUT_MS = 150_000
// P20（M5）：同一小说会话串行锁（并发 chat 请求排队，消息流不穿插）
const sessionLocks = new Set<number>()

// v0.17.0（审查 H4）：生成类工具超时——abort 工厂式，真实中断底层 LLM 请求（Promise.race 只 reject 不取消，僵尸请求继续烧 token）
function runToolWithSignal(
  fn: (signal: AbortSignal) => Promise<unknown>,
  ms: number
): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return fn(ctrl.signal).finally(() => clearTimeout(timer))
}

// 非生成类工具（本地/快速）：Promise.race 兜底超时（无底层请求可中断）
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`tool timeout after ${ms}ms`)), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function hubChat(
  db: DatabaseSync,
  novelId: number,
  userMessage: string
): Promise<{ reply: string; toolCalls: string[] }> {
  // P20（M5）：串行锁——同书并发请求直接提示（消息流穿插会导致模型上下文错乱）
  if (sessionLocks.has(novelId)) {
    return { reply: '（当前会话正在处理上一条指令，请稍候再试）', toolCalls: [] }
  }
  sessionLocks.add(novelId)
  try {
    return await doHubChat(db, novelId, userMessage)
  } finally {
    sessionLocks.delete(novelId)
  }
}

async function doHubChat(
  db: DatabaseSync,
  novelId: number,
  userMessage: string
): Promise<{ reply: string; toolCalls: string[] }> {
  const session = getOrCreateSession(db, novelId)
  session.messages.push({ role: 'user', content: userMessage })

  const route = getRouteConfig(db, 'chat')
  if (!route || !route.apiKeyEncrypted) throw new Error('chat 路由未配置 API Key')

  const tools = toolsFor(db)
  const openaiTools = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  })) as OpenAI.Chat.Completions.ChatCompletionTool[]

  const executedTools: string[] = []
  let rounds = 0
  // P2.1 🟢11：整体超时
  const deadline = Date.now() + HUB_TIMEOUT_MS

  while (rounds < MAX_TOOL_ROUNDS) {
    if (Date.now() > deadline) {
      saveSession(db, session)
      return { reply: '（对话超时，请重试）', toolCalls: executedTools }
    }
    rounds++
    // 组装 messages（含 reasoning_content 回传，D1 硬约束）
    const messages: LlmMessage[] = [
      { role: 'system', content: buildHubSystemPrompt(db, novelId) },
      ...session.messages.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool' as const, content: m.content, toolCallId: m.toolCallId }
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content,
          reasoningContent: m.reasoningContent,
          toolCalls: m.toolCalls
        }
      })
    ]

    const result = await callLlm(db, 'chat', {
      novelId,
      messages,
      tools: openaiTools,
      maxTokens: 4096
    })

    const assistantMsg: HubMessage = {
      role: 'assistant',
      content: result.content,
      reasoningContent: result.reasoningContent,
      toolCalls: result.toolCalls
    }
    session.messages.push(assistantMsg)

    if (!result.toolCalls || result.toolCalls.length === 0) {
      saveSession(db, session)
      return { reply: result.content, toolCalls: executedTools }
    }

    // 执行工具
    for (const call of result.toolCalls) {
      const fn = (call as unknown as { function?: { name: string; arguments: string } }).function
      if (!fn) continue
      const tool = tools.find((t) => t.name === fn.name)
      if (!tool) {
        session.messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({ error: `unknown tool: ${fn.name}` })
        })
        continue
      }
      executedTools.push(tool.name)
      let out: string
      try {
        const args = JSON.parse(fn.arguments ?? '{}') as Record<string, unknown>
        // P5-1 审批节点：mutating 工具第一次调用 → 存提案待确认；用户确认后再次调用 → 执行
        // P20（M5）：pendingMutation 改队列（多个写工具提案互不覆盖）
        if (tool.mutating) {
          const pendingList = (session.context.pendingMutation ?? []) as Array<{
            tool: string
            args: Record<string, unknown>
          }>
          const idx = pendingList.findIndex((p) => p.tool === tool.name)
          if (idx < 0) {
            session.context.pendingMutation = [...pendingList, { tool: tool.name, args }]
            saveSession(db, session)
            out = JSON.stringify({
              status: 'pending_approval',
              tool: tool.name,
              args,
              note: '这是写操作。请向用户说明拟执行的操作，用户确认后再调用同一工具执行。'
            })
          } else {
            // 用户已确认（AI 再次调用）→ 执行并移除该提案
            session.context.pendingMutation = pendingList.filter((p) => p.tool !== tool.name)
            out = await withTimeout(Promise.resolve(tool.run(pendingList[idx].args, db, novelId)), TOOL_TIMEOUT_MS)
          }
        } else {
          out = await withTimeout(Promise.resolve(tool.run(args, db, novelId)), TOOL_TIMEOUT_MS)
        }
      } catch (err) {
        out = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      }
      // P2.1 🟢12：工具结果截断
      session.messages.push({ role: 'tool', toolCallId: call.id, content: truncateToolResult(out) })
    }
  }

  saveSession(db, session)
  return {
    reply: '（已达到工具调用轮数上限）',
    toolCalls: executedTools
  }
}
