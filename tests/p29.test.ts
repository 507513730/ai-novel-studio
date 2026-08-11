import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { parseSolutionSteps, createSolution, loadSolution } from '../server/src/services/solutionAssets'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

describe('P29 智能体资产化', () => {
  it('内置 5 智能体带结构化 body_md（职责/标准/原则）', () => {
    const db = makeDb()
    const rows = db.prepare("SELECT name, description, body_md FROM agent WHERE enabled = 1").all() as Array<{
      name: string
      description: string
      body_md: string
    }>
    expect(rows.length).toBe(5)
    for (const r of rows) {
      expect(r.description.length).toBeGreaterThan(0)
      expect(r.body_md).toContain('## 核心职责')
    }
    db.close()
  })

  it('技能挂载/卸载（agent_skill）与 runner 消费', () => {
    const db = makeDb()
    const editor = db.prepare("SELECT id FROM agent WHERE role = 'editor'").get() as { id: number }
    const skillId = Number(
      db.prepare("INSERT INTO skill (name, description, body_md, novel_id) VALUES ('节奏控制', '段落节奏', '1. 短句加速', 0)").run().lastInsertRowid
    )
    // 挂载
    db.prepare('INSERT OR IGNORE INTO agent_skill (agent_id, skill_id) VALUES (?, ?)').run(editor.id, skillId)
    const linked = db
      .prepare('SELECT s.name FROM agent_skill a JOIN skill s ON s.id = a.skill_id WHERE a.agent_id = ?')
      .all(editor.id) as Array<{ name: string }>
    expect(linked.map((l) => l.name)).toContain('节奏控制')
    // 卸载
    db.prepare('DELETE FROM agent_skill WHERE agent_id = ? AND skill_id = ?').run(editor.id, skillId)
    const after = db.prepare('SELECT COUNT(*) AS c FROM agent_skill WHERE agent_id = ?').get(editor.id) as { c: number }
    expect(after.c).toBe(0)
    db.close()
  })
})

describe('P30 ?????????????', () => {
  it('step ???production.output ????', () => {
    const steps = parseSolutionSteps(JSON.stringify([
      { agentId: 1, role: 'a', stage: 'whole_book', production: { output: 'outline' } },
      { agentId: 1, role: 'b', stage: 'whole_book', production: { output: 'final' } },
      { agentId: 1, role: 'c', stage: 'whole_book', production: { output: 'BAD' } },
      { agentId: 1, role: 'd', stage: 'whole_book' }
    ]))
    expect(steps.length).toBe(3) // BAD ???
    expect(steps.filter((s) => s.production?.output === 'final').length).toBe(1)
    expect(steps.filter((s) => !s.production).length).toBe(1) // ? production ????? draft?
  })

  it('???????????? ? ??????????????', () => {
    const db = makeDb()
    const editor = db.prepare("SELECT id FROM agent WHERE role = 'editor'").get() as { id: number }
    const id = createSolution(db, {
      name: '????',
      description: '',
      steps: [
        { agentId: editor.id, role: '??', stage: 'whole_book', production: { output: 'draft' } },
        { agentId: editor.id, role: '??', stage: 'post_generate' }
      ]
    })
    const sol = loadSolution(db, id)
    // ???? runProductionChapter ????????????????????
    expect(sol?.steps.length).toBe(2)
    expect(sol?.steps[0].stage).toBe('whole_book')
    db.close()
  })
});
