# 发布流程

有两条路径。**默认走路径 A（手动粘贴）**，路径 B 只有用户明确要求时才用。

```text
路径 A（默认）：改定稿 md → 转微信 HTML → 浏览器打开预览 → 全选复制 → 粘贴到公众号后台 → 终审
路径 B（可选）：改定稿 md → 转微信 HTML → 调 draft/add 推草稿箱 → 后台终审
```

> ⚠️ **路径 B 的硬前提：公众号必须已微信认证。**
> 未认证账号调用 `draft/add` 通常推不过去（权限类错误，如 48001「api 功能未授权」）。
> **账号未认证时一律走路径 A。**
> 是否尝试路径 B，**必须先用 `AskUserQuestion` 问用户确认，不得默认执行、不得在用户没要求时自作主张推**。

---

## 前置检查（只有走路径 B 才需要）

```bash
# 1. 依赖
command -v jq >/dev/null && echo "jq ✅" || echo "jq ❌ (brew install jq)"

# 2. 凭证
[[ -n "${WECHAT_APPID:-}" ]] && echo "APPID ✅" || echo "APPID ❌ 未设置"
[[ -n "${WECHAT_SECRET:-}" ]] && echo "SECRET ✅" || echo "SECRET ❌ 未设置"

# 3. mp-draft-push 就位
ls ~/.workbuddy/skills/mp-draft-push/scripts.sh >/dev/null 2>&1 \
  && echo "mp-draft-push ✅" || echo "mp-draft-push ❌"

# 4. 接口权限（未认证账号常在这一步挂）
TOKEN=$(curl -s "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WECHAT_APPID}&secret=${WECHAT_SECRET}" | jq -r .access_token)
curl -s "https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${TOKEN}" \
  -X POST -d '{"articles":[]}' | head -c 300
```

返回 `errcode: 40164 / invalid ip xxx not in whitelist` → AppID 是对的，出口 IP 没加白名单：
**公众号后台 → 设置与开发 → 基本配置 → IP白名单 → 修改**，填入报错里的 IP，等 1-2 分钟生效。

> ⚠️ 家用宽带出口 IP 会变，换网络后重新报 40164 就把新 IP 加进去。

返回 `48001 / api 功能未授权` → **账号未认证，没有草稿箱接口权限**，改用路径 A。

凭证没设置时：

```bash
cd ~/.workbuddy/skills/mp-draft-push
cp .env.example .env      # 填入 AppID / AppSecret
echo 'set -a; source ~/.workbuddy/skills/mp-draft-push/.env; set +a' >> ~/.zshrc
```

---

## Step 0 · 确认序号

开场白里的「第 N 篇原创」必须与计数一致。

```bash
~/.workbuddy/skills/depoo-writer/scripts/next_serial.sh
```

序号在**发布成功后**才自增（路径 B 用 `--bump-serial`；路径 A 手动粘贴后，确认发出去了再手动自增）：

```bash
./scripts/next_serial.sh --bump     # 路径 A 手动自增
./scripts/next_serial.sh --set 42   # 手动校准
```

---

## Step 1 · 生成摘要（digest）

显示在分享卡片上，直接影响转发率。

- **≤ 120 字**（硬上限，超出会被截断）
- 用正文里的金句，或把核心判断改写成口语
- **不要**写成标题的复述，**不要**用「本文介绍了……」这种说明文体
- 可以留一点悬念，但必须说实话

| 标题 | 好的摘要 | 差的摘要 |
|---|---|---|
| 一个被严重低估的 AI 工具，免费！ | 我用它把每周的报表时间从 4 小时压到 20 分钟，全程没写一行代码。 | 本文介绍了这个工具的功能和使用方法。 |
| 企业上 AI，先别买工具 | 看了十几家公司的落地案例，我发现卡住的从来不是工具，是流程没拆开。 | 探讨了企业 AI 落地的关键因素。 |

---

## Step 2 · 封面图

封面决定打开率。用户提供优先；否则用 ImageGen 生成，方向是简洁、大字标题、强对比、不花哨。

