/** Compatibility entry point for the director domain (重构计划 R4.2 / spec §3.3)。
 * 阶段元数据/检查点/产物判定/执行器/主循环已迁至 services/director/。 */
export { STAGE_ORDER, STAGE_LABELS } from './director/stages'
export type { DirectorStage } from './director/stages'
export {
  loadDirectorTask,
  saveDirectorTask,
  directorProgress
} from './director/checkpoint'
export type { DirectorCheckpoint, DirectorTask } from './director/checkpoint'
export { isStageDone } from './director/artifacts'
export { runDirectorPipeline } from './director/pipeline'
export type { PipelineContext } from './director/pipeline'
