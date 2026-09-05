import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import diagnostics from '../scripts/e2e/diagnostics.cjs'
import { join } from 'node:path'
import {
  assertActiveGuide, assertEvidence, assertRelease, assertSuites, assertVersionDocs,
  executePublish, prepareVersion, selectRuns, unmatchedPublishedRows
} from '../scripts/release-contracts.mjs'

const head = 'a'.repeat(40)
const provider = 'opencode-go'
const version = '1.1.1'
const bundleHash = 'b'.repeat(64)
const expected = { mode: 'full', provider, head, version, bundleHash }
const suites = () => ['T1', 'T2', 'T3', 'T4', 'T5'].map(id => ({ id, completed: true, pass: 1, fail: 0 }))
const evidence = () => ({ ...expected, code: 0, packaged: true, dirty: false, completedAt: new Date().toISOString(), suites: suites() })

describe('发布证据', () => {
  it('只接受同提交、同供应商、同版本与安装包的完整结果', () => {
    expect(() => assertEvidence(evidence(), expected)).not.toThrow()
  })
  it.each([
    { head: 'old' }, { version: '1.1.0' }, { bundleHash: 'old' }, { dirty: true },
    { dirty: undefined }, { code: 1 }, { mode: 'probe-directions' }, { packaged: false },
    { provider: 'deepseek' }, { completedAt: 'invalid' }, { completedAt: '2000-01-01T00:00:00Z' }
  ])('拒绝不匹配或过期证据：%j', (patch) => {
    expect(() => assertEvidence({ ...evidence(), ...patch }, expected)).toThrow()
  })
  it('拒绝部分、重复、空断言和未完成套件', () => {
    expect(() => assertSuites(suites().slice(0, 4))).toThrow()
    expect(() => assertSuites([...suites().slice(0, 4), suites()[0]])).toThrow()
    expect(() => assertSuites(suites().map(x => ({ ...x, pass: 0 })))).toThrow()
    expect(() => assertSuites(suites().map(x => ({ ...x, completed: false })))).toThrow()
    expect(() => assertSuites(suites().map(x => ({ ...x, fail: 1 })))).toThrow()
  })
})

describe('发布顺序与远端验收', () => {
  const order = ['prepare', 'backup', 'smoke', 'full', 'evidence', 'pushMain', 'mainCi', 'tag', 'tagCi', 'release']
  it('所有前置检查通过后才推送与发布', async () => {
    const seen: string[] = []
    const steps = Object.fromEntries(order.map(name => [name, async () => { seen.push(name) }]))
    await executePublish(steps)
    expect(seen).toEqual(order)
  })
  it.each(['prepare', 'backup', 'smoke', 'full', 'evidence', 'mainCi'])('前置 %s 失败绝不打 tag', async (failed) => {
    const steps = Object.fromEntries(order.map(name => [name, vi.fn(async () => { if (name === failed) throw Error('injected') })]))
    await expect(executePublish(steps)).rejects.toThrow('injected')
    expect(steps.tag).not.toHaveBeenCalled()
    expect(steps.release).not.toHaveBeenCalled()
  })
  it('不借用其他 SHA、分支、工作流或手动 run 的绿勾', () => {
    const base = { headSha: head, headBranch: 'main', event: 'push', workflowName: 'Build Release', status: 'completed', conclusion: 'success' }
    const runs = [
      { ...base, databaseId: 1 }, { ...base, databaseId: 9, headSha: 'old' },
      { ...base, databaseId: 8, headBranch: 'v1.1.1' }, { ...base, databaseId: 7, event: 'workflow_dispatch' },
      { ...base, databaseId: 2, conclusion: 'failure' }
    ]
    expect(selectRuns(runs, head, 'main', ['Build Release', 'CodeQL'])).toEqual([runs[4], null])
  })
  it('Release 必须正式且资产齐全，tag 或半套文件不算成功', () => {
    const release = { tagName: 'v1.1.1', isDraft: false, isPrerelease: false, publishedAt: new Date().toISOString(), assets: [
      'AI-Novel-Studio-Setup-1.1.1.exe', 'AI-Novel-Studio-1.1.1-portable-x64.exe',
      'latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'AI-Novel-Studio-1.1.1-arm64.dmg', 'AI-Novel-Studio-1.1.1.AppImage'
    ].map(name => ({ name })) }
    expect(() => assertRelease(release, version)).not.toThrow()
    expect(() => assertRelease({ ...release, isDraft: true }, version)).toThrow()
    expect(() => assertRelease({ ...release, isPrerelease: true }, version)).toThrow()
    expect(() => assertRelease({ ...release, assets: release.assets.slice(0, 2) }, version)).toThrow()
  })
})

