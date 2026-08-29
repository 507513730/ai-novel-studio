# 全面审查与修复追踪（P20）

> 来源：2026-08-11 全面审查（多智能体 6 项 + 全系统 12 子系统 40 项）
> 状态：`[x]` 已修复 / `[ ]` 待修复；修复批次见 PLAN.md P20

## 一、多智能体协同（6 项）

| # | 严重度 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| M1 | P0 | scheduler 无看门狗：挂死 LLM 调用 → running 永不复位 → 全局瘫痪 | scheduler.ts:75-115 | [x] 批2-1 |
| M2 | P0 | cancel 对运行中导演无效：pipeline 不查 job 状态 | automation.ts:100 / director.ts:669 | [x] 批2-2 |
| M3 | P1 | 阶段失败重跑造重复数据：数量判完成 + 无去重 | director.ts:423/479/607 | [x] 批3-3 |
| M4 | P1 | team/review 无超时 + 结果不落库 + 主编约束丢弃 | agents.ts:104-260 | [x] 批4-1 |
| M5 | P2 | hub 工具无调用级超时；单 session 并发穿插 | hub.ts:325/296 | [x] 批4-2 |
| M6 | P2 | replanCount 全局预算，早期抖动耗尽 | director.ts:734 | [x] 批2-6 |
| M7 | P3 | tripleReview 失败静默降级无日志 | generate.ts:81 | [x] 批4-3 |
| M8 | P3 | jobQueue 查重+插入非原子 | jobQueue.ts:20 | [x] 批3-6 |
| M9 | P3 | pendingMutation 单槽位互相覆盖 | hub.ts:385 | [x] 批4-2 |

## 二、安全与备份（批 1）

| # | 严重度 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| S1 | 高 | CORS 白名单含 'null'：沙箱 iframe 可绕过 | security.ts:12-16 | [x] 批1-1 |
| S2 | 高 | 恢复备份在运行中服务上覆盖文件 + 不重启 | electron/main.ts:99-128 | [x] 批1-2 |
| S3 | 高 | 便携版备份/清数据目录错位（userData vs data） | electron/main.ts:51/136 | [x] 批1-2 |
| S4 | 中 | 恢复无 schema 版本校验；ALTER 非幂等 | migrate.ts:249/310 | [x] 批1-4 |
| S5 | 中 | zod 覆盖不完整（SSE/params 裸转 Number） | chapters.ts:78 等 | [x] 批1-3 |
| S6 | 低 | 错误消息原样回显泄露内部信息 | index.ts:53-74 | [x] 批1-3 |
| S7 | 低 | keyCrypto 无 keyring 时明文落库（Linux 取舍） | keyCrypto.ts:43-58 | [x] 取舍保留 |

## 三、烧钱与失控防护（批 2）

| # | 严重度 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| C1 | 高 | 运行中任务取消是假的 + 完成覆盖取消 | scheduler.ts:84/105 | [x] 批2-2 |
| C2 | 高 | 成本模型名失配 → 默认价虚高 3.5~35 倍 | usage.ts:19-24 | [x] 批2-4 |
| C3 | 中 | 客户端 60s 超时截断长 AI 任务（幻象失败） | api.ts:38 | [x] 批2-3 |
| C4 | 中 | abort 调用不入账（最贵的调用缺失） | generate.ts:170 | [x] 批2-5 |
| C5 | 中 | 80/20 裁剪误删高价值段（角色账本连带引导） | context.ts:476-492 | [x] 批3-2 |
| C6 | 中 | 可变区超限从头截断，先砍本次引导/约束 | context.ts:465-474 | [x] 批3-2 |
| C7 | 中 | quality_debt 只写不读无限膨胀 | chapters.ts:63 | [x] 批3-5 |
| C8 | 中 | setPriceCache 死代码 + streamStat 成本估算错位 | costEstimate.ts:12 | [x] 批2-4 |
| C9 | 中 | production 失败章节计 done，progress 失真 | production.ts:272 | [x] 批2-2 |
| C10 | 中 | 崩溃重跑重复烧 token（无成本侧幂等） | scheduler.ts:144 | [x] 批2-1 |

## 四、一致性与数据正确性（批 3）

| # | 严重度 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| D1 | 高 | SSE 单事件损坏毁全流 + 丢弃已生成内容 | api.ts:313-332 | [x] 批3-1 |
| D2 | 高 | KB 缓存失效键=文档数：编辑不重建索引 | context.ts:191-208 | [x] 批3-4 |
| D3 | 中 | KB 文档 >4000 字后半不可检索；kb_chunk 空表 | retrieval.ts:45 | [x] 批3-4 |
| D4 | 中 | 取消竞态：done/aborted 事件收不到 → 本地与库分叉 | api.ts:335-339 | [x] 批3-1 |
| D5 | 中 | 章节加载中编辑器仍可编辑被覆盖 | ChapterExecutionPage:483 | [x] 批3-1 |
| D6 | 中 | 生成丢弃未保存编辑且不先落盘 | ChapterExecutionPage:263 | [x] 批5-2 |
| D7 | 低 | status='direct' 资料双份进提示词 | context.ts:196 | [x] 批3-4 |

## 五、体验与前端（批 5）

