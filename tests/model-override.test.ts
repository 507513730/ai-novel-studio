import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildCandidates, setActiveModelOverride, getActiveModelOverride } from '../server/src/services/llm'

// P13 G1：换模型重试候选链
describe('buildCandidates（P13 G1）', () => {
  const route = {
    model: 'deepseek-v4-flash',
    providerId: 1,
    fallback: [
      { providerId: 1, model: 'deepseek-v4-pro' },
      { providerId: 2, model: 'kimi-k3' }
    ]
  }

  it('无 override → 原模型优先，fallback 降级', () => {
    const c = buildCandidates(route, null)
    expect(c[0]).toEqual({ model: 'deepseek-v4-flash', providerId: 1, degraded: false })
    expect(c).toHaveLength(3)
  })

  it('有 override → override 优先，原模型降级为 degraded', () => {
    const c = buildCandidates(route, 'qwen3.8-max')
    expect(c[0]).toEqual({ model: 'qwen3.8-max', providerId: 1, degraded: false })
    expect(c[1]).toEqual({ model: 'deepseek-v4-flash', providerId: 1, degraded: true })
    expect(c[2].model).toBe('deepseek-v4-pro')
    expect(c).toHaveLength(4)
  })

  it('override 读写（模块级活动覆盖）', () => {
    beforeEach(() => setActiveModelOverride(null))
    afterEach(() => setActiveModelOverride(null))
    expect(getActiveModelOverride()).toBeNull()
    setActiveModelOverride('glm-5.2')
    expect(getActiveModelOverride()).toBe('glm-5.2')
  })
})
