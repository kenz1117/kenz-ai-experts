# 仓库管理规范与入住标准

本文件是 **kenz-ai-experts 的维护者手册**：目录怎么组织、新专家怎么入住、改动怎么同步。

如果你只是想**使用**某个专家，看 [README.md](README.md) 就够了，不用读这份文件。
两份文件各自独立完整：README 面向使用者，本文件面向维护者。

---

## 一、仓库定位与三条铁律

**定位**：monorepo，收纳可复用的 AI 专家智能体（一个专家 = 一套方法论 + 脚本 + 各端外壳）。

| # | 铁律 | 说明 |
|---|---|---|
| 1 | **平铺，不套中间层** | 专家名即仓库根目录下的**一级目录**：`geo-brand-audit/`、`depoo-writer/`。禁止 `experts/<name>/`、`packages/<name>/` 这类中间层。 |
| 2 | **核心 + 多端** | 方法论 / 脚本 / 模板只写一份在 `<name>/skill/`；各平台外壳放 `<name>/platforms/<platform>/`。 |
| 3 | **核心是单一事实来源** | 新能力优先沉淀进 `skill/`，不写进某个平台的包装里，避免多端漂移。 |

> ⚠️ **铁律 1 的代价（真实事故）**
> 曾有人在同步时"顺手"按另一个规范加了 `experts/` 中间层，跑全量同步后：
> GitHub 上原本平铺的 `geo-brand-audit/*` 被判定为"本地无"→ **删除 24 个文件**，
> 内容被重建到 `experts/geo-brand-audit/*`。花了两轮同步才恢复。
> **教训：同步脚本是全量 diff 且会删除，动目录结构前必须先核对远端。见第五节。**

---

## 二、目录结构标准

```
<expert-name>/
├── skill/                     # ★ 平台无关核心（被所有端共享，只此一份）
│   ├── SKILL.md               #   frontmatter + 方法论 / 工作流 / 规则
│   ├── references/            #   细则文档（按需拆分，由 SKILL.md 引用）
│   ├── scripts/               #   可执行脚本
│   ├── assets/                #   模板、logo、计数等静态资源
│   ├── output/samples/        #   离线夹具（脱敏），供回归测试用
│   └── evals/                 #   评测集
└── platforms/
    └── <platform>/            # 薄包装，一个平台一个目录
        ├── .codebuddy-plugin/plugin.json   # 平台元数据（WorkBuddy）
        ├── agents/<expert-name>.md         # 该端 agent 定义（交互铁律在此）
        ├── avatars/expert.jpg              # 头像
        ├── assemble.sh                     # 把 ../../skill 组装成自包含包（含自检）
        ├── README.md                       # 该端安装与使用说明
        └── README.en.md                    # 英文版
```

### 各位置该放 / 不该放

| 位置 | 该放 | 不该放 |
|---|---|---|
| `skill/` | 方法论、评分/判定规则、脚本、模板、夹具 | 任何平台特有字段（plugin.json、agent MD） |
| `skill/SKILL.md` | frontmatter + 主流程 + 指向 references 的索引 | 把所有细则堆在 SKILL.md 里（拆到 references/） |
| `platforms/<platform>/` | 该端元数据、agent 定义、头像、组装脚本 | 方法论正文（那是 skill/ 的事） |
| 仓库根 | `README.md`、`CONTRIBUTING.md`、`.gitignore`、各专家目录 | 构建产物、临时文件 |

---

## 三、入住一个新专家（step by step）

1. **定名**：小写连字符 `<expert-name>`，与 `SKILL.md` 的 `name`、`plugin.json` 的 `name` 三者一致。
2. **建核心 `<name>/skill/`**：先写 `SKILL.md`（frontmatter + 方法论），再按需拆 `references/`、`scripts/`、`assets/`。
3. **建首端包装 `<name>/platforms/workbuddy/`**：抄现有专家的外壳，改 `plugin.json` / `agents/*.md` / 头像 / `assemble.sh`。
4. **写该端 README**：中英双语，说明安装、使用、目录、版本记录。
5. **本地验证**：`bash platforms/workbuddy/assemble.sh`，确认自检通过（脚本有语法/冒烟检查）。
6. **更新索引**：在根 `README.md`「专家目录」表格加一行，并补一节「能力边界」表。
7. **核对远端结构**（见第五节）后同步。
8. **安装实测**：按 README 的安装命令装一遍，确认能注册、能跑。

---

## 四、文件与内容规范

### `skill/SKILL.md` frontmatter

```yaml
---
name: <expert-name>            # 与目录名、plugin.json 的 name 一致
description: >                 # 一句话定位 + 触发场景（Use when ...）
  ...
version: "1.0.0"               # 语义化版本，字符串
author: <作者/笔名>
allowed-tools:                 # 按需声明
  - Read
  - Write
  - Bash
---
```

### `plugin.json` 字段标准

