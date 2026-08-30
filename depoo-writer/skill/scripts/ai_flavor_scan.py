#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI 味终扫（机扫层）—— 发布前最后一道关

人工自检看不出的东西（句长方差、虚词密度、介词框架占比、重复片段），只能靠脚本算。
本脚本把三个去 AI 味体系里**可量化**的部分自动化：
  · 降AI率 v2.0  —— 句长方差、虚词密度、显性逻辑词、介词框架、僵尸词、重复片段
  · humanizer-zh —— 24 种模式里的高频词、破折号、粗体
  · humanizer v4.1 —— 堆叠副词、自问自答老师腔、数字假严谨
  · 本号 E25    —— 泛称「用户」堆积、说教腔、硬过渡、注水

用法:
    python3 ai_flavor_scan.py article.md
    python3 ai_flavor_scan.py article.md --json      # 机器可读
    python3 ai_flavor_scan.py article.md --verbose   # 打印每处命中位置

退出码: 0=放行(A/B)  1=需修改(C/D)
"""

import argparse
import json
import re
import sys
from collections import Counter

# ============ 词表 ============

AI_WORDS = [  # AI 高频词（命中即扣）
    "此外", "至关重要", "深入探讨", "持久的", "培养", "格局", "织锦",
    "宝贵的", "充满活力", "标志着", "见证了", "不可磨灭", "赋能",
    "本质上", "换句话说", "不可否认", "综上所述", "值得注意的是",
    "不难发现", "让我们来看看", "接下来让我们", "意味着什么", "这意味着",
]

PREACHY = [  # 说教腔 / 硬过渡（本号 E25）
    "咱们", "你总得", "你买不到", "别觉得", "接下来我们看看",
    "而且这事比", "更重要的是", "先说人话", "说人话",
]

TRANSLATION_DECLARE = [  # 翻译宣告（本号文风禁区第 6 条）
    "翻译成人话", "说白了", "简单说，它就是", "简单说它就是",
]

LOGIC_WORDS = ["因此", "然而", "此外", "首先", "其次", "总之", "综上所述", "值得注意的是"]

ADVERB_STACK = ["极其", "极度", "猛地", "死死", "狠狠", "稳稳", "仿佛", "瞬间", "紧接着"]

TEACHER_TONE = [  # 自问自答老师腔
    "这叫什么", "说明什么", "你以为", "实际上呢", "看明白了吗", "这意味着什么",
]

PREP_FRAME_START = ("在", "通过", "基于", "随着", "对于", "关于")  # 句首介词框架

FUNCTION_WORDS = ("的", "了", "过", "着")  # 虚词（冗余定语癌指标）

# ============ 文本预处理 ============

def strip_metadata(text):
    """去掉不该参与扫描的部分：frontmatter / 图片 / 引用块 / 代码块 / 配图建议"""
    lines = text.split("\n")
    out, in_code, in_front = [], False, False
    for i, ln in enumerate(lines):
        s = ln.strip()
        if i == 0 and s == "---":
            in_front = True
            continue
        if in_front:
            if s == "---":
                in_front = False
            continue
        if s.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        if s.startswith(">") or s.startswith("![图片]") or re.match(r"^!\[.*\]\(.*\)$", s):
            continue  # 引用块与图片占位（元信息，不算正文）
        out.append(ln)
    return "\n".join(out)


def sentences(text):
    """按句末标点切句"""
    parts = re.split(r"[。！？!?；;\n]+", text)
    return [p.strip() for p in parts if p.strip()]


def paragraphs(text):
    return [p.strip() for p in text.split("\n\n") if p.strip()]


def variance(xs):
    if len(xs) < 2:
        return 0.0
    m = sum(xs) / len(xs)
    return sum((x - m) ** 2 for x in xs) / len(xs)


# ============ 检测项 ============

def scan(text, verbose=False):
    raw = strip_metadata(text)
    sents = sentences(raw)
    paras = paragraphs(raw)
    total_chars = len(re.sub(r"\s", "", raw))
    issues, stats = [], {}

    def hit(words, label, deduct_each=1, cap=10, advice=""):
        found = []
        for w in words:
            n = raw.count(w)
            if n:
                found.append((w, n))
        if found:
            total = sum(n for _, n in found)
            issues.append({
                "item": label,
                "detail": "、".join(f"{w}×{n}" for w, n in found),
                "count": total,
                "deduct": min(total * deduct_each, cap),
                "advice": advice,
            })
        stats[label] = sum(n for _, n in found)
        return found

    # 1. AI 高频词
    hit(AI_WORDS, "AI 高频词", deduct_each=2, cap=20,
        advice="逐个换成具体说法，或直接删")

    # 2. 说教腔 / 硬过渡（本号 E25）
    hit(PREACHY, "说教腔 / 硬过渡", deduct_each=2, cap=16,
        advice="去掉指指点点；硬过渡换成带推进感的短句")

    # 3. 翻译宣告
    hit(TRANSLATION_DECLARE, "翻译宣告", deduct_each=3, cap=12,
        advice="直接给类比和场景，别先喊一声")

    # 4. 堆叠副词
    hit(ADVERB_STACK, "高频堆叠副词", deduct_each=1, cap=8,
        advice="一段内重复的删到只剩最必要的一处")

    # 5. 自问自答老师腔
    hit(TEACHER_TONE, "自问自答老师腔", deduct_each=2, cap=10,
        advice="改成直接陈述")

    # 6. 泛称「用户」
    n_user = raw.count("用户")
    stats["泛称「用户」"] = n_user
    if n_user > 2:
        issues.append({
            "item": "泛称「用户」堆积",
            "detail": f"出现 {n_user} 次（红线 ≤2）",
            "count": n_user,
            "deduct": min((n_user - 2) * 2, 12),
            "advice": "改成「人家 / 身边人 / 他」",
        })

    # 7. 显性逻辑词
    n_logic = sum(raw.count(w) for w in LOGIC_WORDS)
    stats["显性逻辑词"] = n_logic
    if n_logic >= 3:
        issues.append({
            "item": "显性逻辑词过多",
            "detail": f"{n_logic} 处",
            "count": n_logic,
            "deduct": min(n_logic, 8),
            "advice": "删到 2 处以内，用隐性承接（短句、换行）替代",
        })

    # 8. 句长方差（目标 > 6，越高越有节奏）
    lens = [len(re.sub(r"\s", "", s)) for s in sents if len(s) > 1]
    var = variance(lens)
    stats["句长方差"] = round(var, 1)
    stats["平均句长"] = round(sum(lens) / len(lens), 1) if lens else 0
    if var < 6:
        issues.append({
            "item": "句长太平（高危平坦区）",
            "detail": f"方差 {var:.1f}（目标 >6），平均句长 {stats['平均句长']} 字",
            "count": 1,
            "deduct": 8 if var < 3 else 5,
            "advice": "长短句交错：塞几句 8 字内的短句，再放一两句长的",
        })

    # 9. 虚词密度（的/了/过/着，目标 < 8%）
    if total_chars:
        fw = sum(raw.count(w) for w in FUNCTION_WORDS)
        density = fw / total_chars * 100
        stats["虚词密度"] = f"{density:.1f}%"
        if density > 8:
            issues.append({
                "item": "虚词密度过高（冗余定语癌）",
                "detail": f"{density:.1f}%（红线 8%）",
                "count": 1,
                "deduct": 6,
                "advice": "删多余的「的」，「X的Y」改名词堆叠",
            })

    # 10. 介词框架开头句占比（目标 < 30%）
    if sents:
        framed = sum(1 for s in sents if s.startswith(PREP_FRAME_START))
        ratio = framed / len(sents) * 100
        stats["介词框架句占比"] = f"{ratio:.0f}%"
        if ratio > 30:
            issues.append({
                "item": "介词框架开头过多（官腔模板区）",
                "detail": f"{ratio:.0f}%（红线 30%）",
                "count": framed,
                "deduct": 6,
                "advice": "把「在…下 / 通过… / 基于…」句式拆掉重组",
            })

    # 11. 僵尸词（高频实词 Top5，占比 > 2%）
    words2 = re.findall(r"[\u4e00-\u9fa5]{2,4}", raw)
    top = Counter(words2).most_common(5)
    stats["高频词 Top5"] = "、".join(f"{w}({n})" for w, n in top)
    zombies = [(w, n) for w, n in top if total_chars and n * len(w) / total_chars > 0.02]
    if zombies:
        issues.append({
            "item": "僵尸词（重复率 >2%）",
            "detail": "、".join(f"{w}×{n}" for w, n in zombies),
            "count": sum(n for _, n in zombies),
            "deduct": 5,
            "advice": "同指一物的换统一说法，或删重复表述",
        })

    # 12. 连续 12 字重复片段（防局部哈希检测）
    #     只取中文序列：英文路径 / 仓库名 / 代码片段的重复是正常的，不算 AI 味
    clean = "".join(re.findall(r"[\u4e00-\u9fa5]", raw))
    seen, dup = set(), []
    for i in range(len(clean) - 12):
        seg = clean[i:i + 12]
        if seg in seen and seg not in dup:
            dup.append(seg)
        seen.add(seg)
    stats["重复 12 字段落"] = len(dup)
    if dup:
        issues.append({
            "item": "连续 12 字重复片段",
            "detail": "；".join(dup[:3]) + ("…" if len(dup) > 3 else ""),
            "count": len(dup),
            "deduct": min(len(dup) * 3, 12),
            "advice": "改写其中一处，避免整段雷同",
        })

    # 13. 段落长度方差（避免等长段）
    plens = [len(re.sub(r"\s", "", p)) for p in paras]
    pvar = variance(plens)
    stats["段落长度方差"] = round(pvar, 1)
    if plens and pvar < 200:
        issues.append({
            "item": "段落长度过于均匀",
            "detail": f"方差 {pvar:.0f}（目标 >200）",
            "count": 1,
            "deduct": 4,
            "advice": "制造参差：一两句话的短段 + 稍长的展开段",
        })

    # 14. 破折号与粗体
    n_dash = raw.count("——")
    n_bold = len(re.findall(r"\*\*.+?\*\*", raw))
    stats["破折号"] = n_dash
    stats["加粗"] = n_bold
    if n_dash > 3:
        issues.append({
            "item": "破折号过多",
            "detail": f"{n_dash} 处（上限 3）",
            "count": n_dash,
            "deduct": min((n_dash - 3) * 2, 8),
            "advice": "删掉揭示前的破折号",
        })
    if n_bold > 5:
        issues.append({
            "item": "加粗过多",
            "detail": f"{n_bold} 处（金句上限 5）",
            "count": n_bold,
            "deduct": min((n_bold - 5) * 2, 8),
            "advice": "加粗只给金句",
        })

    # 15. 「不是A，而是B」定位（三毒需人工判，这里只标位置）
    nny = re.findall(r"[^。！？\n]{0,30}不是[^。！？\n]{0,20}(?:，|,)而是[^。！？\n]{0,30}", raw)
    stats["「不是…而是…」"] = len(nny)
    if nny:
        issues.append({
            "item": "「不是A而是B」需人工判三毒",
            "detail": "；".join(s.strip()[:28] for s in nny[:3]),
            "count": len(nny),
            "deduct": 0,  # 好用法不扣分，只提示
            "advice": "逐处判：假靶子（没人这么说过 → 删前半句）/ 同义替换（A=B → 合并）/ 硬凑（删了无损 → 删）",
        })

    # 16. 数字假严谨（过分具体的小数）
    fake_num = re.findall(r"\d+\.\d{1,2}(?:cm|秒|米|%)", raw)
    stats["可疑精确数字"] = len(fake_num)
    if fake_num:
        issues.append({
            "item": "数字过分具体（假严谨）",
            "detail": "、".join(fake_num[:5]),
            "count": len(fake_num),
            "deduct": 0,
            "advice": "确认是真数据；否则删掉伪精确",
        })

    return issues, stats, {"字数": total_chars, "句数": len(sents), "段数": len(paras)}


def grade(score):
    if score >= 90:
        return "A", "放行"
    if score >= 78:
        return "B", "小修后放行"
    if score >= 60:
        return "C", "需修改"
    return "D", "AI 味重，返工"


def main():
    ap = argparse.ArgumentParser(description="AI 味终扫（发布前最后一道关）")
    ap.add_argument("markdown")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--verbose", action="store_true", help="打印详细")
    args = ap.parse_args()

    with open(args.markdown, encoding="utf-8") as f:
        text = f.read()

    issues, stats, meta = scan(text, args.verbose)
    deducted = sum(i["deduct"] for i in issues)
    score = max(0, 100 - deducted)
    g, verdict = grade(score)

    if args.json:
        print(json.dumps({"score": score, "grade": g, "verdict": verdict,
                          "issues": issues, "stats": stats, "meta": meta},
                         ensure_ascii=False, indent=2))
        return 0 if g in ("A", "B") else 1

    print("=" * 62)
    print("  AI 味终扫 · 发布前最后一道关")
    print("=" * 62)
    print(f"  文件: {args.markdown}")
    print(f"  规模: {meta['字数']} 字 / {meta['句数']} 句 / {meta['段数']} 段")
    print()

    if issues:
        print("  【问题清单】")
        for i in issues:
            flag = "⚠️ " if i["deduct"] > 0 else "ℹ️ "
            print(f"  {flag}{i['item']}  (-{i['deduct']})")
            print(f"      {i['detail']}")
            print(f"      → {i['advice']}")
        print()
    else:
        print("  【问题清单】✅ 机扫层零命中\n")

    print("  【量化指标】")
    for k, v in stats.items():
        print(f"      {k}: {v}")
    print()
    print(f"  得分: {score}/100   等级: {g}   判定: {verdict}")
    print("=" * 62)
    return 0 if g in ("A", "B") else 1


if __name__ == "__main__":
    sys.exit(main())
