import { describe, it, expect } from 'vitest'
import { computeStyleFingerprint, fingerprintDescription } from '../server/src/services/styleFingerprint'

// 短句为主样本
const SHORT = '他推开门。风灌进来。他皱眉。灯灭了。她站在窗前。月光很淡。影子很长。谁也没有说话。'
  .repeat(20)
// 长句为主样本
const LONG = '他推开那扇沉重的铁门，北风裹着细雪灌进走廊，墙上的旧灯忽明忽暗地闪了几下，仿佛也在犹豫要不要为他照亮前路。'
  .repeat(15)
// 混合样本（长短交错 + 对话 + 标点）
const MIXED = [
  '夜色像一层浸过油的旧纱布，裹住窄巷两壁的霉斑和铁锈味。',
  '顾衍的脚步声落在湿漉漉的石板地上，三步一顿，不急不缓，像钟摆。',
  '“东西带了？”',
  '他没答话，左手轻拍了一下帆布包。',
  '风从巷尾灌过来。',
  '刀片脸从怀里掏出一个牛皮纸袋，不急着递，先在手心掂了两下。'
].join('\n').repeat(20)

describe('v0.14.0 批F-1 风格指纹计算', () => {
  it('短句样本：短句占比高、平均句长低', () => {
    const fp = computeStyleFingerprint(SHORT)
    expect(fp).not.toBeNull()
    expect(fp!.avgSentenceLen).toBeLessThan(12)
    expect(fp!.shortSentenceRatio).toBeGreaterThanOrEqual(70)
  })

  it('长句样本：长句占比高、平均句长高', () => {
    const fp = computeStyleFingerprint(LONG)
    expect(fp).not.toBeNull()
    expect(fp!.avgSentenceLen).toBeGreaterThan(20)
    expect(fp!.longSentenceRatio).toBeGreaterThan(60)
  })

  it('混合样本：对话占比 > 0、方差 > 0（捕捉变化而非仅均值）', () => {
    const fp = computeStyleFingerprint(MIXED)
    expect(fp).not.toBeNull()
    expect(fp!.dialogueRatio).toBeGreaterThan(0)
    expect(fp!.sentenceLenStd).toBeGreaterThan(0)
    expect(fp!.topFunctionWords.length).toBeGreaterThan(0)
  })

  it('样本过短 → null（统计不可靠）', () => {
    expect(computeStyleFingerprint('太短了')).toBeNull()
  })

  it('指纹描述生成（中文可读约束）', () => {
    const fp = computeStyleFingerprint(SHORT)
    const desc = fingerprintDescription(fp!)
    expect(desc).toContain('平均句长')
    expect(desc).toContain('模仿以下风格指纹写作')
  })
})
