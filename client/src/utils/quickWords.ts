// v0.24.4（A2 快捷词）：补全源纯逻辑——光标前文本匹配「;触发词」前缀
// 规则：以 ";" 开头的连续非空白段作为匹配窗；无 ";" 或已含空格/换行则不触发
import type { Completion, CompletionContext } from '@codemirror/autocomplete'

export interface QuickWordEntry {
  key: string
  value: string
}

/** 从光标前文本提取当前触发词（None 表示不触发补全） */
export function extractTrigger(context: CompletionContext): string | null {
  const cursor = context.state.selection.main.head
  const before = context.state.doc.sliceString(Math.max(0, cursor - 60), cursor)
  const m = /;([^\s;，。！？、""''（）()【】]*)$/.exec(before)
  if (!m) return null
  const raw = m[1]
  // 触发词本身为空（刚输入 "; "）时不弹
  return raw.length === 0 ? null : raw
}

/** 依据词典生成补全项（匹配 key 忽略分号前缀；按 key 前缀过滤） */
export function buildQuickCompletions(
  dict: Record<string, string>,
  trigger: string
): Array<Completion & { key: string }> {
  const lower = trigger.toLowerCase()
  return Object.entries(dict)
    .filter(([k]) => k.startsWith(';') && k.slice(1).toLowerCase().startsWith(lower))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([k, v]) => ({
      key: k,
      label: `${k} → ${v.slice(0, 20)}${v.length > 20 ? '…' : ''}`,
      detail: v,
      apply: v,
      type: 'constant' as const
    }))
}

/** 组合源（供 CodeMirror autocompletion override 使用）——返回 CM6 CompletionResult（from 定位替换起点） */
export function makeQuickWordSource(dict: Record<string, string>) {
  return (context: CompletionContext): { from: number; options: Array<Completion & { key: string }> } | null => {
    const trigger = extractTrigger(context)
    if (!trigger) return null
    const options = buildQuickCompletions(dict, trigger)
    if (options.length === 0) return null
    const cursor = context.state.selection.main.head
    return { from: cursor - trigger.length - 1, options }
  }
}
