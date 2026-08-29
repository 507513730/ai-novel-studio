/** Compatibility entry point for the production domain (重构计划 R4.3 / spec §3.4)。
 * 批次策略/进度投影/主循环已迁至 services/production/。 */
export { runProductionPipeline } from './production/pipeline'
export type { ProductionPipelineOptions } from './production/pipeline'
export { createProgress } from './production/progress'
export type { ProductionProgress } from './production/progress'
