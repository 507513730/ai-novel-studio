// 导演阶段执行器注册表（重构计划 R4.2 / spec §3.3）：stage → 执行器的显式映射。
// 每个执行器只生成一类产物；prompt 与解析统一复用 planner.ts。
import type { DatabaseSync } from 'node:sqlite'
import type { DirectorStage } from '../stages'
import type { StageContext } from './shared'
import { runDirectionsStage } from './directions'
import { runFramingStage } from './framing'
import { runMacroStage } from './macro'
import { runWorldStage } from './world'
import { runCharactersStage } from './characters'
import { runVolumesStage } from './volumes'
import { runBeatsStage } from './beats'
import { runChaptersStage } from './chapters'
import { runRefineStage } from './refine'

export type StageExecutor = (db: DatabaseSync, novelId: number, ctx: StageContext) => Promise<void>

export const STAGE_EXECUTORS: Record<DirectorStage, StageExecutor> = {
  inspiration: async () => {
    /* 创建书即完成（产物判定见 artifacts.ts） */
  },
  directions: runDirectionsStage,
  framing: runFramingStage,
  macro: runMacroStage,
  world: runWorldStage,
  characters: runCharactersStage,
  volumes: runVolumesStage,
  beats: runBeatsStage,
  chapters: runChaptersStage,
  refine: runRefineStage,
  ready: async () => {
    /* 检查点阶段，无产物生成 */
  }
}
