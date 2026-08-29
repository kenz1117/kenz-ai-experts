# kenz-ai-experts

KenZ 的 WorkBuddy 专家智能体仓库 —— 一个 monorepo，收纳所有可复用的专家智能体。

每个专家放在 `experts/<expert-name>/` 子目录下，独立成包、可单独安装/打包分享。

## 专家目录

| 专家 | 花名 | 分类 | 简介 | 路径 |
| --- | --- | --- | --- | --- |
| `geo-brand-audit` | 品牌GEO顾问 | 05-营销增长 | 可核查证据审计品牌在 AI 搜索的可见度，六维评分 + 竞品共现 + HTML/MD 交付 | [experts/geo-brand-audit](experts/geo-brand-audit) |

## 仓库结构

```
kenz-ai-experts/
├── README.md                 # 本文件：专家索引与入住规范
├── experts/
│   └── geo-brand-audit/      # 单个专家包
│       ├── .codebuddy-plugin/plugin.json
│       ├── agents/<name>.md  # 专家角色与交互工作流
│       ├── skills/<name>/    # 随包携带的 skill 资产（SKILL.md / references / scripts / assets / evals）
│       └── avatars/expert.jpg
└── .gitignore
```

## 入住一个新专家

1. 在 `experts/` 下新建目录：`experts/<expert-name>/`
2. 按 `geo-brand-audit` 的结构放入 `.codebuddy-plugin/plugin.json`、`agents/`、`skills/`、`avatars/`
3. 在本 README 的「专家目录」表格加一行
4. 提交并推送：

```bash
git add experts/<expert-name> README.md
git commit -m "feat: add expert <expert-name>"
git push
```

## 安装到 WorkBuddy

见每个专家目录内的 `README.md`（`cp` 到专家目录 + `register_expert.py` 注册）。

## 规范要点

- 头像：`avatars/expert.jpg`，512×512，≤500KB（PNG/JPG）
- `plugin.json` 内 `displayDescription.zh` 需 40–50 字；`defaultInitPrompt.zh` 应与 `quickPrompts[0].zh` 一致
- 不得保留 `[TODO]` 占位；未知信息向用户确认，不编造
