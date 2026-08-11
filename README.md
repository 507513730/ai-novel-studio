# AI-Novel-Studio · AI 小说创作工作台

面向长篇小说创作的 **AI 导演式生产系统**（Electron 桌面应用）：从一句灵感推进到完整小说——规划、生成、审核、修复、状态回灌全链路。

## 核心能力

- **自动导演**：11 阶段整本生产链（灵感 → 方向 → 设定 → 宏观 → 世界观 → 角色 → 卷 → 节奏 → 拆章 → 细化 → 可写），全自动/半自动双模式，检查点恢复
- **创造工坊**（v0.3.0）：一句话 → AI 生成创作方案（智能体流水线）；可视化编辑/试运行/保存；章节页「跑方案」+ 中枢对话触发；支持导入 Feelfish 智能体定义与方案；技能体系 + 智能体资产化
- **章节执行链**：生成（SSE 流式）→ AI 审核 → 修复（局部补丁优先）→ 状态回灌，保持全书连续性
- **资产体系**：写法引擎（特征提取/全局资产/导入到书）、拆书（四档 + 角色形象演变）、流派管理、标题工坊、世界样本库、推进模式库、反 AI 规则
- **任务中心**：后台任务统一管理，失败可换模型重试/从断点继续
- **多主题**：6 套界面主题（墨蓝/FeelFish 绿/紫夜/深海青/琥珀/纸张亮）
- **模型路由**：任务级模型分配 + 供应商 fallback + 成本仪表盘（缓存命中率）
- **OpenCode Go 网关**：一键导入订阅凭证，聚合 DeepSeek/GLM/GPT/Grok/Kimi 等模型

## 技术栈

Electron 43 + React 19 + TypeScript + Vite 7 + Express 5 + node:sqlite（零原生依赖）+ CodeMirror 6 + lucide-react

## 开发

```powershell
pnpm install
pnpm dev            # 开发（electron-vite 三端）
pnpm typecheck      # 类型检查
pnpm lint           # ESLint
pnpm test           # vitest 单测
pnpm db:smoke       # 数据库冒烟（7 项）
pnpm dist           # 打包 NSIS 安装版 + portable
```

## 数据与卸载

- 数据存于 `%APPDATA%\ai-novel-studio`（与安装目录分离）
- 卸载：Windows 设置 > 应用 > AI-Novel-Studio > 卸载（自动清除数据）
- 设置页「外观 > 数据与卸载」：打开数据目录 / 清除全部数据

## 发布（GitHub Actions）

推送版本 tag（如 `v0.2.0`）自动构建 Setup.exe 与 portable，产物上传至 Actions artifacts 并可发布 Releases。

## 目录结构

```
client/src/    React 渲染层（pages/ workspace/ components/ editor/ utils/）
server/src/    服务层（routes/ services/ db/ prompts/）
electron/      主进程（窗口/菜单/utilityProcess/安全）
shared/        前后端共享类型
scripts/       校准与 e2e 测试脚本
docs/          计划/决策日志/优化记录/测试报告
```

## 测试

- `pnpm test`：26 项单测（补丁修复/导演/SSE 取消/成本估算/模型覆盖/世界渲染）
- `node scripts/e2e/round.mjs <n>`：全功能 e2e（T1 配置/T2 创作链/T3 资产/T4 导演），三轮 52 项验证

## License

私有仓库，暂未发布许可证。
