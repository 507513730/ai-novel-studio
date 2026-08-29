// 章节执行路由聚合器（重构计划 R5 / spec §3）：原 924 行单文件按职责拆分——
// create（CRUD）/ generate（SSE 生成）/ review（审核修复校对）/ backfill（回灌与记忆面）/
// versions（版本）/ search（搜索与上下文预览）/ aiAction（AI 编辑）。
// 路径、方法、状态码与 camelCase 响应保持不变（契约见 tests/api-contracts.test.ts）。
import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { registerChapterCreateRoutes } from './create'
import { registerChapterGenerationRoutes } from './generate'
import { registerChapterReviewRoutes } from './review'
import { registerChapterBackfillRoutes } from './backfill'
import { registerChapterVersionRoutes } from './versions'
import { registerChapterSearchRoutes } from './search'
import { registerChapterAiActionRoutes } from './aiAction'

export function createChapterExecutionRouter(db: DatabaseSync): Router {
  const router = Router()
  registerChapterCreateRoutes(router, db)
  registerChapterGenerationRoutes(router, db)
  registerChapterReviewRoutes(router, db)
  registerChapterBackfillRoutes(router, db)
  registerChapterVersionRoutes(router, db)
  registerChapterSearchRoutes(router, db)
  registerChapterAiActionRoutes(router, db)
  return router
}
