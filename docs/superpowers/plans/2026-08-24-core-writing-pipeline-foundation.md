# 核心写书链基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 REST API、数据库结构或用户操作的前提下，建立章节生成的单一状态与持久化边界，并将 `generateChapter` 迁移为兼容编排入口。

**Architecture:** 以 `services/chapterGeneration/` 为垂直业务域：`state.ts` 管理章节抢占与终态恢复，`persistence.ts` 管理正文/版本/计数的一次性事务，`postProcess.ts` 保留已有文本变换语义，`orchestrator.ts` 仅协调 LLM、上下文和这些领域服务。原 `generate.ts` 保持其导出签名，只转发至 orchestrator，以保证 SSE、整本生产和现有测试不需要改 REST 契约。

**Tech Stack:** TypeScript 5.9、Vitest 3、node:sqlite `DatabaseSync`（`prepare/get/run` 与 `exec('BEGIN/COMMIT/ROLLBACK')`）、Zod 4、现有 OpenAI SDK 7。

---

## 范围和后续计划

本计划只覆盖“批次 0 + 批次 1”：审查/文档基线和章节生成域。以下独立子系统必须在本计划完成、验证并获得下一次批准后分别立项，避免跨域大提交：

| 后续计划文件 | 范围 |
|---|---|
| `2026-08-24-job-scheduler-refactor.md` | job repository、payload、watchdog、执行器映射与重启恢复 |
| `2026-08-24-director-production-refactor.md` | 导演 artifact/checkpoint/stage 与整本生产策略 |
| `2026-08-24-server-routes-context-llm-refactor.md` | routes、context、LLM 和薄 DAO 边界 |
| `2026-08-24-client-electron-refactor.md` | ChapterExecutionPage、其他客户端热点与 Electron main |
| `2026-08-24-documentation-architecture.md` | 文档信息架构、索引、校验脚本和历史分卷 |

## 当前代码定位

- `server/src/services/generate.ts:32`：单一函数同时完成抢占、LLM 调用、正文更新、版本快照、计数、约束和失败恢复。
- `server/src/services/generate.ts:127`：正文在反 AI 重写前写入版本，`generate.ts:198` 又可能写入不同的最终正文；版本内容可能不是最终落库正文。
- `server/src/services/generate.ts:44`：抢占 SQL 正确，但“前状态快照”与恢复逻辑藏在编排函数内。
- `server/src/services/generate.ts:234`：仅 `ConfigError` 恢复原状态，其他异常置 `failed`；必须抽成可直接测试的状态规则。
- `server/src/services/production.ts:1`：整本生产通过 `generateChapter` 使用生成链，因此兼容导出不可改变。
- `tests/config-circuit.test.ts:64`：已有 ConfigError 回到 `planned` 的回归测试，但缺少抢占、普通失败、最终版本内容和一次性持久化契约。
- `docs/README.md:7`：错误地将 AI 协作者手册归类为新用户教程，并在第 36 行把当前 PLAN 误写为历史。
- `README.md:94` 与 `README.en.md:91`：E2E 描述仍写 T1-T4，已和 AGENTS 的 T1-T5 门禁不一致。
- `docs/AI-AGENT-ONBOARDING.md:14` 的写书进度已落后 `PLAN.md:20` 的当前状态。

## Task 1: 固化文档基线和查证结论

**Files:**

- Modify: `docs/README.md:7-39`
- Modify: `README.md:94`
- Modify: `README.en.md:91`
- Modify: `docs/AI-AGENT-ONBOARDING.md:14`
- Modify: `docs/decision-log.md`（追加 D107）
- Create: `docs/superpowers/audits/2026-08-24-document-baseline.md`

- [ ] **Step 1: 在实施前查证 node:sqlite 的事务与 busy timeout 行为，并把结论写为 D107**

访问 Node.js 官方 `node:sqlite` 文档，确认 `DatabaseSync` 的 `exec()`、`prepare().run()`、`timeout` 和 `enableForeignKeyConstraints` 行为。D107 必须包含来源 URL、访问日期、以下结论和本批影响：

