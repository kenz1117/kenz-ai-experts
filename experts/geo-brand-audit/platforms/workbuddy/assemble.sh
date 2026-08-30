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
cp    "$HERE/README.en.md"    "$OUT/"   # 双语 README
cp -R "$CORE/."               "$OUT/skill/"

# 组装后自检：跑一遍离线回归，确保核心脚本在包内完好
# 注意：这里不能 `node smoke-test.js | tail`，管道的退出码取自 tail，会吞掉 node 的失败。
if command -v node >/dev/null 2>&1 && [ -f "$OUT/skill/scripts/smoke-test.js" ]; then
  echo ""
  echo "→ 组装后自检（离线回归）:"
  if (cd "$OUT/skill" && node scripts/smoke-test.js >/tmp/geo-assemble-smoke.log 2>&1); then
    tail -2 /tmp/geo-assemble-smoke.log
  else
    echo "⚠ 自检未通过，完整输出:"; cat /tmp/geo-assemble-smoke.log; exit 1
  fi
fi

echo "✓ 自包含专家包已生成: $OUT"
echo "  安装到 WorkBuddy:"
echo "    cp -R \"$OUT\" ~/.workbuddy/plugins/marketplaces/my-experts/plugins/"
echo "    python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/register_expert.py \"$OUT\""
