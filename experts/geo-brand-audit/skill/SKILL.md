---
name: geo-brand-audit
description: "品牌 GEO 可见度审计（证据驱动）。用可核查的公开证据诊断品牌在 AI 搜索时代的可见度，六维评分 + 证据分级 L1/L2/L3 + 分档采集(quick/standard/deep) + 竞品检索共现涌现，产出 HTML 汇报版与 Markdown 执行版，支持基线对比出 delta。Triggers: 'GEO审计', 'GEO诊断', '品牌GEO', 'AI可见度', 'AI搜索可见度', '品牌可见度审计', 'AI搜索排名', 'GEO优化', '品牌曝光诊断', 'AI推荐位', 'brand visibility audit', 'GEO audit'."
description_zh: "品牌 GEO 可见度审计。证据驱动、六维评分、HTML+Markdown 双输出、支持优化前后对比"
version: 1.2.0
author: KenZ
homepage: https://github.com/kenz1117
display_name: "品牌GEO可见度审计"
display_name_en: "geo-brand-audit"
allowed-tools: Read, Write, Bash, Glob, WebSearch, WebFetch, AskUserQuestion, Agent
metadata:
  clawdbot:
    emoji: "🔍"
---

# 品牌 GEO 可见度审计

> **报告风格 v1.2**：瑞士国际主义网格（Swiss Grid）—— 纯白底 + Helvetica 无衬线 + 品牌橙为唯一强调色 + 12 栏网格底纹 + 发丝线分隔 + 无圆角无阴影。像顶级战略咨询公司的交付物。

用**可核查的公开证据**诊断品牌在 AI 搜索时代的可见度，产出能落地的优化清单。

## 核心概念

- **GEO 可见度** — 品牌在 AI 生成式回答中被提及的程度。不同于 SEO（搜索排名），GEO 关注 AI 回答中的品牌曝光
- **证据分级** — L1 已验证（抓到页面正文并确认）／L2 检索命中（搜索结果摘要含品牌）／L3 推演估计（AI 推理，无外部证据）。**本报告绝不把 L3 当作事实陈述**
- **证据覆盖率** — 每个分数都附带 L1/L2/L3 构成比例，让使用者一眼看出这个分有多实
- **检索共现** — 搜品类通用词时反复一起出现的品牌，才是最真实的竞争对手，不靠 AI 拍脑袋
- **检索代理** — AI 搜索大量依赖检索增强（RAG），真实检索可见度是 AI 可见度的合理代理，且可核查、可行动
- **多源交叉** — 检索资产、社媒真实讨论、热搜信号是三件不同的事。把它们对齐，才看得出"叙事是否自洽""口碑是否已埋雷"
- **缺数据 ≠ 零** — "未采集"（`null`）与"采集过、确认为 0"是两回事。前者是不知道，后者是事实，报告里必须长得不一样

## 与其他 GEO 工具的关键差异

**本 skill 不产出"AI 提及率 62%"这类数字。** 那是 AI 模拟 AI 的结果，不可核查、不可复现、优化后也无法验证。本 skill 的分数建立在可追溯的公开证据上，模拟提问仅作为附录，输出区间 + 置信度，不参与评分。

## 工作流程

```
Step 1  收集输入
        品牌名称(必填) + 品类(必填) + 官网(可选) + 竞品(可选)
        → 已提供的直接提取，缺失项用 AskUserQuestion 补充

Step 2  确定采集档位
        quick 快速摸底(2-3min) | standard 标准诊断(默认,5-8min) | deep 正式报告(15-25min)
        → 用户已说明则直接提取，未说明用 AskUserQuestion

Step 3-7  5 阶段流水线（见下方；阶段5 为可选）

Step 7  合并 → 渲染 HTML 汇报版 + Markdown 执行版
```

### 交互快捷规则

| 场景 | 规则 |
|------|------|
| 用户消息已含品牌名 + 品类 | 直接提取，仅补缺失项 |
| 用户已指定竞品 | 直接入榜，标记 origin="user" |
| 用户已说明档位（"快速看下"/"出正式报告"） | 直接提取，不弹选择框 |
| 用户未说明档位 | AskUserQuestion 选择 quick / standard / deep |
| 用户提到"跟上个月比"/"看优化效果" | 进入基线对比模式，需要上次报告的 JSON 路径 |
| 用户提到"社媒口碑"/"舆情"/"热搜"/"有没有危机" | 触发阶段5 多源信号采集，并输出交叉分析层 |
| 用户只要"快速看下" | 走 quick 档，**跳过阶段5** |

