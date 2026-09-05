# 本地开发

## 环境

- Windows / pwsh 7；Node 24；pnpm（corepack 激活）；无全局 electron。
- 首次：`pnpm install --frozen-lockfile`（pnpm 主版本与 CI 保持一致，当前为 10）。

## 常用命令

```
pnpm dev          # electron-vite 三端；dev 固定 AI_NOVEL_PORT=3000
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest run
pnpm db:smoke     # 数据库冒烟（内存库 7 项检查）
pnpm build        # 三端构建
pnpm dist         # NSIS 安装版 + portable（release/）
```

## 隔离调试与验收

`node scripts/e2e/desktop-run.mjs --probe-directions` 定向检查方向生成与重做。

`node scripts/e2e/desktop-run.mjs --backup --packaged` 检查备份恢复；不加专项模式且使用 --packaged 才执行完整 T1-T5。

测试启动器自动管理临时 userData、随机端口、token 和 safeStorage 加密。不得拿固定 3000 端口的未知实例跑 round，不以明文测试 Key 换取便利。Node 直跑仅限零凭证/假凭证逻辑测试，不能代替真实 Electron 主进程与 utilityProcess 的验证。

常规 pnpm dev 可能打开已有用户数据，不作为自动化测试的默认入口。浏览器直连的鉴权豁免仅限明确授权的人工调试，不用于发布验证。

详见 [发布工作流](release-workflow.md)。
