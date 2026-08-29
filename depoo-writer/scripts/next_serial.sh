#!/bin/bash
# 「这是迪谱学长的第 N 篇原创」序号管理
#
# 用法:
#   ./next_serial.sh            # 查看当前序号（下一篇该用的数字）
#   ./next_serial.sh --bump     # 发布成功后自增，输出新序号
#   ./next_serial.sh --set 42   # 手动校准

set -euo pipefail

SERIAL_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/assets/serial.txt"

# 初始化
[[ -f "$SERIAL_FILE" ]] || echo "1" > "$SERIAL_FILE"

current=$(tr -d '[:space:]' < "$SERIAL_FILE")
[[ "$current" =~ ^[0-9]+$ ]] || { echo "ERROR: serial.txt 内容非法: '$current'" >&2; exit 1; }

case "${1:-}" in
    --bump)
        next=$((current + 1))
        echo "$next" > "$SERIAL_FILE"
        echo "$next"
        ;;
    --set)
        [[ -n "${2:-}" ]] || { echo "ERROR: --set 需要一个数字" >&2; exit 1; }
        [[ "$2" =~ ^[0-9]+$ ]] || { echo "ERROR: 序号必须是正整数" >&2; exit 1; }
        echo "$2" > "$SERIAL_FILE"
        echo "序号已设为 $2"
        ;;
    "")
        echo "$current"
        ;;
    *)
        echo "ERROR: 未知参数 $1" >&2
        exit 1
        ;;
esac
