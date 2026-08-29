/** Compatibility entry point for the context domain (重构计划 R6.1 / spec §3.5)。
 * 冻结区/可变区/预算裁剪/hash 已拆至 services/context/——本文件仅保留公共导出。 */
export { buildFrozenContext } from './context/frozen'
export {
  buildChapterWriteContext,
  buildChapterReviewContext,
  buildBackfillContext,
  buildFixContext,
  buildPatchContext,
  applyPatches,
  getCharactersForChapter,
  getKnowledgeRetrieval,
  getChapterLocation
} from './context/dynamic'
export { estimateTokens } from './context/hash'
export { trimFromEnd } from './context/budget'
export type { CharacterLedgerEntry, FrozenContext, ChapterWriteContext } from './context/types'
