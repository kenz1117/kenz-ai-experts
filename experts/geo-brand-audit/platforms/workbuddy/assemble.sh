#!/usr/bin/env bash
# 从「核心 + 多端」源码组装出一个【自包含】的 WorkBuddy 专家包。
# 因为 GitHub 仓库里 skill/ 是平台无关核心（被多端共享），而 WorkBuddy 要求
# plugin.json 的 skills 指向包内 ./skill，所以安装前需要这一步把核心拷进包内。
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
CORE="$HERE/../../skill"
OUT="${1:-$HERE/dist/geo-brand-audit}"

rm -rf "$OUT"
mkdir -p "$OUT/skill"
cp -R "$HERE/.codebuddy-plugin" "$OUT/"
cp -R "$HERE/agents"          "$OUT/"
cp -R "$HERE/avatars"         "$OUT/"
cp    "$HERE/README.md"       "$OUT/"
cp -R "$CORE/."               "$OUT/skill/"

echo "✓ 自包含专家包已生成: $OUT"
echo "  安装到 WorkBuddy:"
echo "    cp -R \"$OUT\" ~/.workbuddy/plugins/marketplaces/my-experts/plugins/"
echo "    python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/register_expert.py \"$OUT\""
