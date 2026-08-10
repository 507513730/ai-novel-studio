import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'
import { buildFrozenContext } from './context'

// ============================================================
// P2.3 轻量三方会审（审查优化 #1，前置到 P3）
// 正文生成前，主编 + 世界观顾问 + 角色顾问各产出一条
// "本章必须注意"约束，合并注入生成上下文（成本 +3 调用）
// ============================================================

export interface TripleReviewResult {
  director: string
  world: string
  character: string
}

const DIRECTOR_PROMPT = `你是本书的主编。根据书级合约、本章任务单和写作风格要求，输出一条"本章必须注意"的创作约束（60-120 字），聚焦：本章推进节奏、爽点/钩子安排、与前文衔接。输出 JSON：{"constraint": "约束内容"}，不要其他解释。`

const WORLD_PROMPT = `你是世界观顾问。根据世界观手册、本章任务单，输出一条"本章必须注意"的设定约束（60-120 字），聚焦：本章涉及的力量体系/地理/势力规则必须符合世界观，不得矛盾。输出 JSON：{"constraint": "约束内容"}，不要其他解释。`

const CHARACTER_PROMPT = `你是角色顾问。根据角色账本（含当前状态）、本章任务单，输出一条"本章必须注意"的人设约束（60-120 字），聚焦：出场角色的性格、行为、当前状态必须符合账本，不得 OOC。输出 JSON：{"constraint": "约束内容"}，不要其他解释。`

function parseConstraint(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null
  const c = (obj as { constraint?: unknown }).constraint
  return typeof c === 'string' && c.trim().length >= 10 ? c.trim() : null
}

export async function runTripleReview(
  db: DatabaseSync,
  novelId: number,
  chapterTaskSheet: string
): Promise<TripleReviewResult> {
  const frozen = buildFrozenContext(db, novelId)
  const common = [
    frozen.contract,
    frozen.world ? `\n${frozen.world}` : '',
    frozen.characters ? `\n【角色账本】\n${frozen.characters}` : '',
    `\n【本章任务单】\n${chapterTaskSheet}`
  ].join('\n')

  const [director, world, character] = await Promise.all([
    callLlmJson<string>(
      db,
      'extraction',
      {
        novelId,
        messages: [{ role: 'user', content: `${DIRECTOR_PROMPT}\n\n${common}` }],
        maxTokens: 512
      },
      parseConstraint,
      'triple-director'
    ),
    callLlmJson<string>(
      db,
      'extraction',
      {
        novelId,
        messages: [{ role: 'user', content: `${WORLD_PROMPT}\n\n${common}` }],
        maxTokens: 512
      },
      parseConstraint,
      'triple-world'
    ),
    callLlmJson<string>(
      db,
      'extraction',
      {
        novelId,
        messages: [{ role: 'user', content: `${CHARACTER_PROMPT}\n\n${common}` }],
        maxTokens: 512
      },
      parseConstraint,
      'triple-character'
    )
  ])

  return { director, world, character }
}