---

## 5 阶段流水线

```
阶段1 定范围
   ↓
阶段2 采资产  ←并行→  阶段3 测可见+扫舆情
   ↓                ↓
阶段4 评分与行动
   ↓
阶段5 多源信号（可选）→ 驱动交叉分析层
```

| 阶段 | 产出 stageCode | 依赖 | 主要采集动作 | 必填 |
|------|---------------|------|-------------|:--:|
| 阶段1 | `PROFILE` `COMPETITORS` | 无 | 品牌画像、查询词矩阵、竞品检索共现涌现 | ✅ |
| 阶段2 | `ASSET` `STRUCTURE` `AUTHORITY` | 阶段1 | 官网内容盘点、结构化检测（curl 抓原始 HTML）、权威背书核验 | ✅ |
| 阶段3 | `VISIBILITY` `COMPETITIVE` `SENTIMENT` | 阶段1 | 查询词真实检索、声量份额统计、舆情扫描 | ✅ |
| 阶段4 | `OVERVIEW` `SCORE` `ACTION` `SIMULATION` | 阶段1+2+3 | 六维评分、行动清单、AI 提及推演附录 | ✅ |
| 阶段5 | `SOCIAL` `HOTSEARCH` | 阶段1 | 真实社媒样本采集、热搜上榜与品类热度核验 | 可选 |

> 阶段 2 与阶段 3 互不依赖，必须并行执行以压缩总耗时。

### 阶段5（可选）与交叉分析层

阶段5 采集**真实**的社媒与热搜信号，驱动四个六维评分单独回答不了的问题：

| 输出 | 回答什么 |
|---|---|
| **叙事鸿沟** | 品牌对外呈现的叙事，和用户真实讨论是不是一回事 |
| **三源可见度矩阵** | 品牌在检索 / 社媒 / 热搜三个场景下的相对位置 |
| **危机三通道** | 检索舆情 / 社媒 / 热搜，有没有哪个渠道已经在冒烟 |
| **竞品多维并集** | 哪些竞品在多个场景下同时与你竞争 |

- 何时跑：`quick` 跳过 · `standard` 建议跑 · `deep` 必跑
- 缺失**不阻断**主流水线 —— 六维评分与行动清单都不依赖它
- 交叉分析由 `merge-stages.js` **确定性计算**，不是 AI 生成
- **缺数据一律为 `null`，绝不补 0 或估算**；报告显示"未采集"
- 口径与局限见 `references/cross-analysis-rules.md`

### 六维评分模型

| code | 名称 | 权重 | 测什么 |
|------|------|:--:|------|
| `RETRIEVABILITY` | 检索可见度 | 25% | 品牌词/品类词在真实搜索中的出现率与位置 |
| `AUTHORITY` | 权威与背书 | 20% | 百科、知识面板、权威媒体、行业榜单 |
| `CONTENT_ASSETS` | 内容资产 | 15% | 官网产品页/FAQ/参数覆盖度与新鲜度 |
| `STRUCTURE_MARKUP` | 结构化与标记 | 15% | JSON-LD、表格化参数、QA 区块、可摘录段落 |
| `SENTIMENT` | 舆情健康 | 15% | 负面占比、风险议题、趋势 |
| `COMPETITIVE` | 竞争位势 | 10% | 相对共现竞品的声量份额 |

评级：≥90 优秀 / ≥75 良好 / ≥60 一般 / <60 较差

---

## 执行规范

### 路径解析

所有脚本路径一律以本 SKILL.md 所在目录 `SKILL_DIR` 解析：

```
SKILL_DIR/scripts/validate.js
SKILL_DIR/scripts/merge-stages.js
SKILL_DIR/scripts/build-report.js
SKILL_DIR/scripts/build-markdown.js
```

> **禁止硬编码相对路径**。用 Bash 调用时请展开为绝对路径。

### 每阶段写完立即校验

```
Write diag-output/stage<N>.json
Bash: node "$SKILL_DIR/scripts/validate.js" diag-output/stage<N>.json
```

校验不通过则修复该阶段 JSON 后重试，**不要带着错误进入下一阶段**。

