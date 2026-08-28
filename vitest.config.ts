import { defineConfig } from 'vitest/config'

// v0.24.4：vitest 排除本地 git worktree（协作者重构 worktree 的测试副本不参与主仓库基线）
// v0.25.0（审查 M1）：纳入 .tsx 组件测试——此前前端 13,296 行零组件测试。
// 组件测试文件首行以 `// @vitest-environment jsdom` 声明，服务端测试仍走 node 环境。
//
// 注意：这里刻意**不引入 @vitejs/plugin-react**——它对 include 内所有文件生效，
// 会把 Babel 转换套到 43 个服务端测试文件上，实测导致整轮套件从 9s 退化到长时间挂起。
// 测试不需要 HMR / fast refresh，用 esbuild 的 automatic JSX runtime 即可（无需 import React）。
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules/**', 'out/**', 'release/**', '.worktrees/**']
  }
})