```markdown
### D107 · 2026-08-24 · 章节生成持久化事务边界

- 查证：Node.js `node:sqlite` API（<official-url>，访问于 2026-08-24）。
- 结论：本批只使用 `DatabaseSync.prepare().get/run` 与 `exec('BEGIN'/'COMMIT'/'ROLLBACK')`；不使用 SQLTagStore、自定义函数、Session 或 extension API。
- 结论：`DatabaseSync` 实例继续显式设置 `timeout: 5000` 与外键约束；正文、版本、字数与 status 必须在同一短事务内完成。
- 影响：`chapterGeneration/persistence.ts` 不改变表结构，不在事务中执行 LLM 或网络 I/O。
```

- [ ] **Step 2: 写入会失败的文档基线断言**

在 `docs/superpowers/audits/2026-08-24-document-baseline.md` 建立可验证清单；先运行以下 PowerShell 命令并记录它会命中的旧文本：

```powershell
Select-String -LiteralPath 'docs/README.md' -Pattern 'PLAN.md.*历史|AI-AGENT-ONBOARDING.*教程'
Select-String -LiteralPath 'README.md','README.en.md' -Pattern 'T1.*T4'
Select-String -LiteralPath 'docs/AI-AGENT-ONBOARDING.md' -Pattern '卷 72 荒域初鸣.*11 章'
```

预期：四项均至少命中一次，证明基线漂移真实存在。

- [ ] **Step 3: 最小化修正文档事实，不重写历史归档**

应用以下内容方向：

```markdown
<!-- docs/README.md -->
| [AI-AGENT-ONBOARDING.md](AI-AGENT-ONBOARDING.md) | AI 协作者工作流与验证门禁（协作者入口，不是用户教程） |

<!-- 使用顺序 -->
2. 新入项目开发 → `PLAN.md`（当前状态）+ `docs/archive/PLAN-history.md`（历史）+ `versioning.md`（流程）+ `AGENTS.md`（纪律）

<!-- 两个 README -->
- `node scripts/e2e/round.mjs <n>`：全功能 e2e（T1 配置 / T2 创作链 / T3 资产 / T4 导演 / T5 功能回归）
```

将 onboarding §14 的真实写书进度改为与 `PLAN.md` 当前主线完全一致的事实，且不复制不存在于 PLAN 的章节数。

- [ ] **Step 4: 验证文档修复**

Run:

```powershell
node scripts/check-docs.mjs
node scripts/verify-docs.mjs
Select-String -LiteralPath 'docs/README.md' -Pattern 'PLAN.md.*历史|AI-AGENT-ONBOARDING.*教程'
Select-String -LiteralPath 'README.md','README.en.md' -Pattern 'T1.*T4'
```

Expected: 两个脚本退出 0；后三条命令不输出匹配结果。

- [ ] **Step 5: Commit**

```powershell
git add docs/README.md README.md README.en.md docs/AI-AGENT-ONBOARDING.md docs/decision-log.md docs/superpowers/audits/2026-08-24-document-baseline.md
git commit -m "docs: align documentation baseline with current workflow"
```

## Task 2: 为章节状态与持久化编写契约测试

**Files:**

- Create: `tests/chapter-generation.test.ts`
- Modify: `tests/config-circuit.test.ts:64-76`

- [ ] **Step 1: 新建失败测试，定义状态域的公共接口**

在 `tests/chapter-generation.test.ts` 先导入尚不存在的模块：

```ts
import {
  claimChapter,
  failClaimedChapter,
  type ClaimedChapter
} from '../server/src/services/chapterGeneration/state'
import { persistGeneratedChapter } from '../server/src/services/chapterGeneration/persistence'
```

使用与 `tests/config-circuit.test.ts` 相同的 `makeDb()` 和 `makeNovelWithChapters()` 辅助函数，并加入以下测试：

```ts
it('claimChapter 原子抢占并返回原状态；第二次抢占失败', () => {
  const claim = claimChapter(db, novelId, chapterId)
  expect(claim.previousStatus).toBe('planned')
  expect(db.prepare('SELECT status FROM chapter WHERE id = ?').get(chapterId)).toMatchObject({ status: 'generating' })
  expect(() => claimChapter(db, novelId, chapterId)).toThrow(/正在生成/)
})

it('配置错误恢复抢占前状态，普通错误置 failed', () => {
  const configClaim = claimChapter(db, novelId, chapterId)
  failClaimedChapter(db, configClaim, new ConfigError('缺少 key'))
  expect(readStatus(db, chapterId)).toBe('planned')

  const normalClaim = claimChapter(db, novelId, chapterId)
  failClaimedChapter(db, normalClaim, new Error('provider timeout'))
  expect(readStatus(db, chapterId)).toBe('failed')
})

it('persistGeneratedChapter 以最终正文同时写正文、版本、字数和 written', () => {
  const claim = claimChapter(db, novelId, chapterId)
  persistGeneratedChapter(db, claim, { content: '最终正文', aborted: false })
  expect(readChapter(db, chapterId)).toMatchObject({ content: '最终正文', wordCount: 4, aiWords: 4, humanWords: 0, status: 'written' })
  expect(readLatestVersion(db, chapterId)).toMatchObject({ content: '最终正文', note: 'AI 生成' })
})
```

