// 重构计划 R6.1：上下文组装特征测试（拆分前锁定现状）——
// 冻结前缀顺序（系统提示→合约→世界观→角色账本→任务单→前文回顾）、
// frozen hash 版本化、预算裁剪优先级（合约不可裁；前文回顾先于任务单裁）、
// RAG/直塞语义（direct 走冻结区不重复进检索）。
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import {
  buildChapterWriteContext
} from '../server/src/services/context/dynamic'
import { buildFrozenContext } from '../server/src/services/context/frozen'
import { estimateTokens } from '../server/src/services/context/hash'
import { trimFromEnd } from '../server/src/services/context/budget'
import { getSystemPrompt } from '../server/src/prompts/promptAsset'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

const LONG = '很长的设定内容。'.repeat(80)

function seedFullNovel(db: DatabaseSync): { novelId: number; chapterId: number } {
  const novelId = Number(
    db
      .prepare('INSERT INTO novel (inspiration, title, framing_json) VALUES (?, ?, ?)')
      .run('末世灵感', '契约测试书', JSON.stringify({ genre: '科幻', summary: '末世求生' })).lastInsertRowid
  )
  db.prepare(
    'INSERT INTO world (novel_id, manual_json, factions_json, map_json) VALUES (?, ?, ?, ?)'
  ).run(
    novelId,
    JSON.stringify({ 地理: LONG, 势力格局: LONG }),
    JSON.stringify([{ name: '幸存者议会', desc: LONG }]),
    '{}'
  )
  const insertChar = db.prepare(
    "INSERT INTO character (novel_id, name, profile_json, status, ledger_json) VALUES (?, ?, ?, 'roster', '{}')"
  )
  for (let i = 0; i < 3; i++) {
    insertChar.run(novelId, `角色${i}`, JSON.stringify({ identity: `身份${i}（${LONG.slice(0, 60)}）`, goal: '活下去' }))
  }
  const volumeId = Number(
    db.prepare('INSERT INTO volume (novel_id, title, order_index) VALUES (?, ?, ?)').run(novelId, '第一卷', 0).lastInsertRowid
  )
  // 前文回顾素材：先插 3 章 written + 长摘要（id 必须小于当前章，getChapterSummary 按 id < 过滤）
  const insertPrev = db
    .prepare(
      "INSERT INTO chapter (novel_id, volume_id, title, summary, goal_json, content, status) VALUES (?, ?, ?, ?, '{}', '旧正文', 'written')"
    )
  for (let i = 1; i <= 3; i++) {
    insertPrev.run(novelId, volumeId, `前章${i}`, `前章${i}摘要：${LONG}`)
  }
  const chapterId = Number(
    db
      .prepare(
        "INSERT INTO chapter (novel_id, volume_id, title, summary, goal_json, content, status) VALUES (?, ?, '第10章', ?, '{}', '', 'planned')"
      )
      .run(novelId, volumeId, '本章摘要：主角进入废墟城市。').lastInsertRowid
  )
  return { novelId, chapterId }
}

