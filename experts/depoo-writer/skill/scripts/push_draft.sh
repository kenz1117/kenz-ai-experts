#!/bin/bash
# 发布到微信公众号草稿箱（封装 mp-draft-push）
#
# 用法:
#   ./push_draft.sh \
#     --title "文章标题" \
#     --digest "摘要" \
#     --html /path/to/article.html \
#     [--cover /path/to/cover.png] \
#     [--author "迪谱学长"] \
#     [--bump-serial]        # 成功后自增「第 N 篇原创」序号
#
# 依赖环境变量（复用 mp-draft-push 的配置）:
#   WECHAT_APPID / WECHAT_SECRET

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MP_SKILL="${MP_PUSH_SKILL:-$HOME/.workbuddy/skills/mp-draft-push}"
SERIAL_SH="$HERE/next_serial.sh"

TITLE=""; DIGEST=""; HTML_FILE=""; COVER=""
AUTHOR="${WECHAT_AUTHOR:-迪谱学长}"
BUMP=0

usage() {
    echo "用法: $0 --title <标题> --digest <摘要> --html <html路径> [--cover <封面图>] [--author <署名>] [--bump-serial]"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --title)  TITLE="$2";   shift 2 ;;
        --digest) DIGEST="$2";  shift 2 ;;
        --html)   HTML_FILE="$2"; shift 2 ;;
        --cover)  COVER="$2";   shift 2 ;;
        --author) AUTHOR="$2";  shift 2 ;;
        --bump-serial) BUMP=1;  shift ;;
        *) usage ;;
    esac
done

[[ -n "$TITLE" && -n "$DIGEST" && -n "$HTML_FILE" ]] || usage
[[ -f "$HTML_FILE" ]] || { echo "ERROR: HTML 文件不存在: $HTML_FILE" >&2; exit 1; }
[[ -f "$MP_SKILL/scripts.sh" ]] || { echo "ERROR: 找不到 mp-draft-push: $MP_SKILL" >&2; exit 1; }

# 标题字节数检查（微信上限 64 字节）
TITLE_BYTES=$(python3 -c "import sys;print(len(sys.argv[1].encode('utf-8')))" "$TITLE")
if (( TITLE_BYTES > 64 )); then
    echo "ERROR: 标题 ${TITLE_BYTES} 字节，超过微信 64 字节上限，请先删减" >&2
    exit 1
fi

# 摘要长度检查（建议 ≤ 120 字）
DIGEST_LEN=$(python3 -c "import sys;print(len(sys.argv[1]))" "$DIGEST")
if (( DIGEST_LEN > 120 )); then
    echo "WARN: 摘要 ${DIGEST_LEN} 字，建议 ≤ 120 字" >&2
fi

# shellcheck disable=SC1090
source "$MP_SKILL/scripts.sh"

echo "→ 获取 access_token ..."
TOKEN=$(get_wechat_token)
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || { echo "ERROR: access_token 获取失败，检查 AppID/AppSecret" >&2; exit 1; }

THUMB_MEDIA_ID=""
if [[ -n "$COVER" ]]; then
    [[ -f "$COVER" ]] || { echo "ERROR: 封面图不存在: $COVER" >&2; exit 1; }
    echo "→ 上传封面图 ..."
    MEDIA_RESPONSE=$(upload_wechat_image "$TOKEN" "$COVER")
    THUMB_MEDIA_ID=$(echo "$MEDIA_RESPONSE" | jq -r '.media_id')
    [[ -n "$THUMB_MEDIA_ID" && "$THUMB_MEDIA_ID" != "null" ]] || {
        echo "ERROR: 封面上传失败: $MEDIA_RESPONSE" >&2; exit 1; }
    echo "  thumb_media_id = $THUMB_MEDIA_ID"
else
    echo "WARN: 未提供封面图，草稿将无封面" >&2
fi

echo "→ 创建草稿 ..."
TMP_JSON="/tmp/depoo_draft_$(date +%Y%m%d%H%M%S).json"
jq -n \
    --arg title "$TITLE" \
    --arg author "$AUTHOR" \
    --arg digest "$DIGEST" \
    --rawfile content "$HTML_FILE" \
    --arg thumb_media_id "$THUMB_MEDIA_ID" \
    '{articles:[{
        title: $title,
        author: $author,
        digest: $digest,
        content: $content,
        thumb_media_id: $thumb_media_id,
        need_open_comment: 1,
        only_fans_can_comment: 0
    }]}' > "$TMP_JSON"

DRAFT_RESPONSE=$(create_draft "$TOKEN" "$TMP_JSON")
rm -f "$TMP_JSON"

DRAFT_MEDIA_ID=$(echo "$DRAFT_RESPONSE" | jq -r '.media_id')
if [[ -z "$DRAFT_MEDIA_ID" || "$DRAFT_MEDIA_ID" == "null" ]]; then
    echo "ERROR: 草稿创建失败: $DRAFT_RESPONSE" >&2
    exit 1
fi

NEW_SERIAL=""
if (( BUMP == 1 )); then
    NEW_SERIAL=$("$SERIAL_SH" --bump)
fi

echo ""
echo "草稿发布成功"
echo "  标题：${TITLE}（${TITLE_BYTES}/64 字节）"
echo "  摘要：${DIGEST}"
echo "  作者：${AUTHOR}"
echo "  草稿 ID：${DRAFT_MEDIA_ID}"
[[ -n "$NEW_SERIAL" ]] && echo "  序号已自增，下一篇为第 ${NEW_SERIAL} 篇"
echo ""
echo "请前往后台终审：https://mp.weixin.qq.com"