`readStatus`、`readChapter` 和 `readLatestVersion` 必须定义在同一测试文件中，分别查询 `chapter.status`、`content/word_count/ai_words/human_words/status` 和最新 `chapter_version`。

- [ ] **Step 2: 运行新测试，确认因模块不存在而失败**

Run:

```powershell
pnpm vitest run tests/chapter-generation.test.ts
```

Expected: FAIL，错误为无法解析 `chapterGeneration/state` 与 `chapterGeneration/persistence`。

- [ ] **Step 3: 扩展现有 ConfigError 测试，锁定导出兼容性**

保留 `tests/config-circuit.test.ts` 的 `generateChapter` 导入和断言，不改路由或 HTTP 测试。新增断言保证已有生成入口在重构后仍接受 `(db, novelId, chapterId)`，并在缺少 key 时恢复 `planned`：

```ts
await expect(generateChapter(db, novelId, chapterIds[0])).rejects.toThrow(ConfigError)
expect(readStatus(db, chapterIds[0])).toBe('planned')
```

- [ ] **Step 4: 保留失败测试在工作区，立即进入状态域实现**

不要提交或推送红色测试。Task 3 实现 `state.ts` 后，再以其绿色测试与实现代码组成同一个逻辑提交；这满足 TDD，也符合仓库“不推未验证代码”的纪律。

## Task 3: 提取章节抢占和失败恢复状态域

**Files:**

- Create: `server/src/services/chapterGeneration/types.ts`
- Create: `server/src/services/chapterGeneration/state.ts`
- Test: `tests/chapter-generation.test.ts`

- [ ] **Step 1: 实现共享类型**

在 `types.ts` 写入：

```ts
export interface ClaimedChapter {
  id: number
  novelId: number
  previousStatus: string
}

export interface PersistedGeneration {
  content: string
  aborted: boolean
}
```

- [ ] **Step 2: 实现最小状态域**

在 `state.ts` 写入以下完整接口。`ConfigError` 仍从 `../llm` 导入，保证既有 `instanceof ConfigError` 语义不变：

```ts
import { DatabaseSync } from 'node:sqlite'
import { ConfigError } from '../llm'
import type { ClaimedChapter } from './types'

export function claimChapter(db: DatabaseSync, novelId: number, chapterId: number): ClaimedChapter {
  const row = db.prepare('SELECT id, status FROM chapter WHERE id = ? AND novel_id = ?').get(chapterId, novelId) as
    | { id: number; status: string }
    | undefined
  if (!row) throw new Error('chapter not found')

  const update = db.prepare(
    "UPDATE chapter SET status = 'generating', updated_at = datetime('now') WHERE id = ? AND novel_id = ? AND status NOT IN ('generating')"
  ).run(chapterId, novelId)
  if (Number(update.changes) === 0) throw new Error('章节正在生成中（或状态不允许），请等待完成')
  return { id: row.id, novelId, previousStatus: row.status }
}

export function failClaimedChapter(db: DatabaseSync, claim: ClaimedChapter, error: unknown): void {
  const nextStatus = error instanceof ConfigError ? claim.previousStatus : 'failed'
  db.prepare(
    "UPDATE chapter SET status = ?, updated_at = datetime('now') WHERE id = ? AND novel_id = ? AND status = 'generating'"
  ).run(nextStatus, claim.id, claim.novelId)
}
```

- [ ] **Step 3: 运行状态契约测试**

Run:

```powershell
pnpm vitest run tests/chapter-generation.test.ts
```

Expected: 抢占和失败恢复通过；持久化测试仍因模块不存在失败。

- [ ] **Step 4: Commit**