| # | 严重度 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| U1 | 高 | 版本历史僵尸功能：无恢复/查看 | ChapterExecutionPage:1126 | [x] 批5-1 |
| U2 | 中高 | 选区 AI 操作响应期竞态 + 无快照 | SelectionToolbar:40-52 | [x] 批5-2 |
| U3 | 中 | 无自动保存（仅 Ctrl+S/失焦） | ChapterExecutionPage:186 | [x] 批5-2 |
| U4 | 高 | 单 chunk 4.4MB 无分包无懒加载 | App.tsx:5-24 | [x] 批5-4 |
| U5 | 高 | CodeMirror 每按键全页重渲染 | ChapterExecutionPage:827 | [x] 批5-4 |
| U6 | 中 | 流式每 delta 双重 setState + O(n²) 拼接 | ChapterExecutionPage:291 | [x] 批5-4 |
| U7 | 中 | 列表页高频全量轮询 + jobs queryKey 三页争夺 | NovelListPage:27 | [x] 批5-7 |
| U8 | 低 | 反 AI 词纯子串匹配误报；无生成后校验闭环 | styleEngine.ts:94 | [x] 批5-3 |
| U9 | 低 | streamStat 字数数字串当文本 token 化 | ChapterExecutionPage:294 | [x] 批2-4 |

## 六、导出（批 5-7）

| # | 严重度 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| E1 | 中 | EPUB 内容未 XML 转义，可注入畸形标签 | export.ts:79 | [x] 批5-7 |
| E2 | 中 | 大书全量内存（2-3 倍体积） | export.ts:19-41 | [x] 批5-7 |
| E3 | 低 | TXT 无 BOM（旧记事本 GBK 乱码） | export.ts:38 | [x] 批5-7 |
| E4 | 低 | 文件名消毒集不完整（CON/结尾点） | export.ts:28 | [x] 批5-7 |

## 七、工程与 DB（批 5）

| # | 严重度 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| T1 | 高 | CI 从不跑测试；PR 零检查 | build.yml:33 | [x] 批5-6 |
| T2 | 中 | 10+ 表缺 WHERE 列索引；job 1.5s 全表扫 | migrate.ts:232-243 | [x] 批5-5 |
| T3 | 中 | usage_log 无限增长 + 成本页全表聚合 | settings.ts:313 | [x] 批5-5 |
| T4 | 中 | DatabaseSync 同步阻塞事件循环（取舍） | index.ts:82 | [x] 取舍保留 |
| T5 | 低 | prompt 模板不在 frozenHash 内；include 不改 hash | context.ts:369/419 | [x] 批5-7 |
| T6 | 低 | apiFetch/j 重复实现；QueryClient 零 staleTime | api.ts:22-44 | [x] 批5-7 |
| T7 | 低 | fallback 换模型进程级全局 + 模型名不校验 | llm.ts:169 | [x] 批2-2 |

---

## P21 审查（2026-08-11 · v0.3.0）

> ⚠️ 本段原文在早期编码事故中损坏（0x3F，不可恢复）；要点已按 git 提交信息与已发布代码重建。

- 创造工坊（方案/技能/智能体资产化 + Feelfish 导入）：agent 表补 description/body_md/skills 字段 + skill 表 + 方案版本化；AI 生成方案骨架；solutionRunner 步骤执行（90s 超时/降级继续）；Feelfish agent md（YAML frontmatter）与 solution.json 导入；发布流程补齐（versioning + CI tag 校验）

遗留待办（部分已在后续版本消化）：
- [x] whole_book 整本模式执行器（v0.24.2 落地：方案 → 一键整本生产）
- [x] AGENTS.md 纪律同步（P25/P26 起随批次回写）
- [ ] 步骤 maxTokens 智能分配
- [ ] 本地方案市场（P21-4 预留，仅 GitHub 市场）
- [ ] 方案导入 UI/API 全链核对（/solutions/:id/versions 已存在）

---

## 重构基线审查（2026-08-29 · R0）

> 来源：全仓库重构 R0 基线建立（计划：docs/superpowers/plans/2026-08-29-full-repository-refactor-remaining-work.md；事实依据：docs/superpowers/audits/2026-08-29-refactor-baseline.md）
> 编号规则：R0-F*；严重度沿用 P0-P3；「所属批次」指计划文档 R0-R9。

| # | 严重度 | 问题 | 位置 | 所属批次 | 状态 |
|---|---|---|---|---|---|
| R0-F1 | P1 | 反 AI 重写成功后二次 UPDATE 只改 chapter 不更新 chapter_version → 正文与最新版本快照分叉（违反「版本=正文快照」契约） | generate.ts:197-199 vs :127-131 | R1 | [x] R1 |
| R0-F2 | P2 | 章节内容/状态 UPDATE 缺 novel_id 守卫（其余同类路径均带；章 id 全局唯一，实际风险低，属一致性修复） | generate.ts:137/198/240 | R1 | [x] R1 |
| R0-F3 | P3 | 注释声称「最终内容（含反 AI 重写后）确定性校验」，代码实际在重写前校验（注释与顺序不符） | generate.ts:151-153 | R1 | [x] R1 |
| R0-F4 | P2 | 参考分支 postProcess 约束登记取「该书最后一章」id 而非被生成章节 id——重放时必须改为传入 chapterId，不得回退 main 行为 | 旧分支 chapterGeneration/postProcess.ts:21 | R1 | [x] R1 |
| R0-F5 | P2 | solutionRunner 复制 generate 的 claim/复位 SQL，同语义两处维护（漂移风险） | solutionRunner.ts:303-311/539 vs generate.ts:44-51 | R4.3 | [ ] |
| R0-F6 | P2 | production 无守卫直接置 reviewed/failed（其余路径均带 status='generating' 守卫） | production.ts:238/330 | R4.3 | [ ] |
