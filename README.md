# kenz-ai-experts

KenZ 的 AI 专家智能体仓库 —— 一个 monorepo，收纳所有可复用的专家智能体。

设计原则：**一套平台无关核心（`skill/`）+ 多端薄包装（`platforms/`）**。核心方法论、脚本、报告模板只写一次，WorkBuddy / Claude Code / OpenClaw 等各端按需套一层薄包装即可，避免多份复制漂移。

## 专家目录

| 专家 | 花名 | 分类 | 版本 | 简介 | 路径 |
| --- | --- | --- | --- | --- | --- |
| `geo-brand-audit` | 品牌GEO顾问 | 05-营销增长 | v1.2.0 | 可核查证据审计品牌在 AI 搜索的可见度：六维评分 + 竞品共现 + 多源交叉分析（社媒/热搜）+ HTML/MD 交付 | [geo-brand-audit](geo-brand-audit) |
| `depoo-writer` | 迪谱学长 | 06-内容创作 | v1.1.0 | 交互式公众号写作：深度确认 + 五层自检（含去 AI 味）+ 克制编辑感微信排版，默认交付可粘贴的 HTML | [depoo-writer](depoo-writer) |

### geo-brand-audit 的能力边界（选这个专家前先看）

| 能做的 | 不能做的 |
| --- | --- |
| 用可核查的公开证据给品牌打六维分 | ❌ 产出「AI 提及率 62%」这类不可核查数字 |
| 每条结论挂 L1/L2/L3 证据与来源 URL | ❌ 用 AI 估算值填补缺失数据（缺就是缺，标"未采集"） |
| 把真实社媒/热搜信号与检索资产交叉对齐 | ❌ 覆盖海外平台（目前仅中国平台） |
| 输出可分工的 P0/P1/P2 行动清单 | ❌ 提供传统 SEO 数据（索引量、外链、关键词排名） |
| 与上次报告对比出 delta | ❌ 把 AI 模拟推演当实测结论（仅作附录，不进分） |

完整的覆盖天花板与已知问题，见专家包内 `README.md` / `README.en.md`
（「覆盖天花板」「KNOWN_ISSUES」两节）。

### depoo-writer 的能力边界（选这个专家前先看）

| 能做的 | 不能做的 |
| --- | --- |
| 交互式确认深度 / 素材 / 类型后再动笔 | ❌ 不问就闷头写、替你拍板选题 |
| 五层自检，含去 AI 味终检（25 种模式） | ❌ 保证过审（只给质量判断，终审在你） |
| 渲染克制编辑感的微信内联 HTML，复制即贴 | ❌ 绕过微信外链限制（正文外链会降级为纯文本） |
| 未认证账号也能交付（路径 A 手动粘贴） | ❌ 替未认证账号推草稿箱（`draft/add` 需认证） |
| 没用过就明说没用过 | ❌ 编造实测体验、数据、案例 |

### depoo-writer 的交付方式

- **路径 A（默认）**：渲染 `微信正文.html` + 浏览器预览，全选复制粘贴到公众号后台。**无需接口权限**。
- **路径 B（可选）**：调 `draft/add` 推草稿箱，**需账号已微信认证**（未认证返回 48001），且必须用户明确要求。

详见 `depoo-writer/platforms/workbuddy/README.md`。

## 仓库结构

专家包**平铺在仓库根目录**（专家名即目录名，不套 `experts/` 之类的中间层）：

