#!/usr/bin/env bash
# 从「核心 + 多端」源码组装出一个【自包含】的 WorkBuddy 专家包。
# 因为 GitHub 仓库里 skill/ 是平台无关核心（被多端共享），而 WorkBuddy 要求
# plugin.json 的 skills 指向包内 ./skill，所以安装前需要这一步把核心拷进包内。
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
CORE="$HERE/../../skill"
OUT="${1:-$HERE/dist/depoo-writer}"

rm -rf "$OUT"
mkdir -p "$OUT/skill"
cp -R "$HERE/.codebuddy-plugin" "$OUT/"
cp -R "$HERE/agents"          "$OUT/"
cp -R "$HERE/avatars"         "$OUT/"
cp    "$HERE/README.md"       "$OUT/"
cp    "$HERE/README.en.md"    "$OUT/"   # 双语 README
cp -R "$CORE/."               "$OUT/skill/"

# 组装后自检：确认核心脚本在包内完好（Python 语法检查 + 一次真实转换冒烟）
if command -v python3 >/dev/null 2>&1 && [ -f "$OUT/skill/scripts/md_to_wechat_html.py" ]; then
  echo ""
  echo "→ 组装后自检:"
  if python3 -m py_compile "$OUT/skill/scripts/md_to_wechat_html.py"; then
    echo "  ✓ md_to_wechat_html.py 语法通过"
  else
    echo "  ⚠ 自检未通过：脚本语法错误"; exit 1
  fi
  # 冒烟：喂一段最小 md，确认能出 HTML
  SMOKE=$(mktemp -d)
  printf '# 标题\n\n这是迪谱学长的第 1 篇原创！\n\n第一段正文。\n\n## 小标题\n\n**「一句金句。」**\n' > "$SMOKE/t.md"
  if python3 "$OUT/skill/scripts/md_to_wechat_html.py" "$SMOKE/t.md" -o "$SMOKE/t.html" >/dev/null 2>&1 \
     && grep -q '这是迪谱学长的第 1 篇原创' "$SMOKE/t.html" \
     && grep -q '一句金句' "$SMOKE/t.html"; then
    echo "  ✓ 转 HTML 冒烟通过"
  else
    echo "  ⚠ 自检未通过：转换结果异常"; exit 1
  fi
  rm -rf "$SMOKE"
fi

echo "✓ 自包含专家包已生成: $OUT"
echo "  安装到 WorkBuddy:"
echo "    cp -R \"$OUT\" ~/.workbuddy/plugins/marketplaces/my-experts/plugins/"
echo "    python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/register_expert.py \"$OUT\""