describe('冻结前缀顺序契约（R6.1）', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = makeDb()
  })

  it('顺序：系统提示 → 书级合约 → 世界观手册 → 角色账本 → 本章任务单 → 前文回顾', () => {
    const { novelId, chapterId } = seedFullNovel(db)
    const ctx = buildChapterWriteContext(db, novelId, chapterId)
    const text = ctx.messages[0].content ?? ''

    const sysPrompt = getSystemPrompt('prose')
    expect(text.startsWith(sysPrompt.slice(0, 30))).toBe(true)
    const iContract = text.indexOf('【书级合约】')
    const iWorld = text.indexOf('【世界观手册】')
    const iChars = text.indexOf('【角色账本】')
    const iTask = text.indexOf('【本章任务单】')
    const iSummary = text.indexOf('【前文回顾】')
    expect(iContract).toBeGreaterThan(0)
    expect(iWorld).toBeGreaterThan(iContract)
    expect(iChars).toBeGreaterThan(iWorld)
    expect(iTask).toBeGreaterThan(iChars)
    expect(iSummary).toBeGreaterThan(iTask)
    // 尾部指令固定
    expect(text.endsWith('请直接输出本章正文。')).toBe(true)
    db.close()
  })

  it('frozen hash：内容不变 hash 不变；世界观变化即失效（缓存语义）', () => {
    const { novelId } = seedFullNovel(db)
    const h1 = buildFrozenContext(db, novelId).hash
    const h2 = buildFrozenContext(db, novelId).hash
    expect(h1).toBe(h2)
    db.prepare('UPDATE world SET manual_json = ? WHERE novel_id = ?').run(
      JSON.stringify({ 地理: '变化后的设定' }),
      novelId
    )
    const h3 = buildFrozenContext(db, novelId).hash
    expect(h3).not.toBe(h1)
    db.close()
  })

  it('RAG/直塞语义：direct 资料进冻结区【外部资料】，不进可变区检索；非 direct 命中才出现【知识库检索】', () => {
    const { novelId, chapterId } = seedFullNovel(db)
    db.prepare("INSERT INTO kb_doc (novel_id, title, content, status) VALUES (?, ?, ?, 'direct')").run(
      novelId,
      '世界观圣经',
      '直塞设定：量子潮汐规则。'
    )
    const ctx = buildChapterWriteContext(db, novelId, chapterId)
    const text = ctx.messages[0].content ?? ''
    const iExternal = text.indexOf('【外部资料】')
    const iKb = text.indexOf('【知识库检索')
    expect(iExternal).toBeGreaterThan(0)
    expect(text.slice(iExternal)).toContain('量子潮汐规则')
    // direct 资料已被检索排除（D7 防双份）——无其他可检索文档时不出现检索段
    expect(iKb).toBe(-1)
    db.close()
  })
})

describe('预算裁剪优先级契约（R6.1）', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = makeDb()
  })

  it('可变区超限：前文回顾先于任务单被裁；任务单保留', () => {
    const { novelId, chapterId } = seedFullNovel(db)
    // 前文 3 段长摘要 ≈ 数千 token；给极小预算强制裁剪
    const ctx = buildChapterWriteContext(db, novelId, chapterId, { budgetTokens: 900 })
    const text = ctx.messages[0].content ?? ''
    expect(text).not.toContain('【前文回顾】')
    expect(text).toContain('【本章任务单】')
    expect(estimateTokens(text)).toBeLessThanOrEqual(900)
    db.close()
  })

  it('冻结区超限：角色账本先于世界观被裁，书级合约不可裁（最后兜底截断）', () => {
    const { novelId, chapterId } = seedFullNovel(db)
    const ctx = buildChapterWriteContext(db, novelId, chapterId, { budgetTokens: 700 })
    const text = ctx.messages[0].content ?? ''
    expect(text).toContain('【书级合约】')
    expect(text).toContain('【书级合约】\n')
    // 角色账本在裁剪序中先于世界观手册
    expect(text).not.toContain('【角色账本】')
    db.close()
  })

  it('trimFromEnd：只删目标段，段边界精确（任务单不受其他段裁剪牵连）', () => {
    const text = ['【前文回顾】\nA'.repeat(1), '【本章任务单】\nB', '【结尾】C'].join('\n')
    // 预算充足：原样返回
    expect(trimFromEnd(text, ['【前文回顾】'], 10_000)).toBe(text)
    // 超预算：裁掉前文回顾段，任务单与结尾保留
    const trimmed = trimFromEnd(text, ['【前文回顾】'], 5)
    expect(trimmed).not.toContain('【前文回顾】')
    expect(trimmed).toContain('【本章任务单】')
    expect(trimmed).toContain('【结尾】C')
    db.close()
  })
})