describe('版本准备与文档', () => {
  const pkg = JSON.stringify({ name: 'test', version: '1.1.0' })
  const history = '# 标题\n\n## [Unreleased]\n\n- 待发修复\n\n## v1.1.0（旧版）\n\n历史必须保留\n'
  it('准备只递增一次，保留历史、移动候选说明且不重复标题', () => {
    const prepared = prepareVersion(pkg, history, 'patch', true, '2026-09-05')
    expect(prepared.previous).toBe('1.1.0')
    expect(prepared.version).toBe('1.1.1')
    expect(prepared.changelog).toContain('历史必须保留')
    expect(() => assertVersionDocs(prepared.changelog, '| 1.1.1 | 候选 |', '1.1.1')).not.toThrow()
    expect(() => prepareVersion(prepared.packageText, prepared.changelog, 'patch', false, '2026-09-05')).toThrow('尚无 tag')
  })
  it('缺失锚点或重复标题必须失败，不接受版本前缀误命中', () => {
    expect(() => prepareVersion(pkg, '# no anchor', 'patch', true, '2026-09-05')).toThrow()
    const prepared = prepareVersion(pkg, history, 'patch', true, '2026-09-05')
    expect(() => assertVersionDocs(prepared.changelog + '\n## v1.1.1', '| 1.1.1 | 候选 |', '1.1.1')).toThrow()
    expect(() => assertVersionDocs(prepared.changelog.replace('## v1.1.1', '## v1.1.10'), '| 1.1.1 | 候选 |', '1.1.1')).toThrow()
  })
  it.each(['gh run delete 123', 'git tag -d v1.1.1', 'git push origin :refs/tags/v1.1.1', 'pnpm release --bump=patch --push', 'node scripts/v072-pack-verify.mjs'])('拒绝活跃指南中的危险指令：%s', (command) => {
    expect(() => assertActiveGuide(command)).toThrow()
  })
  it('已发布台账必须对应非 draft/prerelease 的远端 Release', () => {
    expect(unmatchedPublishedRows('| 1.0.0 | ✅ 已发布 |\n| 1.1.0 | ✅ 已发布 |', [
      { tag_name: 'v1.0.0', draft: false, prerelease: false, published_at: '2026-08-29' },
      { tag_name: 'v1.1.0', draft: true, prerelease: false, published_at: null }
    ])).toEqual(['1.1.0'])
  })
})

describe('工作流与脱敏诊断契约', () => {
  it('发布汇总依赖矩阵成功，源码包含 shared 根目录且不吞 diff 失败', () => {
    const build = readFileSync(join(process.cwd(), '.github/workflows/build.yml'), 'utf8')
    expect(build).toMatch(/publish:[\s\S]*needs: build/)
    expect((build.match(/softprops\/action-gh-release/g) ?? []).length).toBe(1)
    const readiness = readFileSync(join(process.cwd(), '.github/workflows/release-readiness.yml'), 'utf8')
    expect(readiness).toContain('electron|shared)')
    expect(readiness).not.toContain('|| echo ""')
  })
  it('只输出诊断类别，不返回原始 Key 或模型响应', () => {
    const { classifyServerError } = diagnostics
    expect(classifyServerError('[api] error: Request timed out.')).toBe('upstream-timeout')
    expect(classifyServerError('[api] error: API Key sk-sensitive 403')).toBe('credential-or-permission')
    expect(classifyServerError('random private text')).toBeNull()
  })
})
