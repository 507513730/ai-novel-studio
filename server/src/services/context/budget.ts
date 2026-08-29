// 上下文域预算裁剪（重构计划 R6.1 / P20 C5/C6）：段切分与按优先序裁剪的唯一实现。
import { estimateTokens } from './hash'

// 段起始标记全集（含动态 marker 前缀，用于段边界识别）
const SEGMENT_STARTS = [
  '【书级合约】',
  '【世界观手册】',
  '【势力】',
  '【地图】',
  '【时间线】',
  '【角色账本】',
  '【外部资料】',
  '【创作引导】',
  '【写作要求】',
  '【本次引导】',
  '【未回收伏笔',
  '【已确认事实',
  '【流派节奏模板',
  '【爽点兑现方式】',
  '【本章三方会审约束',
  '【绑定写法要求',
  '【本章角色特写',
  '【知识库检索',
  '【当前定位】',
  '【时间线（最近事件）】',
  '【本章任务单】',
  '【前文回顾】'
]

/** 将文本按段起始标记切分为段（段 = 从标记到下一边界） */
function splitSegments(text: string): string[] {
  const segments: string[] = []
  let rest = text
  for (;;) {
    if (!rest.trim()) break
    let bestIdx = -1
    for (const s of SEGMENT_STARTS) {
      const idx = rest.indexOf(s)
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx
    }
    if (bestIdx === -1) {
      segments.push(rest)
      break
    }
    if (bestIdx > 0) {
      const head = rest.slice(0, bestIdx)
      if (head.trim()) segments.push(head)
      rest = rest.slice(bestIdx)
    }
    let end = rest.length
    for (const s of SEGMENT_STARTS) {
      const idx = rest.indexOf(s, 1)
      if (idx !== -1 && idx < end) end = idx
    }
    if (end <= 0) {
      segments.push(rest)
      break
    }
    segments.push(rest.slice(0, end))
    rest = rest.slice(end)
  }
  return segments
}

/**
 * 预算裁剪：按 markers（裁剪优先序）从尾到头的目标段逐段删除。
 * v0.8.0（审查 #4）：只删"目标段本身"（marker 到下一段边界），
 * 不再 slice(0, markerIdx) 把物理位于其后的其他段（如【本章任务单】）连带整段删除。
 */
export function trimFromEnd(text: string, markers: string[], budget: number): string {
  if (estimateTokens(text) <= budget) return text
  const kept = splitSegments(text)
  for (const m of markers) {
    if (estimateTokens(kept.join('\n')) <= budget) break
    let foundIdx = -1
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].startsWith(m)) {
        foundIdx = i
        break
      }
    }
    if (foundIdx !== -1) kept.splice(foundIdx, 1)
  }
  return kept.join('\n')
}
