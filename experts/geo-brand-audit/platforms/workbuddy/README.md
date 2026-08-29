# 品牌GEO顾问 (Brand GEO Advisor) — WorkBuddy 包装

本目录是 `geo-brand-audit` 专家在 **WorkBuddy** 上的「薄包装」。真正的方法论、脚本、报告模板在仓库根 `skill/`（平台无关核心），本目录只放 WorkBuddy 特有的外壳：

- `.codebuddy-plugin/plugin.json` — 专家清单（skills 指向 `./skill`）
- `agents/geo-brand-audit.md` — 专家角色与交互工作流（含「缺输入必须用 AskUserQuestion 确认」铁律）
- `avatars/expert.jpg` — 专家卡片头像
- `assemble.sh` — 把核心组装成自包含包后安装

## 核心能力

- **报告风格 v1.2**：瑞士国际主义网格（Swiss Grid）—— 纯白底 + Helvetica 无衬线 + 品牌橙为唯一强调色 + 12 栏网格底纹 + 发丝线分隔 + 无圆角无阴影
- **证据驱动**：每分标注 L1 已验证 / L2 检索命中 / L3 推演估计，并给出证据覆盖率
- **六维评分**：RETRIEVABILITY 25% / AUTHORITY 20% / CONTENT_ASSETS 15% / STRUCTURE_MARKUP 15% / SENTIMENT 15% / COMPETITIVE 10%
- **分档采集**：quick / standard / deep
- **竞品共现**：检索竞品在 AI 答案中的共现与涌现
- **多源交叉分析**（可选阶段5）：把真实社媒舆情与热搜信号，与检索资产对齐，输出叙事鸿沟 / 三源可见度矩阵 / 危机三通道 / 竞品多维并集
- **交互式**：缺品牌名 / 品类 / 档位 / 竞品 / 上次对比 JSON 时主动确认，不自作主张
- **交付物**：HTML 汇报版 + Markdown 执行版

> **我们不做「AI 提及率 62%」这类数字。** 那是让 AI 模拟 AI 的结果：不可核查、不可复现，
> 优化后也无法验证。本专家的分数建立在可追溯的公开证据上；AI 模拟提问仅作为附录，
> 输出区间 + 置信度，不参与评分。
>
> 同理，多源交叉分析只吃**真实采集**的社媒与热搜数据。缺数据时对应指标为 `null`
> 并在报告标注「未采集」—— 绝不用 AI 估计值补位。「未采集」与「采集过、确认为 0」
> 在报告里是两种不同呈现，因为它们是两回事。

## 离线回归

改动脚本或报告模板后，用离线夹具一键验证输出没被破坏，无需任何活 API：

```bash
cd skill && node scripts/smoke-test.js
```

覆盖 5 组 39 条断言：schema 校验、交叉分析「有/无阶段5」两条路径、HTML 与 Markdown 渲染、
降级渲染。详见 `skill/output/samples/README.md`。

## 安装（从本仓库源码）

```bash
# 1) 组装出自包含包（核心 skill/ 被拷入包内 ./skill）
bash platforms/workbuddy/assemble.sh
# 产出：platforms/workbuddy/dist/geo-brand-audit/

# 2) 复制到专家目录并注册
cp -R platforms/workbuddy/dist/geo-brand-audit \
  ~/.workbuddy/plugins/marketplaces/my-experts/plugins/
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/register_expert.py \
  ~/.workbuddy/plugins/marketplaces/my-experts/plugins/geo-brand-audit
```

## 跨平台适配说明

此专家已被设计成「一套核心、多端包装」：

| 平台 | 怎么放 | 需改的工具名 |
| --- | --- | --- |
| **WorkBuddy** | 本目录包装 + `skill/` 核心 | 原生支持 `AskUserQuestion` / `WebSearch` / `WebFetch` |
| **Claude Code / Codex** | 把 `skill/` 整体放 `.claude/skills/` | `AskUserQuestion`/`WebSearch` 它们本就有，几乎零改 |
| **OpenClaw / QClaw / Hermes** | 把 `skill/` 整体放其 skill 目录（SKILL.md 已带 `metadata.clawdbot`） | 按各端工具名改 `AskUserQuestion` / `WebSearch` / `WebFetch` |
| **Cursor / 自研** | 把 `skill/` 整体作为系统提示 + 跑 `node skill/scripts/*.js` | 把提问/搜索工具名换成你的实现 |

