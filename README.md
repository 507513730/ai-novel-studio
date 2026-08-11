# AI-Novel-Studio · AI 小说创作工作台

面向长篇小说创作的 **AI 导演式生产系统**（Electron 桌面应用）：从一句灵感推进到完整小说——规划、生成、审核、修复、状态回灌全链路。

## 核心能力

- **自动导演**：11 阶段整本生产链（灵感 → 方向 → 设定 → 宏观 → 世界观 → 角色 → 卷 → 节奏 → 拆章 → 细化 → 可写），全自动/半自动双模式，检查点恢复；任务看门狗与取消感知（运行 30 分钟超时自动回收）
- **创造工坊**（v0.3.0）：一句话 → AI 生成创作方案（智能体流水线）；可视化编辑/试运行/保存；章节页「跑方案」+ 中枢对话触发；支持导入 Feelfish 智能体定义与方案；技能体系 + 智能体资产化
- **章节执行链**：生成（SSE 流式 + 引导输入框）→ AI 审核 → 修复（局部补丁优先）→ 状态回灌，保持全书连续性；版本历史可查看/恢复、30 秒自动保存、反 AI 词自动重写
- **资产库统一建设**（v0.5.0）：九大资产页（知识库 / 世界样本库 / 推进模式库 / 写法引擎 / 流派管理 / 反 AI 规则 / 标题工坊 / 基础角色库 / 拆书）全部支持 **上传文件（TXT/MD/EPUB 自动分章）+ 粘贴文本 + 手动填写 → AI 提取草稿 → 人工修改 → 保存**；拆书可直接导入外部文件建书分析
- **字体与排版**（v0.4.0）：3 款打包开源字体（霞鹜文楷 / 思源宋体 / 思源黑体）+ 5 款系统字体可选；首行缩进/行距/字号/阅读宽度可调
- **任务中心**：后台任务统一管理，失败可换模型重试/从断点继续
- **多主题**：6 套界面主题（墨蓝/FeelFish 绿/紫夜/深海青/琥珀/纸张亮）
- **模型路由**：任务级模型分配 + 供应商 fallback + 成本仪表盘（缓存命中率 + 质量债追踪）
- **OpenCode Go 网关**：一键导入订阅凭证，聚合 DeepSeek/GLM/GPT/Grok/Kimi 等模型
- **工程纪律**：版本规范化（SemVer + CI 强制 tag==version 校验）、`pnpm release` 一条命令发布（文档检查 → 全量验证 → 本地构建 → 推送）、全面审查追踪（docs/audit-report.md）

## 技术栈

Electron 43 + React 19 + TypeScript + Vite 7 + Express 5 + node:sqlite（零原生依赖）+ CodeMirror 6 + lucide-react + epub2

## 开发

```powershell
pnpm install
pnpm dev            # 开发（electron-vite 三端）
pnpm typecheck      # 类型检查
pnpm lint           # ESLint
pnpm test           # vitest 单测（45 项）
pnpm db:smoke       # 数据库冒烟（6 项）
pnpm release        # 发布流程（校验文档/验证/本地构建/推送指引，--push 半自动）
pnpm dist           # 打包 NSIS 安装版 + portable
```

## 数据与卸载

- 数据存于 `%APPDATA%\ai-novel-studio`（与安装目录分离；便携版跟随可执行文件 data/）
- 卸载：Windows 设置 > 应用 > AI-Novel-Studio > 卸载（自动清除数据）
- 设置页「外观 > 数据与卸载」：打开数据目录 / 导出备份 / 从备份恢复 / 清除全部数据

## 发布（GitHub Actions）

推送版本 tag（如 `v0.5.0`）自动构建 Setup.exe 与 portable 并发布 Releases。版本规范见 [docs/versioning.md](docs/versioning.md)：tag 必须与 package.json 版本一致（CI 强制校验）。

## 文档

见 [docs/README.md](docs/README.md) 索引：架构 / 发布说明 / 决策日志 / 版本规范 / 审查追踪 / 测试报告。

## 目录结构

```
client/src/    React 渲染层（pages/ workspace/ components/ editor/ utils/）
server/src/    服务层（routes/ services/ db/ prompts/）
electron/      主进程（窗口/菜单/utilityProcess/安全）
shared/        前后端共享类型
scripts/       发布流程 / 校准 / e2e 测试脚本
docs/          计划 / 决策日志 / 发布说明 / 版本规范 / 审查追踪
```

## 测试

- `pnpm test`：45 项单测（补丁修复/导演/SSE 取消/成本估算/模型覆盖/世界渲染/方案资产/分章解析）
- `node scripts/e2e/round.mjs <n>`：全功能 e2e（T1 配置/T2 创作链/T3 资产/T4 导演），三轮 52 项验证

## License

私有仓库，暂未发布许可证。
