// v0.14.0（批F/I5）：风格指纹——从参考文本计算结构统计特征（Stylometry，D89）
// 特征选择依据（Wikipedia Stylometry）：平均句长（经典 writer invariant）+ 句长方差/短句占比
// （"mix of long and short sentences 与 consistent mid-length 均值相同——需捕捉变化"）+
// 段落/标点/对话等结构特征；**避免内容词**（主题污染——只保留结构元素）

export interface StyleFingerprint {
  sentenceCount: number
  avgSentenceLen: number // 字
  sentenceLenStd: number
  shortSentenceRatio: number // ≤8 字句占比（节奏感）
  longSentenceRatio: number // ≥30 字句占比
  avgParagraphLen: number // 字
  punctuationDensity: number // 每 100 字标点数
  dialogueRatio: number // 对话行占比（含引号行）
  topFunctionWords: string[] // 高频功能词（结构标记，非内容词）
}

const SENTENCE_END = /[。！？!?…]+/g
const FUNCTION_WORDS = new Set([
  '的', '了', '是', '在', '他', '她', '它', '这', '那', '我', '你', '我们', '你们',
  '他们', '她们', '着', '过', '也', '都', '就', '又', '还', '很', '地', '得', '和', '与',
  '或', '但', '而', '并', '便', '却', '才', '再', '只', '把', '被', '让', '向', '从', '对'
])

export function computeStyleFingerprint(text: string): StyleFingerprint | null {
  const cleaned = text.replace(/[\r\n\t]/g, '\n').trim()
  if (cleaned.length < 500) return null // 样本过小统计不可靠

  // 句切分（按句末标点）
  const sentences = cleaned
    .split(SENTENCE_END)
    .map((s) => s.replace(/^[\n\s]+|[\n\s]+$/g, ''))
    .filter((s) => s.length > 0)
  if (sentences.length < 10) return null

  const lens = sentences.map((s) => s.length)
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length
  const variance = lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length
  const std = Math.sqrt(variance)
  const shortRatio = lens.filter((l) => l <= 8).length / lens.length
  const longRatio = lens.filter((l) => l >= 30).length / lens.length

  // 段落（按空行/换行）
  const paragraphs = cleaned.split(/\n{2,}/).filter((p) => p.trim().length > 0)
  const avgPara = paragraphs.length > 0 ? cleaned.length / paragraphs.length : 0

  // 标点密度（句末 + 逗号/分号/冒号/引号——引号用码点转义防变体问题）
  const punctuationHits = (cleaned.match(/[。！？!?…，,；;：:\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F—–]/g) ?? []).length
  const punctDensity = (punctuationHits / cleaned.length) * 100

  // 对话占比（含引号的行比例）
  const lines = cleaned.split('\n').filter((l) => l.trim().length > 0)
  const dialogueLines = lines.filter((l) => /[\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F]/.test(l)).length
  const dialogueRatio = lines.length > 0 ? dialogueLines / lines.length : 0

  // 高频功能词（结构标记；取前 5）
  const wordCounts = new Map<string, number>()
  for (const w of FUNCTION_WORDS) {
    const count = (cleaned.match(new RegExp(w, 'g')) ?? []).length
    if (count > 0) wordCounts.set(w, count)
  }
  const topFunctionWords = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w)

  return {
    sentenceCount: sentences.length,
    avgSentenceLen: Math.round(avg * 10) / 10,
    sentenceLenStd: Math.round(std * 10) / 10,
    shortSentenceRatio: Math.round(shortRatio * 100),
    longSentenceRatio: Math.round(longRatio * 100),
    avgParagraphLen: Math.round(avgPara),
    punctuationDensity: Math.round(punctDensity * 10) / 10,
    dialogueRatio: Math.round(dialogueRatio * 100),
    topFunctionWords
  }
}

/** 指纹 → 中文可读的风格约束描述（注入生成） */
export function fingerprintDescription(fp: StyleFingerprint): string {
  const rhythm =
    fp.shortSentenceRatio >= 30
      ? `短句为主（${fp.shortSentenceRatio}% 为 ≤8 字短句），节奏明快`
      : fp.longSentenceRatio >= 30
        ? `长句为主（${fp.longSentenceRatio}% 为 ≥30 字长句），节奏舒缓绵密`
        : '长短句交错（短句与长句比例均衡），节奏有起伏'
  const lines = [
    `平均句长约 ${fp.avgSentenceLen} 字（标准差 ${fp.sentenceLenStd}，${rhythm}）`,
    `平均段落约 ${fp.avgParagraphLen} 字`,
    `标点密度约 ${fp.punctuationDensity} 个/百字`,
    `对话占比约 ${fp.dialogueRatio}%`,
    fp.topFunctionWords.length > 0 ? `常用语助词：${fp.topFunctionWords.join('、')}` : ''
  ].filter(Boolean)
  return `模仿以下风格指纹写作：${lines.join('；')}。`
}
