// 导演阶段执行器：characters（角色方案 = 核心阵容 + 扩展阵容，含主角名硬约束重试）
import { DatabaseSync } from 'node:sqlite'
import { getConstraints } from '../../constraintEngine'
import { callLlmJson } from '../../jsonSafe'
import { injectGuidance } from '../../settingBrief'
import { generateCharsCorePrompt, generateCharsExtendedPrompt, parseCharacters } from '../../planner'
import { loadNovel, type StageContext } from './shared'

type Char = { name: string; role: string; identity: string; personality: string; goal: string; weakness: string; relation: string }

export async function runCharactersStage(db: DatabaseSync, novelId: number, _ctx: StageContext): Promise<void> {
  const novel = loadNovel(db, novelId)
  const world = db
    .prepare('SELECT manual_json, factions_json FROM world WHERE novel_id = ?')
    .get(novelId) as { manual_json: string; factions_json: string } | undefined
  const base = `书级合约：${novel.framing_json}\n世界观：${world ? world.manual_json + world.factions_json : ''}`
  const core = await callLlmJson<Char[]>(
    db,
    'extraction',
    {
      novelId,
      messages: [{ role: 'user', content: injectGuidance(db, novelId, generateCharsCorePrompt(base)) }],
      maxTokens: 4096
    },
    parseCharacters,
    'director-characters-core'
  )
  // v0.15.0：主角名硬约束校验——角色阶段产出主角名 ≠ 规范名时自动重试一次
  const pc = getConstraints(db, novelId).find((c) => c.keyword && c.replaceWith && c.text.includes('主角'))
  if (pc && core.length > 0) {
    const proto = core.find((c) => String(c.role || '').includes('主角'))
    if (proto && proto.name && proto.name !== pc.keyword) {
      console.warn(`[constraint] 角色阶段主角名「${proto.name}」≠ 规范名「${pc.keyword}」，重试一次`)
      const coreRetry = await callLlmJson<Char[]>(
        db,
        'extraction',
        {
          novelId,
          messages: [
            {
              role: 'user',
              content:
                injectGuidance(
                  db,
                  novelId,
                  generateCharsCorePrompt(base) + `\n【硬性要求】本书主角必须叫「${pc.keyword}」，所有角色产出中主角一律使用此名，不得使用其他名字。`
                )
            }
          ],
          maxTokens: 4096
        },
        parseCharacters,
        'director-characters-core-retry'
      )
      if (coreRetry.length > 0) {
        core.splice(0, core.length, ...coreRetry)
      }
    }
  }
  const extended = await callLlmJson<Char[]>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: injectGuidance(db, novelId, generateCharsExtendedPrompt(base, core.map((c) => ({ name: c.name, role: c.role }))))
        }
      ],
      maxTokens: 4096
    },
    parseCharacters,
    'director-characters-extended'
  )
  // P20（M3）：幂等去重——按 novel+name 跳过已存在（阶段失败重跑不造重名角色）
  const existingChars = new Set(
    (db.prepare('SELECT name FROM character WHERE novel_id = ?').all(novelId) as Array<{ name: string }>).map(
      (r) => r.name
    )
  )
  const insert = db.prepare(
    'INSERT INTO character (novel_id, name, profile_json, status) VALUES (?, ?, ?, ?)'
  )
  db.exec('BEGIN')
  try {
    for (const c of [...core, ...extended]) {
      if (existingChars.has(c.name)) continue
      existingChars.add(c.name)
      insert.run(
        novelId,
        c.name,
        JSON.stringify({
          role: c.role,
          identity: c.identity,
          personality: c.personality,
          goal: c.goal,
          weakness: c.weakness,
          relation: c.relation
        }),
        'pending'
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
