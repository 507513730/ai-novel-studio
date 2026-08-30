// B1/B2 地基（D124）：词条触发注入 + 已写片段检索契约。
// 纯逻辑（parseKeywords / getKbTriggerInjection / getPriorChapterRetrieval）不依赖 LLM，用内存库验证。
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { parseKeywords, getKbTriggerInjection } from '../server/src/services/kbTrigger'
import { getPriorChapterRetrieval } from '../server/src/services/context/chapterRetrieval'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

// 直接往 kb_doc 插触发词（模拟知识库词条）
function addDoc(db: DatabaseSync, opts: { title: string; content: string; keywords: string; status: string }): number {
  return Number(
    db
      .prepare("INSERT INTO kb_doc (novel_id, title, content, source, status, keywords) VALUES (0, ?, ?, 'test', ?, ?)")
      .run(opts.title, opts.content, opts.status, opts.keywords).lastInsertRowid
  )
}

function addNovel(db: DatabaseSync): number {
  return Number(db.prepare("INSERT INTO novel (inspiration, title) VALUES ('x', '书')").run().lastInsertRowid)
}

describe('B1 词条触发注入（kbTrigger）', () => {
  it('parseKeywords 按中英文逗号/顿号切分并去重', () => {
    expect(parseKeywords('楠木盒, 临江古玩街，物忆；楠木盒')).toEqual(['楠木盒', '临江古玩街', '物忆'])
    expect(parseKeywords('')).toEqual([])
    expect(parseKeywords('  ')).toEqual([])
  })

  it('query 命中触发词即注入该词条；未命中返回 null', () => {
    const db = makeDb()
    addDoc(db, { title: '物忆设定', content: '触碰旧物即可读取记忆', keywords: '物忆，楠木盒', status: 'indexed' })
    addDoc(db, { title: '无关', content: '与主题无关', keywords: '机场', status: 'indexed' })

    const hit = getKbTriggerInjection(db, 0, '主角林默触碰楠木盒读取物忆')
    expect(hit).not.toBeNull()
    expect(hit).toContain('物忆设定')
    expect(hit).toContain('物忆')

    const miss = getKbTriggerInjection(db, 0, '今天下雨了')
    expect(miss).toBeNull()
    db.close()
  })

  it('排除 status=direct 与空 keywords 词条', () => {
    const db = makeDb()
    addDoc(db, { title: '直塞', content: '直塞资料', keywords: '直塞词', status: 'direct' })
    addDoc(db, { title: '无词触发', content: '无关键词', keywords: '', status: 'indexed' })
    expect(getKbTriggerInjection(db, 0, '直塞词 无词')).toBeNull()
    db.close()
  })
})

describe('B2 地基（已写片段检索）', () => {
  it('只检索当前章节之前的已写章节，返回相似片段', () => {
    const db = makeDb()
    const novelId = addNovel(db)
    const volId = Number(
      db.prepare("INSERT INTO volume (novel_id, title, order_index) VALUES (?, '第一卷', 0)").run(novelId).lastInsertRowid
    )
    const put = (title: string, content: string, status: string): number =>
      Number(
        db
          .prepare("INSERT INTO chapter (novel_id, volume_id, title, summary, content, status) VALUES (?, ?, ?, '', ?, ?)")
          .run(novelId, volId, title, content, status).lastInsertRowid
      )
    put('第一章', '林默在古玩街触碰楠木盒，读取到物忆碎片。', 'written')
    const curr = put('第二章', '雨夜探铺，揭开调包案一角。', 'written')

    const ref = getPriorChapterRetrieval(db, novelId, curr, '楠木盒 物忆 林默 古玩街')
    expect(ref).not.toBeNull()
    expect(ref).toContain('已写章节参考')
    expect(ref).toContain('第一章')
    db.close()
  })
})
