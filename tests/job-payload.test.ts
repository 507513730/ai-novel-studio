// 重构计划 R2：job payload 域边界 Zod 解析契约——
// 强类型输出、损坏 JSON / 未知类型 / 字段不合规 → JobPayloadError 语义化失败、
// modelOverride（换模型重试 P13 G1）穿过解析保留。
import { describe, expect, it } from 'vitest'
import { parseJobPayload, JobPayloadError } from '../server/src/services/jobs/payload'

describe('parseJobPayload', () => {
  it('director payload 解析为强类型并补齐默认消费字段', () => {
    const p = parseJobPayload('director', JSON.stringify({ novelId: 7, mode: 'supervised' }))
    expect(p).toEqual({ novelId: 7, mode: 'supervised' })
  })

  it('refine-range payload 保留 from/to 与 modelOverride（换模型重试语义）', () => {
    const p = parseJobPayload(
      'refine-range',
      JSON.stringify({ novelId: 1, from: 3, to: 9, modelOverride: 'deepseek-v4-pro' })
    )
    expect(p).toEqual({ novelId: 1, from: 3, to: 9, modelOverride: 'deepseek-v4-pro' })
  })

  it('solution-chapter payload 需携带 solutionId 与 chapterId', () => {
    const p = parseJobPayload('solution-chapter', JSON.stringify({ novelId: 1, solutionId: 7, chapterId: 42 }))
    expect(p).toMatchObject({ solutionId: 7, chapterId: 42 })
  })

  it('损坏 JSON → JobPayloadError（含 corrupted payload_json 语义）', () => {
    expect(() => parseJobPayload('director', '{corrupted!!!')).toThrow(JobPayloadError)
    expect(() => parseJobPayload('director', '{corrupted!!!')).toThrow(/corrupted payload_json/)
  })

  it('未知类型 → JobPayloadError（unknown job type 语义）', () => {
    expect(() => parseJobPayload('mystery-type', '{"novelId":1}')).toThrow(/unknown job type/)
  })

  it('字段不合规（缺 novelId / novelId 非数值）→ JobPayloadError', () => {
    expect(() => parseJobPayload('director', '{}')).toThrow(JobPayloadError)
    expect(() => parseJobPayload('production', '{"novelId":"abc"}')).toThrow(JobPayloadError)
  })

  it('solution-chapter 缺 chapterId → JobPayloadError', () => {
    expect(() => parseJobPayload('solution-chapter', '{"novelId":1,"solutionId":7}')).toThrow(/invalid solution-chapter payload/)
  })
})
