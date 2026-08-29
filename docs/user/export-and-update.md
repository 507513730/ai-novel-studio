# 导出与应用更新

## 章节导出

- 格式：TXT / MD / EPUB / DOCX（章节页工具条）。
- 整书导出：工作台页按书导出（同名格式集）。
- TXT 带 BOM（旧记事本兼容）；EPUB/DOCX 内容均做转义与结构化封装。

## 应用更新（安装版）

1. 应用启动 5 秒后静默检查更新；设置页可手动「检查更新」。
2. 发现新版本 → 确认下载 → 「重启并安装」（`autoInstallOnAppQuit` 亦会在退出时安装）。
3. 更新过程有状态广播（检查中/可用/下载进度/已下载/错误），设置页实时展示。

## 便携版更新

便携版不支持应用内自更新（electron-updater 限制）——请手动下载最新 portable 覆盖，`data/` 目录不受影响。

## 更新安全

- 更新元数据为 GitHub Releases 的 `latest.yml` + blockmap（差量下载）。
- 安装包（NSIS）与便携版同版本同源发布。
- 数据库结构升级前自动快照（见 [backup-restore](backup-restore.md)）。
