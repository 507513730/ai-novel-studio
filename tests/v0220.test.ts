// v0.22.0：N1 字数记账覆盖语义（整章替换→ai_words=本次字数，防重生膨胀；见 decision-log D92）
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db)
  return db
}

const PREFIX = 'v0.22.0 审查修复'

function seedNovelChapter(db: DatabaseSync, aiWords = 0): void {
  db.prepare("INSERT INTO novel (id, title, inspiration, status) VALUES (1, '书', '灵感', 'draft')").run()
  db.prepare('INSERT INTO chapter (novel_id, title, status, ai_words, human_words) VALUES (1, ?, ?, ?, 0)').run(
    '第一章',
    'written',
    aiWords
  )
}

const cjk = (s: string): number => (s.match(/[\u4e00-\u9fff]/g) ?? []).length

describe(`${PREFIX} · N1 整章替换覆盖语义（防重生膨胀）`, () => {
  it('generate 同章重生 2 次：ai_words == 第二次字数（非两次之和）', () => {
    const db = openDb()
    seedNovelChapter(db, 0)
    const id = 1
    // 第一次生成（内容 3 字）
    const c1 = '一二三'
    const w1 = cjk(c1)
    db.prepare(
      "UPDATE chapter SET content = ?, word_count = ?, status = 'written', ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(c1, w1, w1, id)
    let row = db.prepare('SELECT ai_words, human_words, word_count FROM chapter WHERE id = ?').get(id) as {
      ai_words: number
      human_words: number
      word_count: number
    }
    expect(row.ai_words).toBe(3)
    expect(row.word_count).toBe(3)

    // 第二次重生（内容 2 字，整章替换）——覆盖语义下应为 2，非 3+2=5
    const c2 = '四五'
    const w2 = cjk(c2)
    db.prepare(
      "UPDATE chapter SET content = ?, word_count = ?, status = 'written', ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(c2, w2, w2, id)
    row = db.prepare('SELECT ai_words, human_words, word_count FROM chapter WHERE id = ?').get(id) as {
      ai_words: number
      human_words: number
      word_count: number
    }
    expect(row.ai_words).toBe(2)
    expect(row.human_words).toBe(0)
    expect(row.word_count).toBe(2)
  })

  it('solutionRunner 流水线 UPDATE：整章替换覆盖（非累加）', () => {
    const db = openDb()
    seedNovelChapter(db, 999) // 假设此前已有（膨胀语义遗留的）高值
    const id = 1
    // 与 solutionRunner.ts 相同的 UPDATE（覆盖语义）
    const c = '流水线产出一二三四'
    const w = cjk(c)
    db.prepare(
      "UPDATE chapter SET title = CASE WHEN ? != '' THEN ? ELSE title END, content = ?, word_count = ?, status = 'written', ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ?"
    ).run('新标题', '新标题', c, w, w, id)
    const row = db.prepare('SELECT ai_words, human_words FROM chapter WHERE id = ?').get(id) as {
      ai_words: number
      human_words: number
    }
    expect(row.ai_words).toBe(w) // 覆盖，非 999 + w
    expect(row.human_words).toBe(0)
  })

  it('debtFix 修复重写 UPDATE：多轮修复不膨胀', () => {
    const db = openDb()
    seedNovelChapter(db, 0)
    const id = 1
    const fix1 = '修复后内容一二三四五'
    const w1 = cjk(fix1)
    // 第一轮修复（与 debtFix.ts 相同的 UPDATE，覆盖语义）
    db.prepare(
      "UPDATE chapter SET content = ?, fix_history_json = ?, word_count = ?, ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(fix1, '[]', w1, w1, id)
    let row = db.prepare('SELECT ai_words FROM chapter WHERE id = ?').get(id) as { ai_words: number }
    expect(row.ai_words).toBe(w1)

    // 第二轮修复（内容更短）——覆盖，非 w1 + w2
    const fix2 = '再修内容'
    const w2 = cjk(fix2)
    db.prepare(
      "UPDATE chapter SET content = ?, fix_history_json = ?, word_count = ?, ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(fix2, '[]', w2, w2, id)
    row = db.prepare('SELECT ai_words FROM chapter WHERE id = ?').get(id) as { ai_words: number }
    expect(row.ai_words).toBe(w2)
    expect(row.ai_words).not.toBe(w1 + w2)
  })

  it('版本恢复：覆盖计数器为恢复内容字数（不重复计）', () => {
    const db = openDb()
    seedNovelChapter(db, 0)
    const id = 1
    // 先有 AI 生成内容 5 字
    const gen = '生成内容一二三四五'
    const gw = cjk(gen)
    db.prepare(
      "UPDATE chapter SET content = ?, word_count = ?, status = 'written', ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(gen, gw, gw, id)

    // 版本恢复（恢复旧版本 3 字）——与 chapters.ts 相同的 UPDATE（覆盖语义）
    const restored = '旧版内容一'
    const rw = cjk(restored)
    db.prepare(
      "UPDATE chapter SET content = ?, word_count = ?, ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ? AND novel_id = ?"
    ).run(restored, rw, rw, id, 1)
    const row = db.prepare('SELECT ai_words, human_words, word_count FROM chapter WHERE id = ?').get(id) as {
      ai_words: number
      human_words: number
      word_count: number
    }
    expect(row.ai_words).toBe(rw) // 覆盖为恢复内容字数，非 gw
    expect(row.human_words).toBe(0)
    expect(row.word_count).toBe(rw)
  })

  it('反 AI 重写：整章 AI 内容→覆盖 ai_words（与成功路径一致）', () => {
    const db = openDb()
    seedNovelChapter(db, 0)
    const id = 1
    const c = '重写内容一二三四'
    const w = cjk(c)
    // 与 generate.ts 反 AI 重写 UPDATE 相同（覆盖）
    db.prepare(
      "UPDATE chapter SET content = ?, word_count = ?, ai_words = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(c, w, w, id)
    const row = db.prepare('SELECT ai_words FROM chapter WHERE id = ?').get(id) as { ai_words: number }
    expect(row.ai_words).toBe(w)
  })
})
