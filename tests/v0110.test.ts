import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import {
  createSolution,
  exportSolutionBundle,
  importSolutionBundle,
  loadSolution,
  type SolutionPack
} from '../server/src/services/solutionAssets'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function makeSolution(db: DatabaseSync): number {
  const editor = db.prepare("SELECT id FROM agent WHERE role = 'editor'").get() as { id: number }
  return createSolution(db, {
    name: '整本流水线方案',
    description: '测试方案',
    steps: [
      { agentId: editor.id, role: '大纲', stage: 'whole_book', production: { output: 'outline' } },
      { agentId: editor.id, role: '正文', stage: 'whole_book', production: { output: 'final' } }
    ]
  })
}

describe('v0.11.0 批C-1 solution-pack 导出（市场格式）', () => {
  it('导出为 solution-pack（kind/id/version/metrics，id 小写 kebab-case 含 hash）', () => {
    const db = makeDb()
    const id = makeSolution(db)
    const pack = JSON.parse(exportSolutionBundle(db, id)) as SolutionPack
    expect(pack.kind).toBe('solution-pack')
    expect(pack.id).toMatch(/^[a-z0-9-]+$/)
    expect(pack.id.length).toBeGreaterThan(5)
    expect(pack.version).toBe('1.0.0')
    expect(pack.metrics.stepCount).toBe(2)
    expect(pack.metrics.wholeBook).toBe(true)
    expect(pack.agents.length).toBeGreaterThan(0)
    expect(pack.sampleBook).toBeUndefined()
    db.close()
  })

  it('附带样例快照（sampleNovelId：书 + 已写章节）', () => {
    const db = makeDb()
    const id = makeSolution(db)
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('样例书', 'x', 'draft')").run().lastInsertRowid)
    db.prepare("INSERT INTO chapter (novel_id, title, content, status) VALUES (?, '第一章', '这是一段样例正文内容。', 'written')").run(novelId)
    const pack = JSON.parse(exportSolutionBundle(db, id, { sample: { novelId } })) as SolutionPack
    expect(pack.sampleBook?.title).toBe('样例书')
    expect(pack.sampleBook?.chapters.length).toBe(1)
    expect(pack.sampleBook?.chapters[0].excerpt).toContain('样例正文')
    db.close()
  })
})

describe('v0.11.0 批C-2 导入兼容（solution-pack 与旧 solution）', () => {
  it('solution-pack 导出→导入往返（含样例透传）', () => {
    const db = makeDb()
    const id = makeSolution(db)
    const novelId = Number(db.prepare("INSERT INTO novel (title, inspiration, status) VALUES ('样例书', 'x', 'draft')").run().lastInsertRowid)
    db.prepare("INSERT INTO chapter (novel_id, title, content, status) VALUES (?, '第一章', '样例正文', 'written')").run(novelId)
    const pack = exportSolutionBundle(db, id, { sample: { novelId } })
    const imported = importSolutionBundle(db, pack)
    expect(imported.name).toBe('整本流水线方案')
    expect(imported.version).toBe('1.0.0')
    expect(imported.sampleBook?.chapters.length).toBe(1)
    const sol = loadSolution(db, imported.solutionId)
    expect(sol?.steps[0].production?.output).toBe('outline')
    db.close()
  })

  it('旧格式（kind:solution）仍可导入', () => {
    const db = makeDb()
    const id = makeSolution(db)
    const pack = JSON.parse(exportSolutionBundle(db, id)) as SolutionPack
    // 降级为旧格式（去 solution-pack 元数据）
    const legacy = JSON.stringify({
      app: 'AI-Novel-Studio',
      kind: 'solution',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      solution: pack.solution,
      agents: pack.agents,
      skills: pack.skills
    })
    const imported = importSolutionBundle(db, legacy)
    expect(imported.name).toBe('整本流水线方案')
    expect(imported.version).toBeUndefined()
    db.close()
  })

  it('非法包拒绝（kind 错误/缺字段）', () => {
    const db = makeDb()
    expect(() => importSolutionBundle(db, JSON.stringify({ app: 'AI-Novel-Studio', kind: 'weird' }))).toThrow('不是有效的方案导出文件')
    expect(() => importSolutionBundle(db, JSON.stringify({ app: 'Other', kind: 'solution-pack' }))).toThrow('不是有效的方案导出文件')
    db.close()
  })
})