### 合并与渲染

```
Bash: node "$SKILL_DIR/scripts/merge-stages.js" diag-output --depth <档位> [--baseline <上次报告.json>] [--no-record] [--preset <基准配置.json>]
Bash: node "$SKILL_DIR/scripts/build-markdown.js" <merged.json>     # 执行版
Bash: node "$SKILL_DIR/scripts/build-report.js"   <merged.json>     # 汇报版
```

带基线时：

```
Bash: node "$SKILL_DIR/scripts/merge-stages.js" diag-output --depth standard --baseline diag-output/../上次/xxx-audit.json
```

### 断点续跑

每阶段 JSON 落盘即进度。中断后检查 `diag-output/.progress.json` 确认已完成阶段，跳过已完成的直接从断点继续。

---

## 输出规则

| 产物 | 面向 | 内容 |
|------|------|------|
| `*-report.html` | 对外汇报 | 一页纸总分 + 雷达图 + 核心结论 + 声量对比 + 预期分 + 优先行动 + 多源交叉分析。单文件零依赖，可直接分发 |
| `*-execution.md` | 内部执行 | 完整证据表（含 URL 与采集时间）+ 逐维失分诊断 + 可分工的行动清单 + 多源样本明细 + AI 提及推演附录 + 采集日志 |

**两套输出由同一份 JSON 渲染，不会版本错乱。**

### 报告质量铁律（8 条）

这 8 条是输出的底线，与证据分级同等重要 —— 一份不可追溯的报告，
分数再准也没法交付给客户。

| # | 铁律 | 说明 |
|:--:|---|---|
| 1 | **多平台覆盖** | 社媒样本至少覆盖 2 个平台。只采 1 个平台时，校验器会警告"结论可能偏颇" |
| 2 | **每条结论可追溯** | 负面判断必须指向具体帖子的互动数据，竞品判断必须指向声量份额数值，危机评分必须指向具体热度值。不能出现"用户普遍反映"这类无出处表述 |
| 3 | **样本标题必须可点击** | 所有社媒/热搜样本的标题都要链到原始页面。`SOCIAL.posts[].url` 在 schema 里是**必填**，缺失即报错 —— 无法核查的样本等同编造 |
| 4 | **问句完整可见** | 检索明细表显示完整查询词原文，不是"查询类型"标签。读者要知道实际测了什么词 |
| 5 | **不暴露内部实现** | 数据源说明只讲「来源 / 采集范围 / 输出」，不列脚本文件名、不提工具链 |
| 6 | **缺数据要显式说** | 未采集的源标注"未采集"，不静默省略、不用估算值补位。留白优于编造 |
| 7 | **文案自然** | 不把用户指令原话当文案贴进报告。报告是写给客户看的，不是对话记录 |
| 8 | **结尾给复检建议** | 明确什么时候该再跑一次、重点看哪些指标、什么变化算预警 |

> 第 3 条由 `schema.js` 强制（url 必填），第 1 条会触发警告，
> 其余靠执行时自觉 —— 它们决定了报告能不能直接交付。

---

## 分维度行业基准

雷达图上的基准线**不允许 AI 估算**，只允许三种可核查来源，按优先级取用：

| 优先级 | 来源 | 说明 |
|:--:|---|---|
| 1 | `measured` 竞品实测 | 阶段 3 对 Top2-3 竞品做同口径维度打分，**每维必须挂证据** |
| 2 | `accumulated` 本地累积 | 同品类 ≥3 个品牌的历史审计均值，存 `diag-output/.benchmarks/<品类>.jsonl` |
| 3 | `preset` 用户配置 | 在 `references/benchmarks.json` 填真实行业数据 |
| — | 都不可用 | **不画基准线**，图注注明"暂无"，绝不留空补数 |

- 至少 2 个维度有值才画线；缺失的轴画开放折线，不用均值补位
- 累积样本每次合并自动记录，`--no-record` 关闭
- 报告图注会标注来源与样本量（如「竞品实测 · 5/6 维 · 样本 3」）

> **为什么这么严**：基准线看起来像有据可依，一旦是编的，会把整份报告的可信度连带拉垮。

## 引用文件（按需加载）

