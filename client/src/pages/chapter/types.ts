// v0.25.0（审查 S1）：ChapterExecutionPage 拆分出的共享类型与工具。
// 此前这些类型内联在 1989 行的页面文件里，抽出的子组件无法独立引用。

/** 中文字符计数（字数分离口径：与服务端 word_count 一致） */
export function countCjk(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length
}

export interface PendingData {
  pendingFacts: Array<{ id: number; content: string }>
  pendingCharacters: Array<{ id: number; name: string; profile: Record<string, string> }>
}

export interface ProofreadIssue {
  type: string
  location: string
  problem: string
  suggestion: string
}

export interface CtxSection {
  key: string
  label: string
  chars: number
  tokens: number
}

export interface ChapterVersion {
  id: number
  note: string
  createdAt: string
  wordCount: number
  preview: string
}

export interface ResourceDetail {
  title: string
  body: string
}

export interface MemoryData {
  characters: Array<{ name: string; states: string[] }>
  factions: Array<{ name: string; currentState: string }>
  pendingFacts: Array<{ id: number; content: string }>
}

export type ResourceTabKey = 'chapters' | 'characters' | 'world' | 'rules'
