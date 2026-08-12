import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { trimFromEnd } from '../server/src/services/context'
import { createSolution, exportSolutionBundle, importSolutionBundle, loadSolution } from '../server/src/services/solutionAssets'
import { isJobAborted } from '../server/src/services/jobQueue'
import { runProductionChapter } from '../server/src/services/solutionRunner'
import { parseSolutionSteps } from '../server/src/services/solutionAssets'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

describe('v0.8.0 批2-4 任务单保序裁剪（审查 #4）', () => {
  it('裁知识库/定位段时任务单段保留（旧实现会连带整段删除）', () => {
    const VARIABLE_TRIM_ORDER = [
      '【前文回顾】',
      '【知识库检索（按相关性）】',
      '【当前定位】',
      '【绑定写法要求（必须遵守）】',
      '【本章三方会审约束（必须遵守）】',
      '【未回收伏笔（写作时酌情呼应，不得遗忘）】',
      '【本次引导】'
    ]
    const text =
      '【本次引导】本次要快节奏\n\n' +
      '【知识库检索（按相关性）】' + 'y'.repeat(30000) + '\n\n' +
      '【当前定位】' + 'z'.repeat(30000) + '\n\n' +
      '【本章任务单】\n章节名：测试章\n摘要：摘要\n目标：{}'
    const out = trimFromEnd(text, VARIABLE_TRIM_ORDER, 1000)
    expect(out).toContain('【本章任务单】')
    expect(out).toContain('章节名：测试章')
    expect(out).not.toContain('【知识库检索（按相关性）】')
    expect(out).not.toContain('【当前定位】')
  })

  it('预算充足时不裁剪任何段', () => {
    const text = '【前文回顾】短\n\n【本章任务单】\n章节名：A'
    const out = trimFromEnd(text, ['【前文回顾】', '【本章任务单】'], 100000)
    expect(out).toBe(text)
  })
})

describe('v0.8.0 批2-2 production schema 保留（审查 #2）', () => {
  it('createSolution 保留 production 字段（此前 zod/导入映射剥离）', () => {
    const db = makeDb()
    const editor = db.prepare("SELECT id FROM agent WHERE role = 'editor'").get() as { id: number }
    const id = createSolution(db, {
      name: '流水线方案',
      description: '',
      steps: [
        { agentId: editor.id, role: '大纲', stage: 'whole_book', production: { output: 'outline' } },
        { agentId: editor.id, role: '正文', stage: 'whole_book', production: { output: 'final' } }
      ]
    })
    const sol = loadSolution(db, id)
    expect(sol?.steps[0].production?.output).toBe('outline')
    expect(sol?.steps[1].production?.output).toBe('final')
    db.close()
  })

  it('export→import 往返保留 production', () => {
    const db = makeDb()
    const editor = db.prepare("SELECT id FROM agent WHERE role = 'editor'").get() as { id: number }
    const id = createSolution(db, {
      name: '往返方案',
      description: '',
      steps: [
        { agentId: editor.id, role: '审校', stage: 'whole_book', production: { output: 'review', reviewRounds: 2 } }
      ]
    })
    const bundle = exportSolutionBundle(db, id)
    const imported = importSolutionBundle(db, bundle)
    const sol = loadSolution(db, imported.solutionId)
    expect(sol?.steps[0].production?.output).toBe('review')
    expect(sol?.steps[0].production?.reviewRounds).toBe(2)
    db.close()
  })
})

describe('v0.8.0 批2-5 原子抢占（审查 #5）', () => {
  it('章节状态为 generating 时 runProductionChapter 拒绝（409 语义）', async () => {
    const db = makeDb()
    const editor = db.prepare("SELECT id FROM agent WHERE role = 'editor'").get() as { id: number }
    const sid = createSolution(db, {
      name: '抢占方案',
      description: '',
      steps: [{ agentId: editor.id, role: '正文', stage: 'whole_book', production: { output: 'final' } }]
    })
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', '灵感', 'planned')").run().lastInsertRowid)
    const chapterId = Number(
      db.prepare("INSERT INTO chapter (novel_id, title, content, status) VALUES (?, '章', '', 'generating')").run(novelId).lastInsertRowid
    )
    await expect(runProductionChapter(db, sid, novelId, chapterId)).rejects.toThrow('正在生成中')
    db.close()
  })

  it('抢占成功后失败会复位 status（generating → failed，回退路径可用）', async () => {
    const db = makeDb()
    const editor = db.prepare("SELECT id FROM agent WHERE role = 'editor'").get() as { id: number }
    const sid = createSolution(db, {
      name: '复位方案',
      description: '',
      steps: [{ agentId: editor.id, role: '正文', stage: 'whole_book', production: { output: 'final' } }]
    })
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('书', '灵感', 'planned')").run().lastInsertRowid)
    const chapterId = Number(
      db.prepare("INSERT INTO chapter (novel_id, title, content, status) VALUES (?, '章', '', 'planned')").run(novelId).lastInsertRowid
    )
    // 无 provider key → LLM 调用必然失败 → 异常路径应复位 claim
    await expect(runProductionChapter(db, sid, novelId, chapterId)).rejects.toThrow()
    const st = db.prepare('SELECT status FROM chapter WHERE id = ?').get(chapterId) as { status: string }
    expect(st.status).toBe('failed')
    db.close()
  })
})

describe('v0.8.0 批2-8 watchdog 中止感知（审查 #8）', () => {
  it('cancelled → 中止；watchdog failed → 中止；普通 failed → 不中止', () => {
    const db = makeDb()
    const insert = (status: string, error = '') => Number(
      db.prepare("INSERT INTO job (type, status, error, payload_json) VALUES ('director', ?, ?, '{}')").run(status, error).lastInsertRowid
    )
    const cancelledId = insert('cancelled')
    const watchdogId = insert('failed', 'watchdog: job stuck without progress for 30min')
    const normalFailedId = insert('failed', 'LLM timeout')
    const queuedId = insert('queued')
    expect(isJobAborted(db, cancelledId)).toBe(true)
    expect(isJobAborted(db, watchdogId)).toBe(true)
    expect(isJobAborted(db, normalFailedId)).toBe(false)
    expect(isJobAborted(db, queuedId)).toBe(false)
    expect(isJobAborted(db, 99999)).toBe(true) // 行不存在 = 已清理，视为中止
    db.close()
  })
})

describe('v0.8.0 批2-14 whole_book 判定（审查 #14）', () => {
  it('role 文本含 whole_book 字样不误判为流水线方案', () => {
    const db = makeDb()
    const editor = db.prepare("SELECT id FROM agent WHERE role = 'editor'").get() as { id: number }
    const id = createSolution(db, {
      name: '误判防护',
      description: '',
      steps: [
        { agentId: editor.id, role: '检查 whole_book 流程合规', stage: 'post_generate' }
      ]
    })
    const sol = loadSolution(db, id)
    const steps = parseSolutionSteps(JSON.stringify(sol?.steps))
    expect(steps.some((s) => s.stage === 'whole_book')).toBe(false)
    expect(steps.length).toBe(1)
    db.close()
  })
})