```powershell
git add server/src/services/chapterGeneration/types.ts server/src/services/chapterGeneration/state.ts tests/chapter-generation.test.ts
git commit -m "refactor: isolate chapter generation state transitions"
```

## Task 4: 提取最终正文的一次性持久化事务

**Files:**

- Create: `server/src/services/chapterGeneration/persistence.ts`
- Modify: `server/src/services/chapterGeneration/types.ts`
- Test: `tests/chapter-generation.test.ts`

- [ ] **Step 1: 扩展失败测试，覆盖中止版本说明与空正文**

在相同测试文件新增：

```ts
it('中止的部分正文以 AI 生成（中止）保存', () => {
  const claim = claimChapter(db, novelId, chapterId)
  persistGeneratedChapter(db, claim, { content: '部分正文', aborted: true })
  expect(readLatestVersion(db, chapterId)).toMatchObject({ content: '部分正文', note: 'AI 生成（中止）' })
})

it('空正文不创建版本并将 generating 置为 failed', () => {
  const claim = claimChapter(db, novelId, chapterId)
  persistGeneratedChapter(db, claim, { content: '', aborted: false })
  expect(readStatus(db, chapterId)).toBe('failed')
  expect(db.prepare('SELECT COUNT(*) AS count FROM chapter_version WHERE chapter_id = ?').get(chapterId)).toMatchObject({ count: 0 })
})
```

- [ ] **Step 2: 运行测试，确认新断言失败**

Run:

```powershell
pnpm vitest run tests/chapter-generation.test.ts
```

Expected: FAIL，`persistGeneratedChapter` 尚未导出或中止/空正文语义未实现。

- [ ] **Step 3: 实现短事务持久化**

在 `persistence.ts` 实现以下函数；禁止在 `BEGIN` 与 `COMMIT` 之间调用 LLM、回调或网络：

```ts
import { DatabaseSync } from 'node:sqlite'
import type { ClaimedChapter, PersistedGeneration } from './types'

const countChineseChars = (content: string) => (content.match(/[\u4e00-\u9fff]/g) ?? []).length

export function persistGeneratedChapter(
  db: DatabaseSync,
  claim: ClaimedChapter,
  generation: PersistedGeneration
): { wordCount: number } {
  if (!generation.content.trim()) {
    db.prepare("UPDATE chapter SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND novel_id = ? AND status = 'generating'")
      .run(claim.id, claim.novelId)
    return { wordCount: 0 }
  }

  const wordCount = countChineseChars(generation.content)
  db.exec('BEGIN')
  try {
    db.prepare('INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, ?)')
      .run(claim.id, generation.content, generation.aborted ? 'AI 生成（中止）' : 'AI 生成')
    db.prepare(
      "UPDATE chapter SET content = ?, word_count = ?, status = 'written', ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ? AND novel_id = ? AND status = 'generating'"
    ).run(generation.content, wordCount, wordCount, claim.id, claim.novelId)
    db.exec('COMMIT')
    return { wordCount }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
```

- [ ] **Step 4: 运行持久化与既有配置错误测试**

Run:

```powershell
pnpm vitest run tests/chapter-generation.test.ts tests/config-circuit.test.ts
```

Expected: 新持久化契约通过；既有 ConfigError 测试仍通过。

- [ ] **Step 5: Commit**

```powershell
git add server/src/services/chapterGeneration/persistence.ts server/src/services/chapterGeneration/types.ts tests/chapter-generation.test.ts
git commit -m "refactor: centralize chapter generation persistence"
```

## Task 5: 提取后处理，并保证最终正文才会持久化

**Files:**

- Create: `server/src/services/chapterGeneration/postProcess.ts`
- Test: `tests/chapter-generation.test.ts`

- [ ] **Step 1: 写入纯后处理的失败测试**

新增可测试的最小接口；默认不触发 LLM 重写，以便单元测试不需要供应商：

```ts
import { postProcessGeneratedContent } from '../server/src/services/chapterGeneration/postProcess'

it('postProcessGeneratedContent 在无匹配规则时返回主角名对齐后的最终内容', async () => {
  const result = await postProcessGeneratedContent(db, novelId, '林惊蛰走进城门。')
  expect(result.content).toBe('Jing走进城门。')
  expect(result.degradedReasons).toEqual([])
})
```

