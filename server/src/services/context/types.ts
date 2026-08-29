// 上下文域共享类型（重构计划 R6.1 / spec §3.5）
import type { LlmMessage } from '../llm/types'

export interface CharacterLedgerEntry {
  id: number
  name: string
  status: string
  profile: string
}

export interface FrozenContext {
  writingRules?: string
  contract: string
  world: string
  characters: string
  external?: string // P4 外部资料直塞
  guidance?: string // P19 ①：书级创作引导
  hash: string
}

export interface ChapterWriteContext {
  messages: LlmMessage[]
  frozenHash: string
  budgetUsed: number
  budgetLimit: number
}

export type { LlmMessage }
