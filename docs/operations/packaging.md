# 打包

## 命令

```
pnpm dist    # electron-vite build && electron-builder --win --publish never
```

产物（release/）：`AI-Novel-Studio-Setup-<ver>.exe`（NSIS 安装版）+ `AI-Novel-Studio-<ver>-portable-x64.exe`（便携版）+ `latest.yml` + blockmap。

## 打包态验收

```
node scripts/v072-pack-verify.mjs
```

构建产物起独立 server：无 token 403 / 带 token 200 / 建书建章 / SSE 真实生成 / TXT 导出。
验收环境需 `AI_NOVEL_ALLOW_PLAINTEXT=1`（脚本已内置）——非 utilityProcess 直跑存 key 的调试开关。

## 平台

- Windows：NSIS + portable（本机验证）；代码签名经 WIN_CSC_LINK/WIN_CSC_KEY_PASSWORD（无证书时仅告警，用户侧可能被 SmartScreen 拦截）。
- macOS / Linux：electron-builder 配置在位，产物按各自 runner 验证。

## 数据目录

- 安装版：app.getPath('userData')；便携版：exe 同级 `data/`（PORTABLE_EXECUTABLE_DIR）。
- server 进程经 AI_NOVEL_USER_DATA 注入同一目录；备份/恢复/清除数据统一于此。