测试须先插入与现有约束引擎一致的主角名约束和角色资料；若现有种子不便构造，复用 `tests/v0150.test.ts` 的最小数据写法。

- [ ] **Step 2: 运行测试，确认模块不存在**

Run:

```powershell
pnpm vitest run tests/chapter-generation.test.ts
```

Expected: FAIL，无法解析 `postProcess`。

- [ ] **Step 3: 移动现有后处理逻辑，不改变降级语义**

`postProcess.ts` 必须从旧 `generate.ts` 移入下列行为，按同一顺序执行：

```ts
export interface PostProcessResult {
  content: string
  degradedReasons: string[]
}

export async function postProcessGeneratedContent(
  db: DatabaseSync,
  novelId: number,
  rawContent: string
): Promise<PostProcessResult> {
  let content = replaceProtagonistName(db, novelId, rawContent)
  const degradedReasons: string[] = []

  // 对最终内容登记 validateConstraints 的每个 violation。
  // 如反 AI 重写条件命中，调用既有 callLlmJson；失败只 push 错误摘要并保留 content。
  // 成功重写仅在 rewritten.content.length >= content.length * 0.5 时替换 content。

  return { content, degradedReasons }
}
```

把现有 `validateConstraints`/`recordConstraintViolation`、`getBoundStyleRules`/`detectAntiAiHits`/`extractAntiAiWordsFromRules` 和 `callLlmJson` 调用从 `generate.ts` 原样迁入。反 AI 重写 prompt 保留包含 `JSON` 字样的响应约束。此函数不得写 `chapter` 或 `chapter_version`；最终正文只能由 `persistGeneratedChapter` 写入。

- [ ] **Step 4: 验证后处理与全文现有测试**

Run:

```powershell
pnpm vitest run tests/chapter-generation.test.ts tests/v0150.test.ts tests/truncation.test.ts
```

Expected: 所有测试通过；没有真实网络请求。

- [ ] **Step 5: Commit**

```powershell
git add server/src/services/chapterGeneration/postProcess.ts tests/chapter-generation.test.ts
git commit -m "refactor: separate chapter generation post processing"
```

## Task 6: 建立编排器并把 generate.ts 降为兼容入口

**Files:**

- Create: `server/src/services/chapterGeneration/orchestrator.ts`
- Modify: `server/src/services/generate.ts:1-245`
- Test: `tests/config-circuit.test.ts`
- Test: `tests/sse-abort.test.ts`

- [ ] **Step 1: 为最终版本内容写集成失败测试**

在 `tests/chapter-generation.test.ts` 使用 `vi.mock('../server/src/services/llm', ...)` 和 `vi.mock('../server/src/services/chapterGeneration/postProcess', ...)`，让 LLM 返回 `rawContent`，后处理返回 `最终正文`。测试通过公开 `generateChapter` 执行后断言：

```ts
expect(readChapter(db, chapterId)).toMatchObject({ content: '最终正文', status: 'written' })
expect(readLatestVersion(db, chapterId)).toMatchObject({ content: '最终正文' })
```

