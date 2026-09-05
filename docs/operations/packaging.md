# 打包与候选验证

`pnpm dist` 构建 Windows NSIS 与 portable，不会发布。产物位于 release，文件名由 package.json 的 version 与 build.artifactName 决定，禁止硬编码旧版本号。

## 隔离验证

- `node scripts/e2e/desktop-run.mjs --backup --packaged`：无模型备份、恢复、目录保护。
- `node scripts/e2e/desktop-run.mjs --smoke --packaged`：IPC、鉴权、SSE 生成、TXT 导出。
- `node scripts/e2e/desktop-run.mjs --packaged`：完整 T1-T5，第一次失败即停止并保存 partial。

启动器使用真实 Electron/utilityProcess 加载 app.asar，临时测试应用元数据与候选版本一致；userData/sessionData 独立、端口随机、Key 经 safeStorage 加密，不开启明文直通。这是打包内容的隔离等价验证，不是 NSIS 安装向导、真实用户升级或自更新链的全覆盖证明。

## 平台和交付

Windows 为 NSIS/portable；macOS 为 DMG；Linux 为 AppImage。CI 等整个矩阵成功才统一创建 Release。正式交付还需核对 tag、CI、Release 资产和更新元数据，不能只看本地时间戳。

代码签名通过 WIN_CSC_LINK/WIN_CSC_KEY_PASSWORD 配置；是否已签名必须检查实际产物，不能从构建日志出现 signing 字样推断证书有效。

安装版数据使用 app.getPath('userData')；便携版使用 exe 同级 data。测试启动器单独覆盖路径；仅给外部 shell 设置 AI_NOVEL_USER_DATA 并不能保证 Electron 主进程不会重新选择真实目录。
