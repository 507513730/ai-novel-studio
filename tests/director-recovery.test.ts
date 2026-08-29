// 重构计划 R4.2：导演恢复与故障注入——
// ① 阶段产物落库后中断（checkpoint 未推进），恢复跳过已完成模型调用；
// ② 决策路径去重 + 按阶段熔断（同阶段累计超限 → 重规划超限）；
// ③ auto 模式 ready 收尾（pending 角色入册）位于 done 判定之前。
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockedCallLlmJson = vi.fn()
vi.mock('../server/src/services/jsonSafe', () => ({ callLlmJson: (...args: unknown[]) => mockedCallLlmJson(...args) }))

import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { runDirectorPipeline } from '../server/src/services/director/pipeline'
import { loadDirectorTask } from '../server/src/services/director/checkpoint'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function seedNovel(db: DatabaseSync): number {
  return Number(
    db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('灵感', '导演恢复').lastInsertRowid
  )
}

// mock 返回的是「解析后」形状（真实 callLlmJson 会先过 parse 再返回）
const PARSED_DIRECTIONS = [
  { id: 'd1', scheme: { title: '方向A', sellingPoint: '爽点', genre: '都市' } },
  { id: 'd2', scheme: { title: '方向B', sellingPoint: '悬念', genre: '悬疑' } }
]

function countCalls(label: string): number {
  return mockedCallLlmJson.mock.calls.filter((c) => c[4] === label).length
}

beforeEach(() => {
  mockedCallLlmJson.mockReset()
})

describe('导演恢复与故障注入（R4.2）', () => {
  it('阶段产物落库后中断：恢复时跳过已完成模型调用（directions 只调用一次）', async () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    // 第一次运行：directions 成功落库，framing 不可恢复失败 → 任务 failed，checkpoint 停在 framing
    mockedCallLlmJson.mockImplementation((_db: unknown, _t: string, _o: unknown, _p: unknown, label: string) => {
      if (label === 'director-directions') return Promise.resolve(PARSED_DIRECTIONS)
      return Promise.reject(new Error('fatal: 审核链路中断'))
    })
    await runDirectorPipeline(db, novelId, 'auto', { chaptersPerVolume: 20 })
    let task = loadDirectorTask(db, novelId)!
    expect(task.status).toBe('failed')
    expect(task.checkpoint.stage).toBe('framing')

    // 第二次运行：directions 产物已落库 → 不再调用模型；framing 成功后 macro 失败
    mockedCallLlmJson.mockImplementation((_db: unknown, _t: string, _o: unknown, _p: unknown, label: string) => {
      if (label === 'director-directions') return Promise.resolve(PARSED_DIRECTIONS)
      if (label === 'director-framing') return Promise.resolve({ summary: '设定摘要' })
      return Promise.reject(new Error('fatal: 宏观规划中断'))
    })
    await runDirectorPipeline(db, novelId, 'auto', { chaptersPerVolume: 20 })

    expect(countCalls('director-directions')).toBe(1) // 恢复跳过已完成模型调用
    expect(countCalls('director-framing')).toBe(2) // 上次失败、本次执行
    task = loadDirectorTask(db, novelId)!
    expect(task.status).toBe('failed')
    expect(task.checkpoint.stage).toBe('macro')
    db.close()
  })

  it('按阶段熔断：同阶段累计 4 个不同失败签名后，重入即重规划超限', { timeout: 30000 }, async () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    let failSeq = 0
    mockedCallLlmJson.mockImplementation((_db: unknown, _t: string, _o: unknown, _p: unknown, label: string) => {
      if (label === 'director-directions') {
        failSeq += 1
        return Promise.reject(new Error(`429 rate limit 第 ${failSeq} 次`))
      }
      return Promise.reject(new Error('fatal: 后续阶段不可用'))
    })

    // 前 4 次运行：directions 各积累一个不同签名（可重试 → 推进到 framing 后快速失败）
    for (let i = 0; i < 4; i++) {
      await runDirectorPipeline(db, novelId, 'auto', { chaptersPerVolume: 20 })
      expect(loadDirectorTask(db, novelId)!.checkpoint.decisions.filter((d) => d.startsWith('directions:'))).toHaveLength(
        i + 1
      )
    }
    // 第 5 次：进入 directions 时同阶段签名数 > 上限 → 重规划超限
    await runDirectorPipeline(db, novelId, 'auto', { chaptersPerVolume: 20 })
    const task = loadDirectorTask(db, novelId)!
    expect(task.status).toBe('failed')
    expect(task.checkpoint.displayStatus).toBe('重规划超限，需人工介入')
    expect(task.checkpoint.blockingReason).toContain('超过上限')
    db.close()
  })

  it('auto 模式 ready 收尾在 done 判定之前：pending 角色自动入册', async () => {
    const db = makeDb()
    const novelId = seedNovel(db)
    // 预置全部产物（含 pending 角色）→ 全程零模型调用
    db.prepare('UPDATE novel SET direction_json = ?, framing_json = ? WHERE id = ?').run(
      JSON.stringify([{ id: 'd1', scheme: {} }, { id: 'd2', scheme: {} }]),
      JSON.stringify({ summary: 's', macro: { storyEngine: 'e' } }),
      novelId
    )
    db.prepare('INSERT INTO world (novel_id, manual_json, factions_json, map_json) VALUES (?, ?, ?, ?)').run(
      novelId,
      JSON.stringify({ a: 1, b: 2 }),
      '[]',
      '{}'
    )
    const insertChar = db.prepare("INSERT INTO character (novel_id, name, profile_json, status) VALUES (?, ?, '{}', 'pending')")
    for (let i = 0; i < 6; i++) insertChar.run(novelId, `角色${i}`)
    const volIds: number[] = []
    for (let i = 0; i < 2; i++) {
      volIds.push(
        Number(
          db.prepare("INSERT INTO volume (novel_id, title, order_index) VALUES (?, ?, ?)").run(novelId, `卷${i}`, i)
            .lastInsertRowid
        )
      )
    }
    db.prepare("INSERT INTO beat (volume_id, title, summary, order_index) VALUES (?, '拍1', '{}', 0)").run(volIds[0])
    for (let i = 0; i < 5; i++) {
      db.prepare(
        "INSERT INTO chapter (novel_id, volume_id, title, goal_json, content, status) VALUES (?, ?, ?, '{\"purpose\":\"x\"}', '', 'planned')"
      ).run(novelId, volIds[0], `第${i + 1}章`)
    }

    await runDirectorPipeline(db, novelId, 'auto', { chaptersPerVolume: 20 })

    expect(mockedCallLlmJson).not.toHaveBeenCalled() // 产物驱动幂等：全程跳过模型调用
    const task = loadDirectorTask(db, novelId)!
    expect(task.status).toBe('done')
    expect(task.checkpoint.stage).toBe('ready')
    const roster = db
      .prepare("SELECT COUNT(*) AS c FROM character WHERE novel_id = ? AND status = 'roster'")
      .get(novelId) as { c: number }
    expect(roster.c).toBe(6)
    db.close()
  })
})