预期在旧实现下失败：旧版本快照会保存 rawContent，而不是 post-process 的最终正文。

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
pnpm vitest run tests/chapter-generation.test.ts
```

Expected: FAIL，`chapter_version.content` 为后处理前文本。

- [ ] **Step 3: 实现 orchestrator，并迁移 generate.ts 的公共类型**

将现有 `GenerateOptions` 与 `GenerateResult` 迁入 `chapterGeneration/orchestrator.ts` 并由 `generate.ts` 重新导出。实现必须按下列骨架保持调用顺序：

```ts
export async function generateChapter(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const claim = claimChapter(db, novelId, chapterId)
  try {
    const route = getRouteConfig(db, 'prose')
    if (!route || !route.apiKeyEncrypted) throw new ConfigError('prose 路由未配置 API Key——请在 设置 → 供应商 保存后重试')
    const tripleConstraints = await buildTripleConstraints(db, novelId, chapterId, opts.tripleReview)
    const context = buildChapterWriteContext(db, novelId, chapterId, { tripleConstraints, include: opts.include, perCallGuidance: opts.guidance })
    const llm = await callLlm(/* 保持现有 prose、stream、signal、delta 与 thinking 参数 */)
    if (!opts.signal?.aborted && llm.truncated) throw new Error('生成被 max_tokens 截断（finish_reason=length）——请在设置 → 模型路由调大 max_tokens，或降低单章目标字数后重试')
    const processed = await postProcessGeneratedContent(db, novelId, llm.content)
    const persisted = persistGeneratedChapter(db, claim, { content: processed.content, aborted: opts.signal?.aborted ?? false })
    await recordAbortedUsageWhenNeeded(/* 使用现有 estimateTokens 与 recordUsage 语义 */)
    return { content: processed.content, wordCount: persisted.wordCount, aborted: opts.signal?.aborted ?? false, usage: llm.usage }
  } catch (error) {
    failClaimedChapter(db, claim, error)
    throw error
  }
}
```

`generate.ts` 最终只包含：

```ts
export { generateChapter } from './chapterGeneration/orchestrator'
export type { GenerateOptions, GenerateResult } from './chapterGeneration/orchestrator'
```

不得更改 `server/src/services/production.ts`、SSE route 或客户端 API 的调用签名。

- [ ] **Step 4: 运行受影响测试集**

Run:

```powershell
pnpm vitest run tests/chapter-generation.test.ts tests/config-circuit.test.ts tests/sse-abort.test.ts tests/truncation.test.ts tests/v0220.test.ts
```

Expected: 所有测试通过；ConfigError 回 `planned`、空内容 `failed`、中止保留部分内容、截断不落库和最终版本正文契约均通过。

- [ ] **Step 5: Commit**

```powershell
git add server/src/services/chapterGeneration/orchestrator.ts server/src/services/generate.ts tests/chapter-generation.test.ts tests/config-circuit.test.ts
git commit -m "refactor: route chapter generation through domain orchestrator"
```

## Task 7: 运行完整验证并更新架构说明

**Files:**

- Modify: `docs/architecture.md`（章节生成数据流段）
- Modify: `docs/decision-log.md`（仅当实施中新增查证结论或不变量）
- Modify: `PLAN.md`（仅记录已完成的当前批次，不写历史流水账）

- [ ] **Step 1: 写明新的职责边界**

在 `docs/architecture.md` 的“章节生成上下文组装”之后加入以下准确说明：

```markdown
### 章节生成域

`chapterGeneration/orchestrator` 只协调上下文、LLM、后处理和持久化；`state` 是章节抢占与失败恢复的唯一事实源；`persistence` 在短事务中写最终正文、版本、字数与状态；`postProcess` 只返回最终正文，不直接写 chapter。`services/generate.ts` 是兼容导出入口。
```

- [ ] **Step 2: 执行完整项目门禁**

Run:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm db:smoke
pnpm build
pnpm dist
node scripts/check-docs.mjs
node scripts/verify-docs.mjs
```

Expected: typecheck 0 error；lint 无新增 error；全部 Vitest 通过；db-smoke 7 项通过；build 和两个 Windows 产物构建成功；文档检查通过。记录两个 `release/*.exe` 的更新时间。

- [ ] **Step 3: 复核最终差异与提交**

Run:

```powershell
git status --short
git diff --check
git log origin/main..HEAD --oneline
```

Expected: 只包含本计划声明的文件和 release 产物；无空白错误、密钥或临时文件。

```powershell
git add docs/architecture.md docs/decision-log.md PLAN.md release
git commit -m "docs: document chapter generation boundaries"
git push origin main
```

如果 `PLAN.md` 或 `docs/decision-log.md` 没有实际变化，不将它们强行加入提交。若源码改动触发 release-readiness，完成本地验证后停止在发布前状态，向用户申请 `pnpm release --bump=patch --push` 的明确授权；不得手工 bump、tag 或发布。

## 计划自检

- **设计覆盖：** Task 1 对应文档基线与 D107；Task 2-6 覆盖章节状态、最终正文事务、后处理和兼容入口；Task 7 覆盖架构文档、全量门禁和交付检查。
- **刻意不含：** job/scheduler、director/production 深拆、routes、context/LLM、客户端、Electron 和完整文档迁移；它们将按本文件开头的独立计划顺序处理。
- **类型一致性：** `ClaimedChapter`、`PersistedGeneration`、`claimChapter`、`failClaimedChapter` 和 `persistGeneratedChapter` 在所有任务中使用相同签名。
- **无占位符：** 每个实现任务包含精确文件、测试、接口、命令和预期输出。
