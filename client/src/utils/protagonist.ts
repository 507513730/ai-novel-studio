// v0.23.1（批次 B6）：主角名提取统一（此前 ChapterExecutionPage 与 NovelListPage 双实现，
// 正则已漂移——取容忍中文引号/括号的版本为唯一实现）
/** 「主角必须叫 Jing」类文本 → 提取规范名（含中文引号/括号/空格容忍） */
export function extractProtagonistName(text: string): string {
  if (!text.includes('主角')) return ''
  const m = /(?:必须|要|应|请)?(?:叫|是|名为|名)?[「「"“'（(]*([^\s「」"“”'’（）()，。、；：!?！？]{1,12})[」」"”'’（）)]?$/.exec(text.replace(/^.+?(叫|是|名为|名)/, '$1'))
  return m ? m[1] : ''
}