```
16:9 竖版构图（2.35:1 用于公众号封面），极简科技风。
主色 #{主色}，白底或深底二选一。
主体：{一个能代表文章核心的具体物件或场景，不要抽象概念}
文字：{标题中最抓眼的 6-10 个字}，大号粗体，字重够，位置偏上或居中
留白充足，不要信息过载，不要 3D 渲染感，不要渐变光效
整体像一张杂志封面，不像 PPT
```

```bash
sips -g pixelWidth -g pixelHeight cover.png   # 公众号封面建议 2.35:1，≤10MB，jpg/png
```

---

## Step 3 · Markdown 转微信 HTML（两条路径共用，必做）

```bash
SKILL=~/.workbuddy/skills/depoo-writer

# 看有没有本地图片要处理
python3 $SKILL/depoo-writer/scripts/md_to_wechat_html.py /path/to/article.md --list-images

# 路径 A（默认）：正文 + 可复制预览，并自动用浏览器打开
python3 $SKILL/depoo-writer/scripts/md_to_wechat_html.py /path/to/article.md \
    -o /path/to/微信正文.html \
    --preview /path/to/预览.html \
    --open
```

输出：

```json
{
  "title": "文章标题",
  "title_bytes": 24,
  "title_ok": true,
  "serial": 1,
  "output": "/abs/path/微信正文.html",
  "preview": "/abs/path/预览.html",
  "pending_images": []
}
```

**两个警告必须处理**：

- `title_bytes > 64` → 标题超长，微信会截断，必须删减后重新转换
- `pending_images` 非空 → 有本地图片没上传，微信正文只认 `mmbiz.qpic.cn` 域名（路径 A 要在编辑器里单独插图，见 Step 3.5）

### 内置排版：克制简约

脚本内置排版，样式全部内联（微信会过滤 `<style>`）。设计原则：**纯白底、零背景色块、零圆角、零阴影**，靠字号 + 字重 + 留白建层级。

| 元素 | 样式 |
|---|---|
| 正文 | 16px / #2b2b2b / 行高 1.8 / 段间距 22px / 字间距 0.02em |
| `## 小标题` | 18px 加粗 / 上 40px 下 18px / **无边框无背景** |
| `**「金句」**` | 17px 加粗近黑 / 上下 34px 留白 / **不套卡片、不加边框** |
| `> 引用` | 左 2px 极浅竖线（#ebebeb）+ 14px 浅灰字 |
| 图片 | 居中 / **无圆角** / 下方 13px 浅灰图注 |
| 「第 N 篇原创」 | 13px 浅灰居中，**无色块** |
| 行内代码 / 代码块 | 浅灰底 #f6f6f6（代码块无圆角，不用深色块） |
| 链接 | 近黑文字 + 13px 浅灰 URL 灰字（微信正文不支持外链，已降级为纯文本 + 地址） |

换强调色（默认近黑 `#1a1a1a`）：

```bash
python3 scripts/md_to_wechat_html.py article.md -o a.html --theme-color "#c0392b"
```

或改脚本顶部的 `THEME` 字典。

---

## Step 3.5 · 手动粘贴到公众号后台（路径 A，默认路径）

适用于**未认证账号**或任何不走接口的情况。

1. 上一步的 `--open` 已经在浏览器打开了 `预览.html`
2. 浏览器里 **Cmd/Ctrl + A** 全选 → **Cmd/Ctrl + C** 复制
3. 进公众号后台 → 内容与互动 → 草稿箱 → 新建图文 → 正文区 **Cmd/Ctrl + V** 粘贴
4. 标题、摘要、封面单独填（这三样接口/粘贴都不会自动带过去）
5. 按 Step 5 清单过一遍再发

> **为什么用「浏览器全选复制」而不是塞 HTML 源码**：微信编辑器没有 HTML 模式，直接粘贴源码会变成一串文本。用浏览器复制富文本，编辑器解析后格式保留最完整。

> **图片要单独处理**：粘贴不会把本地图片一起带过去（微信正文只认 `mmbiz.qpic.cn`）。
> 两种办法：① 先在编辑器里把图片传到该插入的位置，再粘贴文字（顺序会乱，适合图少）；
> ② 先粘贴文字，再在对应位置手动插图（推荐，位置可控）。

