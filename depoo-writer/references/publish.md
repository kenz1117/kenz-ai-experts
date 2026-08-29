# 发布流程

整条链路：`改定稿 md` → `转微信 HTML` → `上传图片` → `推草稿箱` → `后台终审`

依赖 `mp-draft-push` skill（位于 `~/.workbuddy/skills/mp-draft-push`），环境变量 `WECHAT_APPID` / `WECHAT_SECRET` 已在该 skill 的 `.env` 中配置。

---

## 前置检查

发布前先跑一遍，缺什么一目了然：

```bash
# 1. 依赖
command -v jq >/dev/null && echo "jq ✅" || echo "jq ❌ (brew install jq)"

# 2. 凭证
[[ -n "${WECHAT_APPID:-}" ]] && echo "APPID ✅" || echo "APPID ❌ 未设置"
[[ -n "${WECHAT_SECRET:-}" ]] && echo "SECRET ✅" || echo "SECRET ❌ 未设置"

# 3. mp-draft-push 就位
ls ~/.workbuddy/skills/mp-draft-push/scripts.sh >/dev/null 2>&1 \
  && echo "mp-draft-push ✅" || echo "mp-draft-push ❌"
```

```bash
# 4. IP 白名单（最容易卡住的一步）
TOKEN=$(curl -s "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WECHAT_APPID}&secret=${WECHAT_SECRET}")
echo "$TOKEN"
```

如果返回 `errcode: 40164 / invalid ip xxx not in whitelist`，说明 AppID + AppSecret 本身是对的，但当前出口 IP 没加到公众号后台白名单。

处理：**公众号后台 → 设置与开发 → 基本配置 → IP白名单 → 修改**，把报错里的 IP 填进去，等 1-2 分钟生效。

> ⚠️ 家用宽带的出口 IP 会变。如果换了网络环境（或隔一段时间）报 40164，重新把新 IP 加进去即可。

若凭证根本没设置：

```bash
cd ~/.workbuddy/skills/mp-draft-push
cp .env.example .env      # 填入 AppID / AppSecret
# 让环境变量在新会话也生效（写入 ~/.zshrc）
echo 'set -a; source ~/.workbuddy/skills/mp-draft-push/.env; set +a' >> ~/.zshrc
```

---

## Step 0 · 确认序号

开场白里的「第 N 篇原创」必须与计数一致。

```bash
~/.workbuddy/skills/depoo-writer/scripts/next_serial.sh
```

**序号在发布成功后才自增**（用 `--bump-serial`）。写作阶段直接读取当前值写进正文。

如果正文里的篇数和计数器不一致，先对齐再发。手动校准：

```bash
./scripts/next_serial.sh --set 42
```

---

## Step 1 · 生成摘要（digest）

显示在分享卡片上，直接影响转发率。

规范：

- **≤ 120 字**（硬上限，超出会被截断）
- 用正文里的金句，或者把核心判断改写成口语
- **不要**写成标题的复述
- **不要**用「本文介绍了……」这种说明文体
- 可以留一点悬念，但必须说实话

示例：

| 标题 | 好的摘要 | 差的摘要 |
|---|---|---|
| 一个被严重低估的 AI 工具，免费！ | 我用它把每周的报表时间从 4 小时压到 20 分钟，全程没写一行代码。 | 本文介绍了这个工具的功能和使用方法。 |
| 企业上 AI，先别买工具 | 看了十几家公司的落地案例，我发现卡住的从来不是工具，是流程没拆开。 | 探讨了企业 AI 落地的关键因素。 |

---

## Step 2 · 封面图

封面决定打开率。两种来源：

**A. 用户提供**：直接用。

**B. 生成**：用 ImageGen，方向是——简洁、大字标题、强对比、不花哨。

Brief 模板：

```
16:9 竖版构图（2.35:1 用于公众号封面），极简科技风。
主色 #{主色}，白底或深底二选一。
主体：{一个能代表文章核心的具体物件或场景，不要抽象概念}
文字：{标题中最抓眼的 6-10 个字}，大号粗体，字重够，位置偏上或居中
留白充足，不要信息过载，不要 3D 渲染感，不要渐变光效
整体像一张杂志封面，不像 PPT
```

生成后检查：

```bash
# 公众号封面建议 2.35:1，且 ≤ 10MB，支持 jpg/png
sips -g pixelWidth -g pixelHeight cover.png   # macOS 查尺寸
```

---

## Step 3 · Markdown 转微信 HTML

```bash
cd ~/.workbuddy/skills/depoo-writer

# 先看有没有本地图片需要上传
python3 scripts/md_to_wechat_html.py /path/to/article.md --list-images

# 转换（图片已上传过，用 map 替换）
python3 scripts/md_to_wechat_html.py /path/to/article.md \
    -o /path/to/article.html \
    --image-map /path/to/image-map.json

# 转换并自动上传本地图片（需 WECHAT_APPID/WECHAT_SECRET）
python3 scripts/md_to_wechat_html.py /path/to/article.md \
    -o /path/to/article.html \
    --upload-images
```

脚本会输出：

