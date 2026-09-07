import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const expressRequire = createRequire(require.resolve('express'))
const bodyParserRequire = createRequire(expressRequire.resolve('body-parser'))

describe.each([
  ['express', expressRequire],
  ['body-parser', bodyParserRequire]
] as const)('%s 的 qs 安全回归', (_name, dependencyRequire) => {
  const qs = dependencyRequire('qs') as typeof import('qs')

  it('拒绝方括号逗号数组绕过长度上限', () => {
    expect(() => qs.parse('a[]=1,2,3,4', {
      comma: true,
      arrayLimit: 3,
      throwOnLimitExceeded: true
    })).toThrow(RangeError)
  })

  it('攻击者提供的 constructor.isBuffer 不会导致序列化抛错', () => {
    const parsed = qs.parse('x[constructor][isBuffer]=y', { plainObjects: true })
    expect(() => qs.stringify(parsed)).not.toThrow()
  })

  it('正常查询参数往返不变', () => {
    const query = { search: '章节', page: '2' }
    expect(qs.parse(qs.stringify(query))).toEqual(query)
  })
})
