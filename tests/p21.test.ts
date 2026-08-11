import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import {
  parseAgentMd,
  parseSolutionSteps,
  createSolution,
  loadSolution,
  saveSolution,
  exportSolutionBundle,
  importSolutionBundle,
  type SolutionStep
} from '../server/src/services/solutionAssets'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

describe('P21-1 YAML frontmatter 解析（Feelfish agent md 兼容）', () => {
  it('解析 name/description/tools/skills + 正文', () => {
    const md = `---
name: 场景描写师
description: 将场景转化为感官画面
tools: all
skills: [mc-cjcx, mc-faps]
---
1. 核心职责
2. 质量标准`
    const parsed = parseAgentMd(md)
    expect(parsed.frontmatter.name).toBe('场景描写师')
    expect(parsed.frontmatter.description).toContain('感官画面')
    expect(parsed.frontmatter.tools).toBe('all')
    expect(parsed.frontmatter.skills).toEqual(['mc-cjcx', 'mc-faps'])
    expect(parsed.body).toContain('核心职责')
  })

  it('无 frontmatter 时整体当正文', () => {
    const parsed = parseAgentMd('纯文本提示词')
    expect(parsed.frontmatter).toEqual({})
    expect(parsed.body).toBe('纯文本提示词')
  })

  it('畸形 frontmatter 降级为整体正文（不抛错）', () => {
    const parsed = parseAgentMd('---\nbroken')
    expect(parsed.frontmatter).toEqual({})
    expect(parsed.body.length).toBeGreaterThan(0)
  })
})

describe('P21-1/3 方案存储与步骤', () => {
  it('create + load + save（版本快照 + version 递增）', () => {
    const db = makeDb()
    const editor = db.prepare("SELECT id FROM agent WHERE role = 'editor'").get() as { id: number }
    const reviewer = db.prepare("SELECT id FROM agent WHERE role = 'reviewer'").get() as { id: number }
    const id = createSolution(db, {
      name: '测试方案',
      description: 'd',
      primaryAgentId: editor.id,
      steps: [{ agentId: editor.id, role: 'a', stage: 'post_generate', if: null }]
    })
    const sol = loadSolution(db, id)
    expect(sol?.name).toBe('测试方案')
    expect(sol?.steps.length).toBe(1)
    expect(sol?.version).toBe(1)
    saveSolution(db, id, {
      steps: [
        { agentId: editor.id, role: 'a', stage: 'post_generate', if: null },
        { agentId: reviewer.id, role: 'b', stage: 'review', if: null }
      ]
    })
    const v2 = loadSolution(db, id)
    expect(v2?.steps.length).toBe(2)
    expect(v2?.version).toBe(2)
    const versions = db.prepare('SELECT COUNT(*) AS c FROM solution_version WHERE solution_id = ?').get(id) as { c: number }
    expect(versions.c).toBe(1)
    db.close()
  })

  it('steps_json 解析：非法 step 丢弃（宽松）', () => {
    const steps = parseSolutionSteps(JSON.stringify([
      { agentId: 1, role: 'ok', stage: 'post_generate' },
      { agentId: 'x', role: 'bad', stage: 'post_generate' },
      { agentId: 2, role: 'bad2', stage: 'unknown_stage' }
    ]))
    expect(steps.length).toBe(1)
    expect(steps[0].role).toBe('ok')
  })
})

describe('P21-4 自包含导入导出（含 Feelfish 来源）', () => {
  it('导出 → 导入往返：agent/skill/solution 完整还原', () => {
    const db1 = makeDb()
    const db2 = makeDb()
    const editor = db1.prepare("SELECT id FROM agent WHERE role = 'editor'").get() as { id: number }
    // 挂技能
    const skillId = Number(
      db1.prepare('INSERT INTO skill (name, description, body_md, novel_id) VALUES (?, ?, ?, 0)').run('节奏控制', '控制段落节奏', '1. 短句加速 2. 长句舒缓').lastInsertRowid
    )
    db1.prepare('UPDATE agent SET skills_json = ? WHERE id = ?').run(JSON.stringify(['节奏控制']), editor.id)
    const id = createSolution(db1, {
      name: '往返方案',
      description: '往返测试',
      primaryAgentId: editor.id,
      steps: [
        { agentId: editor.id, role: '节奏复核', stage: 'post_generate', if: null },
        { agentId: editor.id, role: '文风统一', stage: 'post_generate', if: null }
      ]
    })
    void skillId
    const bundle = exportSolutionBundle(db1, id)
    const imported = importSolutionBundle(db2, bundle)
    expect(imported.name).toBe('往返方案')
    const sol = loadSolution(db2, imported.solutionId)
    expect(sol?.steps.length).toBe(2)
    const skills = db2.prepare('SELECT name FROM skill').all() as Array<{ name: string }>
    expect(skills.map((s) => s.name)).toContain('节奏控制')
    db1.close()
    db2.close()
  })

  it('导入校验：非方案文件拒绝', () => {
    const db = makeDb()
    expect(() => importSolutionBundle(db, JSON.stringify({ app: 'other', kind: 'x' }))).toThrow()
    db.close()
  })
})

describe('P21-3 runner 防呆', () => {
  it('seed 模板方案存在且步骤合法（不依赖 LLM）', () => {
    const db = makeDb()
    const rows = db.prepare('SELECT name, steps_json FROM solution').all() as Array<{ name: string; steps_json: string }>
    expect(rows.length).toBeGreaterThanOrEqual(3)
    for (const r of rows) {
      const steps = parseSolutionSteps(r.steps_json)
      expect(steps.length).toBeGreaterThan(0)
      expect(steps.every((s: SolutionStep) => s.agentId > 0 && s.role.length > 0)).toBe(true)
    }
    db.close()
  })
})
