# 数据模型

> SQLite（node:sqlite 核心路径，WAL + 外键）。迁移清单以 `server/src/db/migrate.ts` 为准（当前 22 版），历史迁移不可删除。

## 核心表

- **novel**：书（framing_json 前缀冻结源 / direction_json / constraints_json 硬约束）。
- **volume / chapter / chapter_version / beat**：卷-章-版本-节拍；chapter 有 generation_token（生成身份）与 ai_words/human_words（字数分离）。
- **character / fact / foreshadow / timeline_event / world**：角色账本（ledger_json 状态机）、事实、伏笔、时间线、世界观（manual/factions/map/timeline）。
- **job**：任务队列（type 五类、claim_token 抢占身份、payload_json Zod 校验）。
- **director_followup**：导演检查点（位置/决策/熔断计数/展示状态——完成判定以产物为准）。
- **usage_log / quality_debt / prompt_asset / provider / model_route / kb_doc / genre_asset / style_asset**：记账、质量债、提示词资产、供应商与路由、知识库、流派、风格。

## 关键约束

- chapter.status 客户端枚举：planned/imported/written/reviewed/done/failed；`generating` 为内部态。
- 版本快照（chapter_version 的 INSERT）只允许两处：章节生成域 persistence 与版本管理路由。
- 整章替换为覆盖语义：ai_words = 当前内容 CJK 字数、human_words = 0（唯一例外：PATCH 增量编辑累加）。

## 迁移纪律

- 向前兼容（ALTER 容错）、迁移前自动快照、幂等可重复执行；新迁移必须配 db-smoke。