```json
{
  "title": "文章标题",
  "title_bytes": 24,
  "title_ok": true,
  "serial": 1,
  "output": "/abs/path/article.html",
  "pending_images": []
}
```

**两个警告必须处理**：

- `title_bytes > 64` → 标题超长，微信会截断，必须删减后重新转换
- `pending_images` 非空 → 有本地图片没上传，微信正文只认 `mmbiz.qpic.cn` 域名，必须补传

### 排版说明

脚本内置简洁排版，样式全部内联（微信会过滤 `<style>`）：

| 元素 | 样式 |
|---|---|
| 正文 | 15px / #3f3f3f / 行高 1.75 / 段间距 18px |
| `## 小标题` | 17px 加粗 / 左侧 3px 主色竖线 / 上间距 34px |
| `**「金句」**` | 独立卡片：浅灰底 + 主色左边框 + 主色加粗字 |
| `> 引用` | 浅灰底 + 灰边框 + 14px（用于链接、补充、成本说明） |
| 图片 | 居中 / 圆角 6px / 下方自动加图注 |
| 「第 N 篇原创」 | 自动识别，渲染成居中浅灰小条 |

换主色：

```bash
python3 scripts/md_to_wechat_html.py article.md -o article.html --theme-color "#c0392b"
```

或改脚本顶部的 `THEME` 字典。

---

## Step 4 · 推草稿箱

```bash
~/.workbuddy/skills/depoo-writer/scripts/push_draft.sh \
    --title "文章标题" \
    --digest "摘要文案" \
    --html /path/to/article.html \
    --cover /path/to/cover.png \
    --author "迪谱" \
    --bump-serial
```

参数说明：

| 参数 | 必填 | 说明 |
|---|---|---|
| `--title` | ✅ | ≤ 64 字节，脚本会先检查 |
| `--digest` | ✅ | 摘要，>120 字会警告 |
| `--html` | ✅ | Step 3 产出的 HTML |
| `--cover` | ❌ | 封面图，建议总给（微信 thumb_media_id 建议非空） |
| `--author` | ❌ | 默认「迪谱」，可用 `WECHAT_AUTHOR` 覆盖 |
| `--bump-serial` | ❌ | 成功后自增「第 N 篇」计数 |

成功输出：

```
草稿发布成功
  标题：文章标题（24/64 字节）
  摘要：摘要文案
  作者：迪谱
  草稿 ID：xxxxx
  序号已自增，下一篇为第 2 篇

请前往后台终审：https://mp.weixin.qq.com
```

失败时脚本会打印原始响应。常见错误码：

| errcode | 含义 | 处理 |
|---|---|---|
| **40164** | **IP 不在白名单** | 后台基本配置里加 IP，等 1-2 分钟 |
| 40001 | access_token 无效 | 重新获取，检查 AppSecret |
| 45009 | 接口调用超限 | 等一会儿重试 |
| 40007 | 无效的 media_id | 封面图重传 |
| 53404 | 账号已被限制 | 检查公众号状态 |

---

## Step 5 · 后台终审清单

草稿只是草稿，必须人工过一遍再点发布：

- [ ] 标题有没有被截断（比 md 里短了就是超 64 字节）
- [ ] 摘要显示是否正常
- [ ] **图片是否全部显示**（没上传的会变成空白或裂图）
- [ ] 排版有没有错位（尤其引用块和金句卡片）
- [ ] 小标题竖线是否渲染出来了
- [ ] 外链是否被吞（微信正文不支持外部超链接，脚本已降级为纯文本 + 灰字地址）
- [ ] 滚动通读一遍，检查有没有漏删的 markdown 符号（`**`、`##`）
- [ ] 原创声明、留言、赞赏等开关按需设置

---

## 完整一键示例

```bash
SKILL=~/.workbuddy/skills/depoo-writer
ART=~/articles/2026-08-30-ai-tool.md

# 1. 查序号（写作时已写入正文）
N=$($SKILL/scripts/next_serial.sh) && echo "本篇为第 $N 篇"

# 2. 转换 + 上传图片
python3 $SKILL/scripts/md_to_wechat_html.py "$ART" -o "${ART%.md}.html" --upload-images

# 3. 推草稿
$SKILL/scripts/push_draft.sh \
    --title "一个被严重低估的 AI 工具，免费！" \
    --digest "我用它把每周的报表时间从 4 小时压到 20 分钟，全程没写一行代码。" \
    --html "${ART%.md}.html" \
    --cover ~/articles/cover.png \
    --bump-serial
```

---

## 注意事项

1. **access_token 有效期 2 小时**，脚本每次调用自动重新获取，不用管。
2. **正文图片只能用 `mmbiz.qpic.cn` 域名**。本地路径或图床外链在微信里都显示不出来。
3. **HTML 样式必须全部内联**。`<style>`、`<link>` 会被微信过滤掉。
4. **标题 64 字节**是硬限制（UTF-8 下一个中文 = 3 字节，约 21 个汉字）。
5. **不自动群发**。草稿箱是安全边界，最终发布由人在后台确认。
6. 发布频率注意微信的每日群发次数限制（订阅号 1 次/天，服务号 4 次/月）。
