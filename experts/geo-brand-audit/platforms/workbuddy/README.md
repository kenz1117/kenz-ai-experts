# 品牌GEO顾问 (Brand GEO Advisor) — WorkBuddy 包装

本目录是 `geo-brand-audit` 专家在 **WorkBuddy** 上的「薄包装」。真正的方法论、脚本、报告模板在仓库根 `skill/`（平台无关核心），本目录只放 WorkBuddy 特有的外壳：

- `.codebuddy-plugin/plugin.json` — 专家清单（skills 指向 `./skill`）
- `agents/geo-brand-audit.md` — 专家角色与交互工作流（含「缺输入必须用 AskUserQuestion 确认」铁律）
- `avatars/expert.jpg` — 专家卡片头像
- `assemble.sh` — 把核心组装成自包含包后安装

## 核心能力

- **证据驱动**：每分标注 L1 已验证 / L2 检索命中 / L3 推演估计，并给出证据覆盖率
- **六维评分**：RETRIEVABILITY 25% / AUTHORITY 20% / CONTENT_ASSETS 15% / STRUCTURE_MARKUP 15% / SENTIMENT 15% / COMPETITIVE 10%
- **分档采集**：quick / standard / deep
- **竞品共现**：检索竞品在 AI 答案中的共现与涌现
- **交互式**：缺品牌名 / 品类 / 档位 / 竞品 / 上次对比 JSON 时主动确认，不自作主张
- **交付物**：HTML 汇报版 + Markdown 执行版

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

## 打包分享

```bash
# 先 assemble，再打包自包含包
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/package_expert.py \
  platforms/workbuddy/dist/geo-brand-audit ./dist/
```
