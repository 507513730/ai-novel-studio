# 竞品差距分析（2026-08-23）

> 目的：从国内外同类产品中提取 AI-Novel-Studio（v0.24.2）欠缺的能力，重点为**体验**与**功能**，作为 backlog 的输入（合入 [PLAN.md §2](../PLAN.md)；决策记录 [decision-log.md](decision-log.md) D105）。
> 方法：网络调研商业产品 8 款 + GitHub 开源项目 5 个（2025-2026 最新资料），对照本仓库代码逐项核实"确实没有"再列入差距；凡我们已有的明确记为长板不重复追。

---

## 1. 调研对象与来源

### 商业产品

| 产品 | 定位/定价 | 核心特色 |
|---|---|---|
| [Sudowrite](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC) | $29-59/月 | Story Bible（braindump→链条生成角色/世界/大纲，**导入已有小说自动填充**，Series Bible 跨书共享）；Muse 自训小说模型；Chapter Generator（scenes/beats）；**Canvas 2D 白板**（卡片自由布局 + AI 建议/找 plot hole/plot twist）；Write 多候选；Brainstorm/Describe/Rewrite 微工具 |
| [NovelCrafter](https://www.novelcrafter.com/features/codex) | ~$12/月 + BYOK | Codex 故事圣经（characters/locations/plots 类型化条目 + 跨章进展追踪 + AI Writing Detection）；LLM 无关（任意 key/模型）；可与多个场景/章节同时对话；[评测](https://kindlepreneur.com/novelcrafter-review/)：功能最强但**上手最难是最大差评** |
| [NovelAI](https://www.zuliewrites.com/blog/novel-ai-review) | $10/月起 | **Lorebook 关键词触发注入**（前文命中关键词→自动注入该词条设定）；Memory/Author's Note 上下文控制；Text Adventure 分支模式；图像生成；TTS 朗读 |
| [Dabble](https://www.creativindie.com/best-ai-writing-generators-artificial-intelligence/) | $10-20/月 | 易用性最佳；plot grid 可视化规划；**写作目标与进度追踪**；AI 较弱 |
| Squibler | 免费/Pro $16-20/月 | 结构化整本书生成；浏览器端 |
| [彩云小梦](https://www.xiaomengai.com/) | 免费+会员 | **一次生成 3 条故事走向对比挑选** + 换一批；世界设定（普通词条/人物词条/**人物关系**）；与设定角色聊天/语音对话；风格模型切换（言情/玄幻/纯爱）；世界广场 UGC；自定义续写字数 |
| [蛙蛙写作](https://wawawriter.com/app/ugc-plaza) | 免费+订阅 | **47 类创作要素一键生成**（起名/门派/功法等）；总纲-章纲分层；一键运行/分步确认双模式；分卷连载管理；小说转剧本；视频生成；UGC 广场 |
| [阅文作家助手妙笔](https://www.yuewen.com/app/?type=appzj) | 免费（平台生态） | **全平台**（Android/iOS/鸿蒙/桌面）；精准纠错；全书查找；快捷词/快捷标点；拼字（码字社交）；**智能提取**（导入已有书稿→提取大纲+角色，已部署 DeepSeek）；**画师**（AI 人物/场景配图） |

### 开源项目（GitHub）

| 项目 | 核心机制 |
|---|---|
| [AI_NovelGenerator](https://github.com/YILING0013/AI_NovelGenerator) | 向量库语义检索（设定/前文召回注入生成上下文）；伏笔管理；一致性审校；自动校对；[Issue #141](https://github.com/YILING0013/AI_NovelGenerator/issues/141)：审校需手动触发、使用繁琐是主要抱怨 |
| [Long-Novel-GPT](https://github.com/MaoXiaoYuZ/Long-Novel-GPT) | 大纲→章节→正文三级自上而下扩写；RAG；百万字级；**多窗口并行生成**；**对选中部分单独重新生成**；prompt 库 + 教程社区共建 |
| [NovelWriter_public](https://github.com/tuxiangxianzhe/NovelWriter_public)（上者改进版） | **作者原文导入向量库，生成章节时自动检索相似片段作为写法示例（few-shot）**；Embedding 模型可配置 |
| [gpt-story-genius](https://github.com/Crossme0809/gpt-story-genius)（gpt-author 衍生） | GPT-4 + Stable Diffusion + Anthropic 链：提示词 + 章节数 → 整本书 + **AI 封面图**（EPUB） |
| [JasonXuDeveloper/Writer](https://github.com/JasonXuDeveloper/Writer) | Neon/Postgres + pgvector：长期记忆 + 语义搜索贯穿全流程 |

---

## 2. 长板确认（竞品没有/不如我们的，不追）

1. **执行面隔离**：job 表 + scheduler 原子抢占 + 看门狗 + 重启幂等（遗留 running 重置）——所有调研对象中无一具备；开源项目全部在请求/脚本内同步跑长链路。
2. **审核-修复-回灌闭环**：三方会审自动跑 → patch-first 局部修复 → 角色状态/势力/事实/伏笔回写账本。AI_NovelGenerator 的审校手动触发被用户抱怨（Issue #141），验证了我们"自动跑"路线正确。
3. **BYOK + 任务级路由**：9 个任务类型 per-task 模型 + thinking 三层覆盖 + fallback 链 + degraded 记录——比 NovelCrafter 的 BYOK 粒度更细。
4. **拆书五维 + 证据引用**：每维结论带 chapterId + 逐字 quote——调研范围内独创。
5. **反 AI 规则 + AI/人工字数分离 + 成本仪表盘**（汇率/缓存命中/月度预算预警）。
6. **方案/智能体/技能资产化**：可视化编排 + 试运行 + 整本生产 + Feelfish 导入 + 审批式工具调用 hub。
7. **本地优先 + 零原生依赖**打包（隐私与安装成功率）。

---

## 3. 差距清单

### A 档 · 体验快赢（低成本、高频感知，建议优先）

> 状态（1.0 后补强，D123）：A1 ✅（多候选分支生成，串行→版本对比）、A5 ✅（DOCX 已 v0.24.4 完成，v1.0 后补齐导出预览）、A6 ✅（演示书 v0.24.4 + 书架空态引导已就绪）。A2/A3/A4/A7 待补。

| # | 差距 | 竞品参照 | 现状与落点 |
|---|---|---|---|
| A1 | **多候选分支生成**：章节/续写一次生成 2-3 条走向并排对比，选定后落库，其余可存为版本 | 彩云小梦（核心体验）；Sudowrite Write | ✅ 已完成（D123）：`generateChapterCandidates` 串行生成 2 份差异化候选 → 各存版本（note=「候选 N」）→ 面板对比 → 选定复用版本恢复落稿 |
| A2 | **快捷词/文本扩展**：`;zn`→主角名等码字宏，用户可自定义词典 | 阅文"快捷词/快捷标点"（网文作者刚需） | 快捷键系统仅 6 个动作（shortcuts.ts），无文本扩展；落点 = CodeMirror 补全插件 + 设置页词典管理（已有快捷词，A2 待评估增量） |
| A3 | **写作目标与统计面板**：日更目标/字数趋势/连击天数/写作时长 | Dabble goals；阅文码字统计 | 统计面板已落地（D109）；日更目标/连击/时长待补 |
| A4 | **轻量本地校对**：错别字/重复用词/称谓一致性，随时可跑、不烧 token（或单次 extraction） | 阅文"精准纠错"；AI_NovelGenerator"自动校对" | ✅ 已有本地校对入口（ExecutionPanel「本地校对」）；报表增强待评估 |
| A5 | **DOCX 导出 + 导出预览** | 投稿/平台后台事实标准 | ✅ 已完成（v0.24.4 DOCX 导出；D123 补齐导出预览：`.prose` 渲染 + 格式切换 + 下载） |
| A6 | **演示书 + 交互式引导**：预置一本跑完管线的小书供首启浏览 | NovelCrafter"上手最难"差评是前车之鉴；Dabble 以易用著称 | ✅ 已完成（v0.24.4 demo 书 + 书架空态「载入演示书」+ nextSteps 引导卡） |
| A7 | 细节打磨：文件**拖拽导入**（AssetCreator）、主题**跟随系统**档 | 通用桌面惯例 | AssetCreator 仅按钮+粘贴；主题跟随系统待补 |

### B 档 · 结构性功能（中成本、多家竞品共同验证）

| # | 差距 | 竞品参照 | 现状与落点 |
|---|---|---|---|
| B1 | **RAG/词条触发注入接入生成上下文**：前文命中关键词→注入对应设定条目；超窗后检索召回 | NovelAI Lorebook（关键词触发）；AI_NovelGenerator / Long-Novel-GPT / Writer 全部以检索注入保一致性 | 已完成主体（D124）：kb_doc.keywords 词条触发注入（getKbTriggerInjection，正文+标题摘要命中）+ TF-IDF 相似度检索（既有）两者并存；整书直塞在 1M 窗口内成立，超窗后回退可选 |
| B2 | **写法示例动态检索**：作者已写正文入库，生成时检索相似片段作 few-shot 写法示例 | NovelWriter_public 招牌功能 | 已完成地基（D124）：getPriorChapterRetrieval 把作者已写正文入 TF-IDF 检索库，按相关性召回相似片段（【已写章节参考】）；完整 few-shot 注入在此之上扩展 |
| B3 | **存量书稿接续创作**：导入作者手上的连载稿→自动提取卷/章/角色/账本→转为可继续写的工作书 | Sudowrite"导入已有小说自动建 Story Bible"；阅文"智能提取" | 已完成（D125）：`POST /import/book/:id/convert`——LLM 识别卷边界 + 反推方向/framing + 翻转 is_external=0 + 章节 imported→written；世界观/角色/写法由工作区面板按需补 |
| B4 | **网文要素生成器集**：人名/地名/门派/功法/宝物/金手指/桥段库批量生成 | 蛙蛙"47 类要素一键生成"；阅文妙笔四件套 | 仅标题工坊（TitlesPage）；标题工坊模式推广，extraction 路由现成，成本低 |
| B5 | **伏笔看板 + 角色关系图** | AI_NovelGenerator 主打伏笔管理；彩云人物关系 | 伏笔散在全书检索/记忆面无专门视图；角色无关系数据与图视图（backlog 已列，本报告并档；伏笔账本数据已有） |
| B6 | **故事板增强**：卡片自由布局 + AI 找 plot hole/建议转折 | Sudowrite Canvas | 故事板为按卷分组卡片（状态/字数着色），无自由布局与 AI 诊断 |
| B7 | **系列书共享圣经**：多本书共享世界观/角色账本 | Sudowrite Series Bible | 全局资产库（世界样本/基础角色）是"素材"而非系列联动档案；novel 无 series 关联 |

### C 档 · 远期/差异化（记录不急）

| # | 差距 | 竞品参照 | 备注 |
|---|---|---|---|
| C1 | AI 配图：封面（现为流派色块占位）/角色立绘/场景图 | 阅文画师、NovelAI、gpt-author 封面 | 需接图片供应商（设置页已有供应商体系可扩展） |
| C2 | TTS 朗读校对/听书 | NovelAI TTS | 找语感问题的独特场景 |
| C3 | 移动端只读审阅（LAN Web） | 阅文全平台、彩云 App | dev 模式已有浏览器直连基础，可做局域网只读视图 |
| C4 | 本地方案市场/模板社区 | 彩云世界广场、蛙蛙 UGC 广场、Long-Novel-GPT prompt 库 | P21-4 已预留位；方案市场现仅 GitHub 拉取 |
| C5 | Hub 对话上下文多选（把指定章/资产挂入对话） | NovelCrafter 多场景对话 | hub 现为动态书卡系统提示 |
| C6 | 受控并行生成（如同书双章并发=2） | Long-Novel-GPT 多窗口并行 | 与 scheduler 单例串行纪律（P2/D16）和供应商并发限制冲突，需谨慎评估 |

---

## 4. 明确不做（产品定位边界）

| 项 | 理由 |
|---|---|
| 云同步/多人协作 | 本地单机是定位（本地优先 + 数据主权），非缺陷 |
| 一键发布到起点/番茄等平台 | 平台无公开 API，且涉及账号凭据安全 |
| 小说转剧本/视频生成 | 蛙蛙特色路线，与"长篇小说生产系统"主线无关 |
| 自训小说模型（Sudowrite Muse / 阅文妙笔路线） | 需语料与算力护城河；我们的答案是 BYOK 多模型 + 写法引擎/反 AI 规则 |

---

## 5. 反向教训（竞品的失败点 = 我们的路线验证）

1. **审校要自动跑**：AI_NovelGenerator Issue #141 最大的用户抱怨是审校手动触发、流程繁琐——我们的三方会审嵌入生成链自动执行是正确路线，"审校结果一键采纳"体验需继续保持。
2. **上手难度是最大差评源**：NovelCrafter 被评为"功能最强的同时上手最难"（[Medium 评测](https://ilampadmanabhan.medium.com/novelcrafter-review-powerful-for-fiction-writers-frustrating-to-set-up-april-2026-64d391c629a2)）——A6（演示书/引导）应排在继续堆功能之前。
3. **并行生成与成本/限流冲突**：Long-Novel-GPT 多窗口并行提速明显，但会放大 token 成本并触碰供应商并发限制——若做 C6 必须先做成本预估联动与限流评估。

---

## 6. 与 backlog 的合并说明

- A3（写作统计）与 B5（灵感箱之外的伏笔看板/角色关系图）并入 PLAN §2 既有"未排期"条目，来源标注本报告。
- 其余 A1-A7、B1-B7、C1-C6 以本报告为准录入 PLAN §2 backlog（PLAN 保持一行一条，详情回链本文档）。
- 优先级建议：**A 档整档 > B1/B3（一致性最后一公里 + 存量书导入）> B2/B4/B5 > B6/B7 > C 档**；实际排期待写书主线（书 #25）收官后按批次规划。
