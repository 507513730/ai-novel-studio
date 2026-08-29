// 共享文本工具（重构计划 R6.3）：跨流程重复使用的纯函数。
// CJK 字数口径（全仓唯一事实源）：只统计 [\u4e00-\u9fff]——章节字数/版本快照/恢复计数共用。
export function countCJKChars(content: string): number {
  return (content.match(/[\u4e00-\u9fff]/g) ?? []).length
}
