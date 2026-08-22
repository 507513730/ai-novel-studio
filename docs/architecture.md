# 架构说明（AI-Novel-Studio）

> P17-5 新增：进程模型 / 数据流 / 目录导览。实施纪律见 AGENTS.md。

## 进程模型（Electron 三进程）

```
┌─────────────────────────────────────────────────┐
│ Electron 主进程 (electron/main.ts)                │
│  · 窗口（无边框标题栏 + titleBarOverlay）           │
│  · Menu（中文菜单）· safeStorage 加密 API Key       │
│  · utilityProcess.fork(server.js)                 │
│  · IPC：get-server-url / theme-set / open-data-dir / wipe-data │
└──────────────┬──────────────────────────────────┘
               │ utilityProcess（Node 隔离进程）
┌──────────────▼──────────────────────────────────┐
│ 服务进程 (server.js → src/index.ts)               │
│  · Express 5 + node:sqlite（WAL）                │
│  · 路由层（薄）→ services 层（业务）→ db 层        │
│  · Scheduler（1.5s 轮询 job 表，单例串行执行）     │
│  · 重启幂等：running→queued 重置                  │
└──────────────┬──────────────────────────────────┘
               │ HTTP 127.0.0.1:随机端口（dev=3000）
┌──────────────▼──────────────────────────────────┐
│ 渲染进程 (React 19 + CodeMirror)                  │
│  · HashRouter + AppLayout（侧栏 21 项：创作 8 + 资产 12 + 系统 1）│
│  · react-query 数据层 · 多主题 CSS 变量           │
└─────────────────────────────────────────────────┘
```

## 核心数据流

### 章节生成上下文组装（前缀冻结 + 可变区）

```
冻结前缀区（hash 版本化 → 缓存命中）:
  系统提示 → 书级合约(framing) → 世界观 → 角色账本(全量摘要) → 外部资料(direct)
可变区（按章组装）:
  本章角色特写(P13 G2 精准筛选) → 连续性状态(回灌) → 流派约束 → 三方会审
  → 写法规则 → 任务单 → 前文摘要
预算守卫：先裁可变区摘要，再裁冻结区角色/世界观
注：RAG 检索注入（P17-5B）为条件启用预留（>100 万字书），当前外部资料走直塞——
详见 docs/archive/PLAN-history.md §9.2 决策 + decision-log D51。
```

### 任务调度（执行面隔离）

```
Web API → INSERT job（queued）→ Scheduler 原子抢占(running)
  → runDirectorPipeline / runProductionPipeline
  → 进度回写 result_json / 状态 done|failed
失败恢复：retry(可换模型 modelOverride) / cancel / 从断点继续(resume)
```

### 创作方案运行时（P21，创造工坊）

```
用户描述 → POST /solutions/generate（AI 编排骨架）
  → solution 表（steps_json: [{agentId, role, stage, include, maxTokens, if}]）
  → 章节页「跑方案」/ hub run_solution → solutionRunner
  → 按步骤顺序：buildStepPrompt（agent 资产 + 技能 + 冻结上下文 + 前序输出）
    → callLlmJson（90s 超时 / 失败降级继续 / humanOverride 单步调试）
  → 输出聚合展示（不直接写库；写操作仍走 hub 审批）
stage 语义：post_generate（正文后增强）/ review（审核增强）/ whole_book（整本生产——
书绑定方案后由整本生产管道逐章走流水线；亦支持「方案 → 一键整本生产」入口，v0.24.2）
```

### 检索链路（P17-5B）

```
Retriever 接口：TfidfRetriever（默认，零依赖）/ EmbeddingRetriever（预留）
状态：RAG 基础设施条件启用（>100 万字书或外部资料 >100 万字），当前未接入上下文组装——
"外部资料少时直塞"是既定替代方案（PLAN-history §9.2 + D51）；引入 embedding 供应商时
设置页切换后端，无需改上下文组装逻辑。
```

## 目录导览

```
client/src/      React：pages/（33 页含 settings/ chapter/ 子目录）workspace/（8 面板）
                 components/ editor/ utils/ hooks/
server/src/      服务：routes/（15 个路由文件，~17 路由面）services/（generate/context/llm/planner/
                 ledger/jobQueue/scheduler/director/production/retrieval…）db/ prompts/
electron/        主进程：窗口/菜单/安全/utilityProcess
shared/          前后端共享类型（@shared/types）
scripts/         db-smoke / calibrate / e2e（round.mjs 全功能 + longbook.mjs 长书）/ release / verify-docs
docs/            决策日志（decision-log）/ 测试报告 / 校准 / 发布说明 / archive（历史编年史）
```

## 关键设计决策索引

- 前缀冻结 + 缓存优化：docs/archive/PLAN-history.md §3.3 + decision-log D6
- 执行面隔离 / 重启幂等：AGENTS 纪律 8/9/23
- 零原生依赖：AGENTS 纪律 1（node:sqlite 核心路径 18）
- 资产全局化（novel_id=0）：decision-log D47
- 提示词资产化（P17-5A）：decision-log D50
- RAG 检索后端接口（P17-5B）：decision-log D51
- 文档治理（2026-08-22）：PLAN 归档精简 + 乱码清零 + README 数字修正（见决策日志 D104）
