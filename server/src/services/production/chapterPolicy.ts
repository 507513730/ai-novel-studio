// 整本生产章节策略（重构计划 R4.3 / spec §3.4）：批次边界决策的唯一事实源——
// 跳过已有产物（artifact 驱动）、普通失败继续、ConfigError 整批熔断、生成不达标判定。
import { DatabaseSync } from 'node:sqlite'
import { ConfigError } from '../llm/errors'

export interface ChapterSelection {
  id: number
  title: string
  status: string
  content: string
}

export interface SelectionRange {
  from?: number
  to?: number
}

// 选取待生产章节：只有"无正文"（content=''）的章节进入批次——
// 已有正文即产物（kill 后恢复的跳过依据），不因旧 status 再次调用模型。
export function selectPendingChapters(
  db: DatabaseSync,
  novelId: number,
  range: SelectionRange = {}
): ChapterSelection[] {
  // P14 B4：范围授权（章节 id 区间）——P20：仅单边传参视为无效（静默全范围），to<from 报错
  if (range.from !== undefined || range.to !== undefined) {
    if (range.from === undefined || range.to === undefined) {
      throw new Error('范围授权需同时提供 from 与 to')
    }
    if (range.to < range.from) {
      throw new Error('范围授权无效：to 小于 from')
    }
  }
  let sql = "SELECT id, title, status, content FROM chapter WHERE novel_id = ? AND content = ''"
  const params: number[] = [novelId]
  if (range.from !== undefined && range.to !== undefined) {
    sql += ' AND id BETWEEN ? AND ?'
    params.push(range.from, range.to)
  }
  sql += ' ORDER BY id'
  return db.prepare(sql).all(...params) as unknown as ChapterSelection[]
}

// 生成不达标：空正文或字数不足（触发第 1 次重试；重试仍不达标计失败）
export function isGenerationSubstandard(gen: { content?: string; wordCount?: number }): boolean {
  return !gen.content || (gen.wordCount ?? 0) < 200
}

// 配置级错误（key 解密失败/路由缺失）对每章都是必然失败——整批熔断上抛（v0.24.3）；
// 其余错误计失败继续下一章。
export function isBatchFatalError(err: unknown): boolean {
  return err instanceof ConfigError
}
