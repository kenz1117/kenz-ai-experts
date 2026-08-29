# kenz-ai-experts

KenZ 的 AI 专家智能体仓库 —— 一个 monorepo，收纳所有可复用的专家智能体。

设计原则：**一套平台无关核心（`skill/`）+ 多端薄包装（`platforms/`）**。核心方法论、脚本、报告模板只写一次，WorkBuddy / Claude Code / OpenClaw 等各端按需套一层薄包装即可，避免多份复制漂移。

## 专家目录

| 专家 | 花名 | 分类 | 简介 | 路径 |
| --- | --- | --- | --- | --- |
| `geo-brand-audit` | 品牌GEO顾问 | 05-营销增长 | 可核查证据审计品牌在 AI 搜索的可见度，六维评分 + 竞品共现 + HTML/MD 交付 | [experts/geo-brand-audit](experts/geo-brand-audit) |

## 仓库结构（以 geo-brand-audit 为例）

```
kenz-ai-experts/
├── README.md                       # 本文件：专家索引与入住规范
├── experts/
│   └── geo-brand-audit/
│       ├── skill/                  # ★ 平台无关核心（被所有端共享，只此一份）
│       │   ├── SKILL.md            #   方法论/工作流/评分权重/证据规则
│       │   ├── references/         #   评分规则、检索剧本、平台档案、基准
│       │   ├── scripts/            #   纯 Node 内置（fs/path），零 npm 依赖
│       │   ├── assets/             #   logo（base64 内嵌）、report-template.html
│       │   └── evals/
│       └── platforms/              # 各端薄包装（按需新增）
│           └── workbuddy/          #   WorkBuddy 包装
│               ├── .codebuddy-plugin/plugin.json
│               ├── agents/geo-brand-audit.md
│               ├── avatars/expert.jpg
│               ├── assemble.sh     #   把 skill/ 组装成自包含包
│               └── README.md
└── .gitignore
```

## 跨平台适配模型

- **核心 `skill/`**：纯内容 + 纯 Node 脚本，方法论写在 `SKILL.md`，跨端不变。
- **平台包装 `platforms/<x>/`**：只放该平台特有的外壳（plugin.json / agent MD / 头像 / 组装脚本）。
- **跨端只需改 3 处**（都是工具名/路径，非逻辑）：`AskUserQuestion`、`WebSearch`/`WebFetch` 的工具名，以及脚本调用里的 `$SKILL_DIR` 路径。

| 平台 | 放什么 | 工具适配 |
| --- | --- | --- |
| WorkBuddy | `platforms/workbuddy/` + `skill/` | 原生 `AskUserQuestion`/`WebSearch`/`WebFetch` |
| Claude Code / Codex | `skill/` 整体放 `.claude/skills/` | 几乎零改（它们本就有同名工具） |
| OpenClaw / QClaw / Hermes | `skill/` 整体放其 skill 目录 | 改工具名为各端实现（SKILL.md 已带 `metadata.clawdbot`） |
| Cursor / 自研 | `skill/` 作系统提示 + `node skill/scripts/*.js` | 把提问/搜索换成你的实现 |

接入新平台 = 在 `platforms/` 下加一个薄包装目录，不动 `skill/`。

## 入住一个新专家

1. 在 `experts/<name>/` 下新建 `skill/`（平台无关核心）和 `platforms/<x>/`（首个目标端包装）
2. 在 `skill/SKILL.md` 写方法论；在 `platforms/<x>/` 放该端外壳（参考 `geo-brand-audit`）
3. 在本 README「专家目录」表格加一行
4. 提交并同步（见下方「同步到 GitHub」）

## 安装到 WorkBuddy

```bash
bash experts/geo-brand-audit/platforms/workbuddy/assemble.sh
cp -R experts/geo-brand-audit/platforms/workbuddy/dist/geo-brand-audit \
  ~/.workbuddy/plugins/marketplaces/my-experts/plugins/
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/register_expert.py \
  ~/.workbuddy/plugins/marketplaces/my-experts/plugins/geo-brand-audit
```

## 同步到 GitHub

本仓库的同步走 GitHub Contents API（沙箱代理封了 git 推送主机，但放行 `api.github.com`）。
统一用脚本 `/tmp/push_contents.py`（改写 `OWNER/REPO` 变量）把改动逐文件 PUT 上去；删除文件用 `gh api -X DELETE`。

> 注：本地 `git push` 在此沙箱环境不通（代理白名单限制），GitHub 才是 source of truth；在普通网络环境直接 `git clone` + 常规 git 工作流即可。

## 规范要点

- 头像：`avatars/expert.jpg`，512×512，≤500KB（PNG/JPG）
- `plugin.json` 内 `displayDescription.zh` 需 40–50 字；`defaultInitPrompt.zh` 应与 `quickPrompts[0].zh` 一致
- 核心 `skill/` 内不得保留 `[TODO]` 占位；未知信息向用户确认，不编造
- 核心是单一事实来源：任何端的新增能力应优先沉淀进 `skill/`，而非写进某个平台的包装