| 文件 | 内容 | 加载时机 |
|------|------|---------|
| `references/prompts.md` | 5 阶段 Prompt 模板与 JSON 结构 | 各阶段执行前 Read 对应 section |
| `references/evidence-rules.md` | 证据分级细则、标注规范、采集失败处理 | 阶段 2/3/5 采集前 Read（首次加载后缓存） |
| `references/scoring-rules.md` | 六维锚定表、**每维判定带**、反模式、输出自检清单 | 阶段 4 评分前 Read |
| `references/cross-analysis-rules.md` | 交叉层口径：叙事鸿沟 / 三源矩阵 / 危机三通道的公式、阈值、局限 | 阶段 5 采集前或解读交叉分析结果时 Read |
| `references/search-playbook.md` | 查询词矩阵设计、并行策略、缓存、重试 | 阶段 1/3 检索前 Read |
| `references/platform-profiles.md` | AI 平台画像（仅推演附录用） | 阶段 4 写 SIMULATION 时 Read |
| `references/benchmarks.json` | 分维度行业基准配置（用户填真实数据） | 首次审计某品类前 Read |
| `output/samples/sample-audit.json` | 离线夹具（脱敏），用于渲染回归 | 改动脚本/模板后跑 `smoke-test.js` |
| `evals/evals.json` | 触发/反触发/编排回归用例 | 评测时 Read |

**加载策略**：阶段 1 前一次性 Read `prompts.md` + `evidence-rules.md` + `search-playbook.md`，后续阶段复用，不再重复加载。阶段 5 追加 Read `cross-analysis-rules.md`。

### 脚本一览

| 脚本 | 用途 |
|------|------|
| `scripts/validate.js` | 阶段 JSON / 合并报告校验 |
| `scripts/merge-stages.js` | 合并阶段、重算总分、计算基准与交叉分析 |
| `scripts/build-report.js` | 渲染 HTML 汇报版 |
| `scripts/build-markdown.js` | 渲染 Markdown 执行版 |
| `scripts/smoke-test.js` | **离线回归**（用夹具跑 39 条断言，无需活 API） |
| `scripts/lib/cross_analysis.js` | 交叉分析内核（也可直接对合并 JSON 跑：`node lib/cross_analysis.js <merged.json>`） |
| `scripts/lib/http_resilient.js` | 采集韧性库（并发/退避/限流识别/四态失败/防截断），供未来 API 引擎使用；自带自检 `node lib/http_resilient.js` |

---

## 错误恢复

| 错误 | 处理 |
|------|------|
| 阶段 JSON 校验失败 | 修复该阶段后重试；单阶段最多重试 1 次 |
| WebSearch 无结果 | 换查询词重试 1 次；仍无结果则该条记为未命中（**不编造**） |
| WebFetch / curl 被拦 | 降级为 L2（若搜索结果可用）或 L3，并在 `fetchNote` 写明原因 |
| 某维度完全无法采集 | 标注数据缺失，由 merge 脚本用兜底值填充，报告中显示"数据缺失"角标 |
| 社媒/热搜检索不到 | **不输出该 stage**。报告显示"未采集"，交叉层对应指标为 `null` —— 绝不用估算值补位 |
| `SOCIAL.posts` 缺 url | 校验器报错（无法核查 = 等同编造）。删掉无 url 的条目，而不是留空 url |
| 阶段5 采集失败 | 不影响主流水线。直接合并，报告标注该源未采集，六维评分照常出 |
| 只采到 1 个社媒平台 | 校验器警告"结论可能偏颇"。尽量补齐，补不上就在报告里说明 |
| merge 报 error | 修复后重试；确需跳过时用 `--force`（兜底维度会明确标注） |
| build-* 脚本失败 | 检查 merged JSON 是否完整；用 `validate.js --report` 定位字段 |
| L1 覆盖率 < 30% | 报告会显式警告。正式交付建议 `--depth deep` 重跑 |

---

## 数据标注规范（强制）

| 来源 | 标记 | 报告呈现 |
|------|------|---------|
| 抓到页面正文并确认 | `L1` | 绿色 ●，带 URL + 采集时间 |
| 搜索结果标题/摘要命中 | `L2` | 蓝色 ●，带 URL |
| AI 推理，无外部证据 | `L3` | 灰色 ○，必须附 `note` 说明推演依据 |

**禁止**：L1/L2 不填 sources；L3 不写 note；用 L3 数据冒充已验证结论。
