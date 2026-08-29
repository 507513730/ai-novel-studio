/** Compatibility entry point for the LLM domain (重构计划 R6.2 / spec §3.5)。
 * 路由/候选链/请求体/usage 提取/供应商调用已拆至 services/llm/——本文件仅保留公共导出。
 * 注意：tests 中 vi.mock('./llm') 的 callLlm 桩仍生效（mock 拦截模块边界）。 */
export { getRouteConfig } from './llm/routes'
export { ConfigError } from './llm/errors'
export {
  buildCandidates,
  setActiveModelOverride,
  getActiveModelOverride
} from './llm/candidates'
export { buildBody } from './llm/request'
export { callLlm } from './llm/caller'
export type { RouteConfig, LlmMessage, LlmCallOptions, LlmResult } from './llm/types'
