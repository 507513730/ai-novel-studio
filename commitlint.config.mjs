// 提交规范（Conventional Commits）——CI 检查（.github/workflows/commitlint.yml），本地无钩子
// 类型遵循 @commitlint/config-conventional：feat/fix/docs/refactor/test/chore/ci/style/perf/build/revert
// 开放仓库规范：提交信息即对外历史，保持整洁

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'ci', 'style', 'perf', 'build', 'revert']
    ],
    // 主题描述以中文或英文开头均可，长度 10-100（覆盖 "fix: xxx" 到完整描述）
    'subject-min-length': [2, 'always', 8],
    'subject-max-length': [2, 'always', 100],
    'header-max-length': [2, 'always', 110],
    'body-max-line-length': [0],
    'footer-max-line-length': [0]
  }
}
