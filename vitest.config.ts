import { defineConfig } from 'vitest/config'

// v0.24.4：vitest 排除本地 git worktree（协作者重构 worktree 的测试副本不参与主仓库基线）
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'out/**', 'release/**', '.worktrees/**']
  }
})
