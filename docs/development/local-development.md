# 本地开发

## 环境

- Windows / pwsh 7；Node 24；pnpm（corepack 激活）；无全局 electron。
- 首次：`pnpm install`（.npmrc 已配 pnpm store 与 electron 镜像）。

## 常用命令

```
pnpm dev          # electron-vite 三端；dev 固定 AI_NOVEL_PORT=3000
                  # 浏览器直连 5173 调试需：AI_NOVEL_TOKEN_OPTIONAL=1 pnpm dev（v0.25.0 起 dev 也强制 X-App-Token，浏览器无 preload 桥拿不到 token）
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest run
pnpm db:smoke     # 数据库冒烟（内存库 7 项检查）
pnpm build        # 三端构建
pnpm dist         # NSIS 安装版 + portable（release/）
```

## 独立调试 server

```
AI_NOVEL_USER_DATA=<目录> AI_NOVEL_PORT=3000 AI_NOVEL_ALLOW_PLAINTEXT=1 node out/main/server.js
```

- `AI_NOVEL_ALLOW_PLAINTEXT=1` 仅限调试：允许以明文存取 API Key（正式运行经 safeStorage 加密）。
- 不设 `SERVER_TOKEN` 时关闭 token 强制；设了则全请求需 `X-App-Token`。
- dev（electron-vite）始终注入随机 `SERVER_TOKEN`；浏览器直连调试时以 `AI_NOVEL_TOKEN_OPTIONAL=1` 关闭强制（server/src/services/security.ts 预留开关，仅限本机调试）。

## 验收脚本

```
node scripts/v072-pack-verify.mjs   # 打包态等价验收（鉴权/SSE/导出）
node scripts/e2e/round.mjs 1        # 全功能 E2E 一轮（T1-T5，走真实网关）
```
