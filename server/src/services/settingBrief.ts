// 「帝路十章」写书修复：书级设定简报
// 问题（诊断）：知识库检索只注入章节生成（buildChapterWriteContext），导演全部阶段（planner.ts）
// 不注入 → 导入的设定对导演无效 → 自由发挥产出偏离题材的世界观。
// 方案一：导演前从知识库提炼「书级设定简报」（一次 LLM 调用）→ 存 framing_json.settingBrief →
// 注入 planner 全部阶段 prompt。

import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'

export interface SettingBrief {
  era: string // 时代背景与时间线
  powerSystem: string // 境界/力量体系
  characters: string // 同时代主要人物与关系
  factions: string // 势力与地理
  narrative: string // 叙事要点与红线（本作：双骄线/系统克制等）
  raw: string // 完整简报文本（注入用）
}

const BRIEF_PROMPT = `你是资深网文设定顾问。基于以下知识库资料（书籍设定文档），提炼一份"书级设定简报"，供整本书的自动导演（方向/世界观/角色/卷/节奏/章节）各阶段参考。
要求：
1. 忠实于资料中的设定（时代/境界/人物/事件），不编造
2. 输出 JSON：{"era": "时代背景与时间线（60-120字）", "powerSystem": "境界/力量体系（80-150字）", "characters": "同时代主要人物与关系（80-150字）", "factions": "势力与地理（60-120字）", "narrative": "叙事要点与红线（80-150字，含：本作主角与参考主角的同代双雄关系、金手指克制、版权边界提示）"}
3. 总计 500-800 字，中文。`

/** 读取书籍设定文档（全局 + 书内） */
export function getSettingDocs(db: DatabaseSync, novelId: number): string {
  const rows = db
    .prepare(
      "SELECT title, content FROM kb_doc WHERE novel_id IN (0, ?) AND content != '' AND status != 'draft' ORDER BY novel_id, id"
    )
    .all(novelId) as Array<{ title: string; content: string }>
  return rows
    .map((r) => `《${r.title}》\n${r.content}`)
    .join('\n\n')
    .slice(0, 12000)
}

/** 生成设定简报（LLM 提炼）；失败返回 null（调用方降级） */
export async function generateSettingBrief(db: DatabaseSync, novelId: number): Promise<SettingBrief | null> {
  const docs = getSettingDocs(db, novelId)
  if (docs.length < 100) return null
  const brief = await callLlmJson<Omit<SettingBrief, 'raw'>>(
    db,
    'extraction',
    {
      novelId,
      messages: [{ role: 'user', content: `${BRIEF_PROMPT}\n\n【知识库设定资料】\n${docs}\n\n只输出 JSON。` }],
      maxTokens: 4096
    },
    (obj) => {
      const r = obj as Record<string, unknown>
      if (typeof r.era !== 'string' || typeof r.powerSystem !== 'string') return null
      return {
        era: String(r.era),
        powerSystem: String(r.powerSystem),
        characters: String(r.characters ?? ''),
        factions: String(r.factions ?? ''),
        narrative: String(r.narrative ?? '')
      }
    },
    'setting-brief'
  )
  const raw = [
    '【书级设定简报（必须遵循）】',
    `时代：${brief.era}`,
    `力量体系：${brief.powerSystem}`,
    `人物：${brief.characters}`,
    `势力地理：${brief.factions}`,
    `叙事要点：${brief.narrative}`
  ].join('\n')
  const full = { ...brief, raw }
  // 存 framing_json.settingBrief（导演各阶段消费）
  const novel = db.prepare('SELECT framing_json FROM novel WHERE id = ?').get(novelId) as { framing_json: string } | undefined
  if (novel) {
    const framing = JSON.parse(novel.framing_json || '{}') as Record<string, unknown>
    framing.settingBrief = full
    db.prepare("UPDATE novel SET framing_json = ?, updated_at = datetime('now') WHERE id = ?").run(
      JSON.stringify(framing),
      novelId
    )
  }
  return full
}

/** 读设定简报（注入 planner 各阶段）；无简报返回空串 */
export function settingBriefBlock(db: DatabaseSync, novelId: number): string {
  const novel = db.prepare('SELECT framing_json FROM novel WHERE id = ?').get(novelId) as
    | { framing_json: string }
    | undefined
  if (!novel) return ''
  const framing = JSON.parse(novel.framing_json || '{}') as Record<string, unknown>
  const brief = framing.settingBrief as SettingBrief | undefined
  return brief?.raw ?? ''
}

/** 导演阶段 prompt 注入简报（无简报时原样返回——降级不阻塞） */
export function injectSettingBrief(db: DatabaseSync, novelId: number, prompt: string): string {
  const brief = settingBriefBlock(db, novelId)
  return brief ? `${prompt}\n\n${brief}` : prompt
}

// v0.15.0：统一创作指导注入 = 硬约束 + 设定简报 + 书级引导（一网打尽用户强调的事项）
import { constraintsBlock } from './constraintEngine'
import { getGuidance } from './guidance'

export function injectGuidance(db: DatabaseSync, novelId: number, prompt: string): string {
  const blocks: string[] = []
  const cBlock = constraintsBlock(db, novelId)
  if (cBlock) blocks.push(cBlock)
  const brief = settingBriefBlock(db, novelId)
  if (brief) blocks.push(brief)
  const guidance = getGuidance(db, novelId)
  if (guidance) blocks.push(`【创作引导】${guidance}`)
  return blocks.length > 0 ? `${prompt}\n\n${blocks.join('\n\n')}` : prompt
}