| 字段 | 要求 |
|---|---|
| `name` / `agentName` / `plugin` | 三者与目录名一致 |
| `version` | 与 `skill/SKILL.md` 的 `version` **保持一致** |
| `description` | 英文概述（能力 + 边界） |
| `displayName` / `profession` | 中英双语 |
| `displayDescription.zh` | **40–50 字** |
| `defaultInitPrompt.zh` | 必须与 `quickPrompts[0].zh` **完全一致** |
| `avatar` | `avatars/expert.jpg` |
| `categoryId` | 如 `05-MarketingGrowth`、`06-ContentCreative` |
| `agents` / `skills` | 相对包内路径：`./agents/<name>.md` / `./skill` |

### 头像

`avatars/expert.jpg`，512×512，≤500KB，JPG/PNG。

### 版本号（语义化）

| 变更类型 | 版本位 | 例子 |
|---|---|---|
| 修 bug、改文案 | patch | 1.0.0 → 1.0.1 |
| **新增能力 / 改版（用户可感知）** | minor | 1.0.0 → 1.1.0 |
| 破坏性重构、数据契约变更 | major | 1.x → 2.0.0 |

升版本时**同步改三处**：`skill/SKILL.md` 的 `version`、`platforms/*/.codebuddy-plugin/plugin.json` 的 `version`、该端 README 的版本记录。

### 内容红线

- **不编造**：硬数字必须有可核验来源；没用过的功能不许写"实测"。
- **不留 `[TODO]`**：未知信息向用户确认，不占位糊弄。
- **夹具必须脱敏**：品牌名、URL 等一律替换成示例值再入库。

---

## 五、同步到 GitHub（高风险区）

本仓库走 **GitHub Contents API** 同步（沙箱代理封了 git 推送主机，但放行 `api.github.com`）。
脚本：`/tmp/sync_repo.py`，比对本地树与远端树后做增量同步：
远端有而本地无 → `DELETE`；本地有而远端有 → 带 `sha` 的 `PUT`；本地新增 → `PUT`。**幂等，可反复跑。**

```bash
python3 /tmp/sync_repo.py
```

### ⚠️ 三条禁令（违反会造成远端文件被删）

1. **先核对，再同步。** 动目录结构或批量改名**之前**，必须先看远端真实结构：

   ```bash
   gh api repos/kenz1117/kenz-ai-experts/contents/ --jq '.[].name'
   gh api "repos/kenz1117/kenz-ai-experts/git/trees/main?recursive=1" --jq '[.tree[].path] | .[]'
   ```

2. **不在"更新/同步"时顺手重构目录。** 用户说"更新"就是更新内容，不改名、不搬层、不改规范。
   确需重构：先跟用户确认，再单独做一次结构迁移提交。

3. **构建产物不许入库。** 脚本已排除 `dist/`、`__pycache__/`、`.git/`、`.DS_Store`、`*.pyc` 等；
   但脚本**不读 `.gitignore`**，新增产物目录要同步更新脚本里的 `EXCLUDE_DIRS`。

### 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `422 "sha wasn't supplied"` | 更新已存在文件必须带 blob `sha`（脚本已处理） |
| `409 Git Repository is empty` | 空仓库不能用 Git Database API，用 Contents API 逐文件建 |
| `git push` 不通 | 沙箱代理白名单限制，用脚本走 API；普通网络直接 `git clone` + 常规 git 流程 |

---

## 六、提交信息约定

`sync_repo.py` 自动生成 `sync: <path>`，属批量同步提交。手工改动建议遵循：

| 前缀 | 用于 |
|---|---|
| `feat:` | 新增能力 |
| `fix:` | 修 bug（含渲染 / 样式层缺陷） |
| `docs:` | 文档 |
| `refactor:` | 结构调整（**须在描述里写明影响范围**） |
| `style:` | 视觉改版（版本号走 minor） |

---

## 七、检查清单

### 入住新专家前

- [ ] 目录名 = `SKILL.md` 的 `name` = `plugin.json` 的 `name`
- [ ] 专家目录平铺在仓库根（**无中间层**）
- [ ] `skill/` 内无平台特有字段；`platforms/` 内无方法论正文
- [ ] `plugin.json`：`displayDescription.zh` 40–50 字、`defaultInitPrompt.zh` = `quickPrompts[0].zh`
- [ ] `SKILL.md` 与 `plugin.json` 的 `version` 一致
- [ ] 头像 512×512、≤500KB
- [ ] `bash assemble.sh` 自检通过
- [ ] 根 README 索引表 + 能力边界表已更新
- [ ] 无 `[TODO]`、无未脱敏的真实数据

### 同步前

- [ ] 已用 `gh api` 核对远端结构（尤其涉及改名 / 搬目录时）
- [ ] 确认本次只是"更新内容"，未夹带目录重构
- [ ] `dist/` 等产物已排除（或已删）
- [ ] 同步后复核：`gh api .../contents/ --jq '.[].name'` 与本地一致
