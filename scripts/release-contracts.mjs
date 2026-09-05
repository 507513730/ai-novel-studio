export const REQUIRED_SUITES = ['T1', 'T2', 'T3', 'T4', 'T5']
export const MAIN_WORKFLOWS = ['Build Release', 'CodeQL', 'Release Readiness', 'Docs Lint']

export function assertSuites(suites) {
  if (!Array.isArray(suites) || suites.length !== REQUIRED_SUITES.length) throw Error('完整 T1-T5 证据缺失')
  for (const id of REQUIRED_SUITES) {
    const matches = suites.filter(suite => suite.id === id)
    if (matches.length !== 1 || matches[0].completed !== true || matches[0].fail !== 0 || !Number.isInteger(matches[0].pass) || matches[0].pass < 1) {
      throw Error(id + ' 未完整通过或重复')
    }
  }
}

export function assertEvidence(evidence, expected) {
  if (!evidence || evidence.code !== 0 || evidence.mode !== expected.mode || evidence.provider !== expected.provider || evidence.head !== expected.head || evidence.version !== expected.version || evidence.bundleHash !== expected.bundleHash || evidence.dirty !== false || evidence.packaged !== true) {
    throw Error('验证证据与当前提交/版本/安装包不匹配')
  }
  const completed = Date.parse(evidence.completedAt)
  if (!Number.isFinite(completed) || completed > Date.now() + 300_000 || Date.now() - completed > 24 * 60 * 60 * 1000) throw Error('测试证据过期或时间非法')
  if (evidence.mode === 'full') assertSuites(evidence.suites)
}

export function selectRuns(runs, head, branch, workflows) {
  return workflows.map(name => {
    const candidates = runs.filter(run => run.headSha === head && run.headBranch === branch && run.workflowName === name && run.event === 'push')
    return candidates.sort((a, b) => b.databaseId - a.databaseId)[0] ?? null
  })
}

export function assertRelease(release, version) {
  if (release.tagName !== 'v' + version || release.isDraft !== false || release.isPrerelease !== false || !Number.isFinite(Date.parse(release.publishedAt))) throw Error('Release 尚未正式发布')
  const names = (release.assets ?? []).map(asset => asset.name)
  for (const file of ['AI-Novel-Studio-Setup-' + version + '.exe', 'AI-Novel-Studio-' + version + '-portable-x64.exe', 'latest.yml', 'latest-mac.yml', 'latest-linux.yml']) {
    if (!names.includes(file)) throw Error('Release 缺少资产：' + file)
  }
  for (const suffix of ['.dmg', '.AppImage']) {
    if (!names.some(name => name.includes(version) && name.endsWith(suffix))) throw Error('Release 缺少平台资产：' + suffix)
  }
}

export function assertVersionDocs(changelog, versioning, version) {
  const headings = [...changelog.matchAll(/^## v(\d+\.\d+\.\d+)(?=[^\d.]|$)/gm)].map(match => match[1])
  if (headings.filter(value => value === version).length !== 1 || headings[0] !== version) throw Error('当前版本标题必须唯一且位于历史版本之前')
  if ((changelog.match(/^## \[Unreleased\]\s*$/gm) ?? []).length !== 1 || changelog.indexOf('## [Unreleased]') > changelog.indexOf('## v' + version)) throw Error('Unreleased 标题必须唯一并位于顶部')
  if (versioning.split('\n').filter(line => line.startsWith('| ' + version + ' |')).length !== 1) throw Error('版本台账行缺失或重复')
}

export function prepareVersion(packageText, changelog, kind, tagged, date) {
  if (!['patch', 'minor', 'major'].includes(kind)) throw Error('非法版本增量')
  if (!tagged) throw Error('当前候选版本尚无 tag，禁止重复 bump')
  const pkg = JSON.parse(packageText)
  const previous = pkg.version
  if (!/^\d+\.\d+\.\d+$/.test(previous)) throw Error('版本号非法')
  const [major, minor, patch] = previous.split('.').map(Number)
  const next = kind === 'major' ? [major + 1, 0, 0] : kind === 'minor' ? [major, minor + 1, 0] : [major, minor, patch + 1]
  pkg.version = next.join('.')
  const normalized = changelog.replaceAll('\r\n', '\n')
  const parts = normalized.split(/^## \[Unreleased\]\s*$/m)
  if (parts.length !== 2) throw Error('Unreleased 标题缺失或重复，未修改文件')
  const historyAt = parts[1].search(/^## /m)
  if (historyAt < 0) throw Error('历史版本段缺失，未修改文件')
  const pending = parts[1].slice(0, historyAt).trim() || '- 待补充发布说明（发布前必须完成）'
  const output = parts[0].trimEnd() + '\n\n## [Unreleased]\n\n## v' + pkg.version + '（' + date + '）\n\n' + pending + '\n\n' + parts[1].slice(historyAt)
  return { previous, version: pkg.version, packageText: JSON.stringify(pkg, null, 2) + '\n', changelog: output }
}

export async function executePublish(steps) {
  for (const name of ['prepare', 'backup', 'smoke', 'full', 'evidence', 'pushMain', 'mainCi', 'tag', 'tagCi', 'release']) await steps[name]()
}

export function assertActiveGuide(text) {
  if (/^\s*(?:gh run delete|git tag -d|git push origin :refs\/tags\/)/m.test(text)) throw Error('活跃指南仍包含删除失败证据或重打 tag 的操作')
  if (/pnpm release --bump[^\n`]*--push/.test(text)) throw Error('活跃指南仍混合版本准备与发布')
  if (/^\s*node scripts\/v072-pack-verify\.mjs/m.test(text)) throw Error('活跃指南仍使用旧明文验收入口')
}

export function unmatchedPublishedRows(versioning, releases) {
  const available = new Set(releases.filter(item => !item.draft && !item.prerelease && item.published_at).map(item => item.tag_name.replace(/^v/, '')))
  return versioning.split('\n').filter(line => line.startsWith('| ') && line.includes('✅ 已发布'))
    .map(line => line.split('|')[1].trim()).filter(version => !available.has(version))
}