```
kenz-ai-experts/
├── README.md                       # 本文件：专家索引与入住规范
├── .gitignore
├── geo-brand-audit/                # 专家 1：品牌GEO顾问
│   ├── skill/                      # ★ 平台无关核心（被所有端共享，只此一份）
│   │   ├── SKILL.md                #   方法论/工作流/评分权重/证据规则
│   │   ├── references/             #   评分规则（含每维判定带）、检索剧本、
│   │   │                           #   交叉分析口径、平台档案、基准
│   │   ├── scripts/                #   纯 Node 内置（fs/path），零 npm 依赖
│   │   │   ├── lib/cross_analysis.js   #  多源交叉分析内核
│   │   │   ├── lib/http_resilient.js   #  采集韧性库（自带自检）
│   │   │   └── smoke-test.js           #  离线回归（39 条断言）
│   │   ├── assets/                 #   logo（base64 内嵌）、report-template.html
│   │   ├── output/samples/         #   离线夹具（脱敏），供回归渲染用
│   │   └── evals/
│   └── platforms/                  # 各端薄包装（按需新增）
│       └── workbuddy/              #   WorkBuddy 包装
│           ├── .codebuddy-plugin/plugin.json
│           ├── agents/geo-brand-audit.md
│           ├── avatars/expert.jpg
│           ├── assemble.sh         #   把 skill/ 组装成自包含包（含自检）
│           ├── README.md
│           └── README.en.md
└── depoo-writer/                   # 专家 2：迪谱学长（公众号写作）
    ├── skill/
    │   ├── SKILL.md                #   方法论/文风/五层自检
    │   ├── references/             #   文风档案、自检、去AI味、发布、流程
    │   ├── scripts/                #   md_to_wechat_html.py（克制·编辑感排版）
    │   └── assets/serial.txt       #   「第 N 篇原创」计数
    └── platforms/
        └── workbuddy/
            ├── .codebuddy-plugin/plugin.json
            ├── agents/depoo-writer.md
            ├── avatars/expert.jpg
            ├── assemble.sh
            ├── README.md
            └── README.en.md
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

1. 在 `<name>/` 下新建 `skill/`（平台无关核心）和 `platforms/<x>/`（首个目标端包装）
2. 在 `skill/SKILL.md` 写方法论；在 `platforms/<x>/` 放该端外壳（参考 `geo-brand-audit`）
3. 在本 README「专家目录」表格加一行
4. 提交并同步（见下方「同步到 GitHub」）

## 安装到 WorkBuddy

```bash
bash geo-brand-audit/platforms/workbuddy/assemble.sh
cp -R geo-brand-audit/platforms/workbuddy/dist/geo-brand-audit \
  ~/.workbuddy/plugins/marketplaces/my-plugins/
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/register_expert.py \
  ~/.workbuddy/plugins/marketplaces/my-plugins/geo-brand-audit
```

depoo-writer 同理：

```bash
bash depoo-writer/platforms/workbuddy/assemble.sh
cp -R depoo-writer/platforms/workbuddy/dist/depoo-writer \
  ~/.workbuddy/plugins/marketplaces/my-plugins/
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/register_expert.py \
  ~/.workbuddy/plugins/marketplaces/my-plugins/depoo-writer
```

## 同步到 GitHub

本仓库的同步走 GitHub Contents API（沙箱代理封了 git 推送主机，但放行 `api.github.com`）。

用脚本 `/tmp/sync_repo.py`：比对本地树与 GitHub 树后做增量同步 ——
GitHub 有而本地无的走 `DELETE`，本地有而 GitHub 有的带 `sha` 走 `PUT`（更新），
本地新增的直接 `PUT`。**幂等，可反复跑**。

> 更新已存在的文件必须带 blob `sha`，否则会报 `422 "sha wasn't supplied"`。
> 空仓库上 Git Database API（blobs/trees/commits）会 409 `Git Repository is empty`，
> 所以首发用 Contents API 逐文件建、之后用 sync_repo.py 增量维护。

早期的一次性脚本是 `/tmp/push_contents.py`（只写不删），已被 `sync_repo.py` 取代。

> 注：本地 `git push` 在此沙箱环境不通（代理白名单限制），GitHub 才是 source of truth；在普通网络环境直接 `git clone` + 常规 git 工作流即可。

## 规范要点

- 头像：`avatars/expert.jpg`，512×512，≤500KB（PNG/JPG）
- `plugin.json` 内 `displayDescription.zh` 需 40–50 字；`defaultInitPrompt.zh` 应与 `quickPrompts[0].zh` 一致
- 核心 `skill/` 内不得保留 `[TODO]` 占位；未知信息向用户确认，不编造
- 核心是单一事实来源：任何端的新增能力应优先沉淀进 `skill/`，而非写进某个平台的包装