核心逻辑、评分、证据分级、报告模板**一行都不用动**；跨平台只改工具名与 `$SKILL_DIR` 路径。

---

## 覆盖天花板（必读）

这一节说明本专家**看不到的部分**。知道边界，才知道报告的哪些结论能直接对外引用、
哪些必须再核实一层。

| 边界 | 说明 | 影响 |
| --- | --- | --- |
| **只覆盖中国平台** | 检索、社媒、热搜均为中国平台 | 无海外视角，出海品牌不适用 |
| **不含传统 SEO 数据** | 不采集百度/Bing 网页索引、关键词排名、外链、站点收录 | 结论不等于 SEO 诊断 |
| **AI 提及推演是附录** | `SIMULATION` 只输出区间 + 置信度，**不参与总分** | 不可对外引用为实测数据 |
| **检索是 AI 可见度的代理** | AI 回答大量依赖检索增强（RAG），但代理不等于等价 | 两者有相关性，不是同一指标 |
| **热搜是信号级** | 只给热度与上榜情况，不做细颗粒情绪判定 | 深度负面判定请回到社媒样本 |
| **社媒样本量偏小** | 依赖 Agent 检索，通常 10-30 条 | 负面率噪声较大，样本 <10 条时报告会提示 |
| **情绪判定来自 Agent 判读** | 基于标题/正文表述，非平台官方数据 | 判读证据保留在样本表，可逐条复核 |
| **声量/热度指数是相对值** | 对数归一化到人为设定的天花板 | 用于横向对比，不代表绝对市场份额 |
| **基准线可能缺失** | 分维度基准只用实测/累积/配置三种可核查来源 | 都取不到时**不画基准线**，而非估算一个 |

> 交叉分析的三源分界阈值与归一化天花板都写在 `skill/scripts/lib/cross_analysis.js`
> 顶部（`NORM` / `TH` / `QUAD_THRESHOLD_BY_SOURCE`），可按品类调整 ——
> 但调整后必须连同报告一起说明口径。

---

## KNOWN ISSUES

已知问题登记在此，避免重复踩坑。

| # | 现象 | 现状 / 规避 |
|:--:|---|---|
| 1 | **中文路径导致 headless 截图失败**：直接对含中文的 `file://` URL 截图，服务返回 `400 Param Incorrect` | 先把 HTML 复制到 ASCII 路径（如 `/tmp/preview.html`）再截图 |
| 2 | **`chrome-headless-shell --screenshot` 只截视口、不截整页** | 用 `puppeteer-core` + `executablePath` 指向本机 chrome-headless-shell，`setViewport` 到 `scrollHeight` 后 `fullPage: true` |
| 3 | **Windows(Git Bash) 路径**：传给 `python.exe` 的路径必须是 `C:/Users/...`，不可用 `/c/Users/...` | 否则 Windows Python 会解析成 `c:\c\Users\...` |
| 4 | **沙箱代理封死 git 推送主机**：`github.com` / `ssh.github.com` 的 CONNECT 隧道返回 200 后黑洞关闭，只放行 `api.github.com` | 改用 GitHub Contents API 逐文件 PUT；普通网络无此限制 |
| 5 | **静态 HTML 里查不到渲染后的内容**：报告是「注入数据 + 浏览器端渲染」，`#app` 初始为空 | DOM 断言要在数据层做；看页面请用浏览器打开生成的 HTML |
| 6 | **macOS `sips` 不支持 `--compress`** | 用 `sips -z 512 512 in --out out.jpg -s format jpeg`（不加 compress 参数） |
| 7 | **`cross` 是合并时派生的**：手工改了 `stages` 后必须重算 `cross` | 否则会留下过期的交叉分析结果；`merge-stages.js` 的顺序是对的 |

---

## 打包分享

```bash
# 先 assemble，再打包自包含包
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/package_expert.py \
  platforms/workbuddy/dist/geo-brand-audit ./dist/
```
