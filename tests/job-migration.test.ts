// v0.23.1（批次 D1/D2）：迁 job 队列的两个重型端点——enqueueTypedJob 原子查重、
// refine-range 幂等跳过/进度/取消感知、solution-chapter 结果入 resultJson
import { describe, expect, it, afterEach, vi } from 'vitest'

// vi.mock 工厂被提升——mock 引用须经 vi.hoisted 定义
const { refineOneMock, runProductionChapterMock } = vi.hoisted(() => ({
  refineOneMock: vi.fn(),
  runProductionChapterMock: vi.fn()
}))
vi.mock('../server/src/services/planner', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    // 批次 D2：refineOne 已迁 planner——mock 避免真实 LLM 调用
    refineOne: refineOneMock
  }
})

vi.mock('../server/src/services/solutionRunner', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    runProductionChapter: runProductionChapterMock
  }
})

import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { startJobScheduler, stopJobScheduler } from '../server/src/services/jobs/scheduler'
import { enqueueTypedJob } from '../server/src/services/jobs/repository'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function setupNovelWithChapters(db: DatabaseSync, goals: string[]): { novelId: number; chapterIds: number[] } {
  const n = db.prepare('INSERT INTO novel (inspiration, title) VALUES (?, ?)').run('测试', '测试书')
  const novelId = Number(n.lastInsertRowid)
  const chapterIds: number[] = []
  for (let i = 0; i < goals.length; i++) {
    const c = db
      .prepare('INSERT INTO chapter (novel_id, title, goal_json, status) VALUES (?, ?, ?, ?)')
      .run(novelId, `第${i + 1}章`, goals[i], 'planned')
    chapterIds.push(Number(c.lastInsertRowid))
  }
  return { novelId, chapterIds }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
  stopJobScheduler()
  refineOneMock.mockReset()
  runProductionChapterMock.mockReset()
})

describe('enqueueTypedJob（批次 D）', () => {
  it('同类型同书活跃态查重（第二次 conflict）', () => {
    const db = makeDb()
    const { novelId } = setupNovelWithChapters(db, ['{}'])
    const first = enqueueTypedJob(db, 'refine-range', { novelId, from: 1, to: 99 })
    expect('jobId' in first).toBe(true)
    const second = enqueueTypedJob(db, 'refine-range', { novelId, from: 1, to: 50 })
    expect('conflict' in second).toBe(true)
    // 不同书不冲突
    const other = setupNovelWithChapters(db, ['{}'])
    const third = enqueueTypedJob(db, 'refine-range', { novelId: other.novelId, from: 1, to: 99 })
    expect('jobId' in third).toBe(true)
  })
})

describe('refine-range job（批次 D2）', () => {
  it('已细化跳过（幂等）、未细化执行、终态 done 且结果含 done/skipped', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = setupNovelWithChapters(db, [
      '{"purpose": "已有任务单", "tasks": ["t"], "scenes": ["s"], "ending": "e"}',
      '{}'
    ])
    refineOneMock.mockResolvedValue({ purpose: 'x', tasks: ['t'], scenes: ['s'], ending: 'e' })

    const { jobId } = enqueueTypedJob(db, 'refine-range', {
      novelId,
      from: chapterIds[0],
      to: chapterIds[1]
    })
    startJobScheduler(db, 60_000)
    await sleep(80)

    const job = db.prepare('SELECT status, result_json FROM job WHERE id = ?').get(jobId) as {
      status: string
      result_json: string
    }
    expect(job.status).toBe('done')
    expect(refineOneMock).toHaveBeenCalledTimes(1)
    const result = JSON.parse(job.result_json) as { done: number[]; skipped: number[] }
    expect(result.done).toEqual([chapterIds[1]])
    expect(result.skipped).toEqual([chapterIds[0]])
  })

  it('章间取消感知：取消后置 cancelled，剩余章节不再执行', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = setupNovelWithChapters(db, ['{}', '{}', '{}'])
    // 第一章慢（触发取消窗口），后续章若被调用即失败
    let calls = 0
    refineOneMock.mockImplementation(async () => {
      calls++
      if (calls === 1) await sleep(120)
      return { purpose: 'x', tasks: ['t'], scenes: ['s'], ending: 'e' }
    })

    const { jobId } = enqueueTypedJob(db, 'refine-range', {
      novelId,
      from: chapterIds[0],
      to: chapterIds[2]
    })
    startJobScheduler(db, 50)
    // 等第一章执行中（job 已 running）后取消
    await sleep(60)
    db.prepare("UPDATE job SET status = 'cancelled' WHERE id = ?").run(jobId)
    await sleep(250)

    const job = db.prepare('SELECT status FROM job WHERE id = ?').get(jobId) as { status: string }
    expect(job.status).toBe('cancelled')
    expect(refineOneMock.mock.calls.length).toBeLessThan(3)
  })
})

describe('solution-chapter job（批次 D1）', () => {
  it('执行结果（字数/降级/步骤输出）写入 resultJson', async () => {
    const db = makeDb()
    const { novelId, chapterIds } = setupNovelWithChapters(db, ['{}'])
    runProductionChapterMock.mockResolvedValue({
      content: '正文',
      wordCount: 1234,
      title: '大纲标题',
      outputs: [
        { role: '大纲', ok: true },
        { role: '终稿', ok: false, error: 'x' }
      ],
      degraded: true,
      degradedReasons: ['终稿: x']
    })

    const { jobId } = enqueueTypedJob(db, 'solution-chapter', {
      novelId,
      chapterId: chapterIds[0],
      solutionId: 7
    })
    startJobScheduler(db, 60_000)
    await sleep(80)

    const job = db.prepare('SELECT status, result_json FROM job WHERE id = ?').get(jobId) as {
      status: string
      result_json: string
    }
    expect(job.status).toBe('done')
    expect(runProductionChapterMock).toHaveBeenCalledWith(db, 7, novelId, chapterIds[0], expect.objectContaining({ isAborted: expect.any(Function) }))
    const result = JSON.parse(job.result_json) as {
      wordCount: number
      degraded: boolean
      outputs: Array<{ role: string; ok: boolean }>
    }
    expect(result.wordCount).toBe(1234)
    expect(result.degraded).toBe(true)
    expect(result.outputs).toHaveLength(2)
    expect(result.outputs[1].ok).toBe(false)
  })
})