---

## Step 4 · 推草稿箱（路径 B，可选 —— 必须先问用户）

**执行前的两个前提**：
1. 用户已明确要求推送（`AskUserQuestion` 确认过）
2. 前置检查里的 `draft/add` 权限探测通过（未认证账号会返回 48001）

```bash
~/.workbuddy/skills/depoo-writer/scripts/push_draft.sh \
    --title "文章标题" \
    --digest "摘要文案" \
    --html /path/to/微信正文.html \
    --cover /path/to/cover.png \
    --author "迪谱学长" \
    --bump-serial
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `--title` | ✅ | ≤ 64 字节，脚本会先检查 |
| `--digest` | ✅ | 摘要，>120 字会警告 |
| `--html` | ✅ | Step 3 产出的 HTML |
| `--cover` | ❌ | 封面图，建议总给（thumb_media_id 建议非空） |
| `--author` | ❌ | 默认「迪谱学长」，可用 `WECHAT_AUTHOR` 覆盖 |
| `--bump-serial` | ❌ | 成功后自增「第 N 篇」计数 |

失败时脚本打印原始响应。常见错误码：

| errcode | 含义 | 处理 |
|---|---|---|
| **48001** | **api 功能未授权（多为账号未认证）** | **改用路径 A 手动粘贴** |
| **40164** | **IP 不在白名单** | 后台基本配置加 IP，等 1-2 分钟 |
| 40001 | access_token 无效 | 重新获取，检查 AppSecret |
| 45009 | 接口调用超限 | 等一会儿重试 |
| 40007 | 无效的 media_id | 封面图重传 |
| 53404 | 账号已被限制 | 检查公众号状态 |

---

## Step 5 · 后台终审清单

无论走哪条路径，发出去之前人工过一遍：

- [ ] 标题有没有被截断（比 md 里短了就是超 64 字节）
- [ ] 摘要显示是否正常
- [ ] **图片是否全部显示**（没上传的会变成空白或裂图，路径 A 要手动插图）
- [ ] 金句加粗是否保留（粘贴后偶尔会掉，掉了在编辑器里重新加粗）
- [ ] 小标题字号层级是否正常
- [ ] 外链是否被吞（脚本已降级为纯文本 + 灰字地址，属预期）
- [ ] 滚动通读一遍，检查有没有漏删的 markdown 符号（`**`、`##`）
- [ ] 原创声明、留言、赞赏等开关按需设置

---

## 完整示例（路径 A，默认）

```bash
SKILL=~/.workbuddy/skills/depoo-writer
ART=~/articles/2026-08-30-ai-tool.md

# 1. 查序号（写作时已写入正文）
N=$($SKILL/depoo-writer/scripts/next_serial.sh) && echo "本篇为第 $N 篇"

# 2. 转 HTML + 生成预览并打开浏览器
python3 $SKILL/depoo-writer/scripts/md_to_wechat_html.py "$ART" \
    -o "${ART%.md}-微信正文.html" \
    --preview "${ART%.md}-预览.html" \
    --open

# 3. 浏览器全选复制 → 粘贴到公众号后台 → 手动插图 → 终审
# 4. 确认发出去后自增序号
$SKILL/depoo-writer/scripts/next_serial.sh --bump
```

---

## 注意事项

1. **默认不推送**。路径 B 是外部动作，必须用户明确确认才执行；账号未认证时直接走路径 A。
2. **正文图片只能用 `mmbiz.qpic.cn` 域名**。本地路径或图床外链在微信里都显示不出来。
3. **HTML 样式必须全部内联**。`<style>`、`<link>` 会被微信过滤掉。
4. **标题 64 字节**是硬限制（UTF-8 下一个中文 = 3 字节，约 21 个汉字）。
5. **不自动群发**。草稿箱是安全边界，最终发布由人在后台确认。
6. 发布频率注意微信的每日群发次数限制（订阅号 1 次/天，服务号 4 次/月）。
