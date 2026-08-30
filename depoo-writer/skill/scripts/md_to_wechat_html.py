#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Markdown -> 微信公众号内联样式 HTML（克制 · 编辑感版）

设计原则（2026-08-30 第二版）：
  · 克制的底线不动：零背景色块、零圆角、零阴影、零渐近色
  · 高级感来自三处细节，而非装饰：
      1) 衬线 / 无衬线混排 —— 标题与金句用衬线（杂志编辑感），正文用无衬线（阅读舒适）
      2) 发丝线与短横标 —— 金句上下细线夹（引言式）、小标题下方短横标、居中短分隔线
      3) 精确留白 —— 靠字重、字号、间距建立层级
  · 结构用微信原生 section + p（h 标签在部分编辑器会被剥离，不用）
  · 所有样式内联，可直接用于 /cgi-bin/draft/add 的 content 字段

用法:
    python3 md_to_wechat_html.py article.md -o article.html --preview preview.html [--open]
    python3 md_to_wechat_html.py article.md -o article.html --upload-images
    python3 md_to_wechat_html.py article.md -o article.html --image-map map.json
    python3 md_to_wechat_html.py article.md --list-images
"""

import argparse
import html
import json
import os
import re
import subprocess
import sys

# ============ 主题配置（改这里换风格）============
THEME = {
    "primary": "#1a1a1a",        # 强调色（链接）—— 近黑
    "text": "#2c2c2c",           # 正文（略带温度，不是死黑）
    "heading": "#111111",        # 标题 / 金句
    "muted": "#9b9b9b",          # 弱化文字（开篇计数、图注）
    "line": "#e8e8e8",           # 发丝线（金句上下、分隔）
    "line_dark": "#d4d4d4",      # 稍深的线（短横标、引用竖线）
    "quote_text": "#6e6e6e",     # 引用文字
    "code_bg": "#f7f7f7",        # 代码块 / 行内代码底（浅灰，不用深色块）
    "font_size": "16px",
    "line_height": "1.8",
    "para_gap": "22px",
}

# 正文：无衬线，长文阅读舒适
SANS_STACK = ("-apple-system, BlinkMacSystemFont, 'Helvetica Neue', "
              "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif")

# 标题 / 金句：衬线，杂志编辑感的来源（Android 无衬线中文时自动回退，不影响阅读）
SERIF_STACK = ("'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', 'STSong', "
               "Georgia, 'Times New Roman', serif")

# 预览外壳：模拟微信正文宽度（677px），本地浏览器打开后可直接全选复制粘贴到微信编辑器
# 注意：底色保持纯白、不加任何装饰元素，否则会被一起复制进正文
PREVIEW_TPL = """<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title></head>
<body style="margin:0;background:#ffffff;padding:32px 16px;">
<div style="max-width:677px;margin:0 auto;background:#ffffff;padding:0;">
{body}
</div>
</body></html>
"""


def esc(s):
    return html.escape(s, quote=False)


def rule(width, height, color, margin, align='left'):
    """发丝线 / 短横标：用空 section（微信安全，不会被过滤）"""
    pos = 'margin:{} auto;' if align == 'center' else 'margin:{};'
    return (f'<section style="width:{width};height:{height};background:{color};'
            f'{pos.format(margin)}font-size:0;line-height:0;"></section>')


# ============ 行内解析 ============

def inline(text, theme=THEME):
    """处理 **加粗**、*斜体*、`代码`、[文字](链接)"""
    codes = []

    def stash_code(m):
        codes.append(m.group(1))
        return f"\x00CODE{len(codes) - 1}\x00"

    text = re.sub(r'`([^`]+)`', stash_code, text)

    text = esc(text)

    # 加粗（含金句里的「」）
    text = re.sub(r'\*\*(.+?)\*\*',
                  lambda m: f'<strong style="color:{theme["heading"]};font-weight:700;">{m.group(1)}</strong>',
                  text)
    # 斜体
    text = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)',
                  lambda m: f'<em style="font-style:normal;color:{theme["quote_text"]};">{m.group(1)}</em>',
                  text)

    # 链接：微信正文外链会被吞，只保留文字 + 灰色地址
    def link_repl(m):
        label, url = m.group(1), m.group(2)
        if url.startswith('http'):
            return (f'<span style="color:{theme["primary"]};">{label}</span>'
                    f'<span style="color:{theme["muted"]};font-size:13px;">（{url}）</span>')
        return f'<span style="color:{theme["primary"]};">{label}</span>'

    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link_repl, text)

    # 还原代码（浅灰底、无圆角，避免深色块在白底文章里跳出来）
    def restore_code(m):
        idx = int(m.group(1))
        return (f'<code style="background:{theme["code_bg"]};padding:2px 5px;border-radius:2px;'
                f'font-size:13px;color:#333333;font-family:Menlo,Consolas,monospace;">'
                f'{esc(codes[idx])}</code>')

    text = re.sub(r'\x00CODE(\d+)\x00', restore_code, text)
    return text


# ============ 块级渲染 ============

SERIAL_RE = re.compile(r'^\s*这是迪谱学长的第\s*(\d+)\s*篇原创[！!]?\s*$')
GOLDEN_RE = re.compile(r'^\*\*「(.+)」\*\*$')
IMAGE_RE = re.compile(r'^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$')
TAIL_RE = re.compile(r'^以上，既然看到这里了')
SIGN_RE = re.compile(r'^谢谢你看我的文章')


def render_serial(matched_text, theme=THEME):
    """开篇计数：衬线小字 + 宽字距 + 下方居中短线（杂志刊头感）"""
    n = SERIAL_RE.match(matched_text).group(1)
    return (
        f'<section style="margin:0 0 34px 0;text-align:center;">'
        f'<p style="margin:0;font-family:{SERIF_STACK};font-size:13px;color:{theme["muted"]};'
        f'letter-spacing:0.22em;line-height:1.6;">这是迪谱学长的第 {n} 篇原创</p>'
        f'{rule("18px", "1px", theme["line_dark"], "14px auto 0", align="center")}'
        f'</section>'
    )


def render_golden(text, theme=THEME):
    """金句：衬线 + 上下发丝线夹住（杂志引言式），不套色块"""
    inner = GOLDEN_RE.match(text).group(1)
    return (
        f'<section style="margin:38px 0;padding:24px 0;'
        f'border-top:1px solid {theme["line"]};border-bottom:1px solid {theme["line"]};">'
        f'<p style="margin:0;font-family:{SERIF_STACK};font-size:18px;line-height:1.9;'
        f'color:{theme["heading"]};font-weight:700;letter-spacing:0.02em;">'
        f'「{inline(inner, theme)}」</p>'
        f'</section>'
    )


def render_h2(text, theme=THEME, index=0):
    """小标题：衬线序号（01/02）+ 标题 + 下方短横标"""
    num_html = ''
    if index:
        num_html = (
            f'<p style="margin:0 0 9px 0;font-family:{SERIF_STACK};font-size:12px;'
            f'color:{theme["muted"]};letter-spacing:0.24em;line-height:1;">{index:02d}</p>'
        )
    return (
        f'<section style="margin:46px 0 20px 0;">'
        f'{num_html}'
        f'<p style="margin:0;font-family:{SERIF_STACK};font-size:18px;line-height:1.55;'
        f'color:{theme["heading"]};font-weight:700;letter-spacing:0.03em;">'
        f'{inline(text, theme)}</p>'
        f'{rule("28px", "2px", theme["heading"], "14px 0 0")}'
        f'</section>'
    )


def render_h3(text, theme=THEME):
    return (
        f'<section style="margin:32px 0 14px 0;">'
        f'<p style="margin:0;font-family:{SERIF_STACK};font-size:16px;line-height:1.55;'
        f'color:{theme["heading"]};font-weight:700;letter-spacing:0.03em;">'
        f'{inline(text, theme)}</p>'
        f'</section>'
    )


def render_lead(text, theme=THEME):
    """导语段：开篇第一段，字号略大、颜色略深（杂志导语感）"""
    return (
        f'<p style="margin:0 0 {theme["para_gap"]} 0;font-size:17px;'
        f'line-height:1.85;color:#1f1f1f;letter-spacing:0.02em;word-break:break-word;">'
        f'{inline(text, theme)}</p>'
    )


def render_p(text, theme=THEME):
    return (
        f'<p style="margin:0 0 {theme["para_gap"]} 0;font-size:{theme["font_size"]};'
        f'line-height:{theme["line_height"]};color:{theme["text"]};'
        f'letter-spacing:0.02em;word-break:break-word;">{inline(text, theme)}</p>'
    )


def render_quote(lines, theme=THEME):
    """引用：左侧 3px 竖线（略深，有质感），无背景"""
    inner = '<br>'.join(inline(l, theme) for l in lines)
    return (
        f'<section style="margin:24px 0;padding:4px 0 4px 16px;'
        f'border-left:3px solid {theme["line_dark"]};">'
        f'<p style="margin:0;font-size:14px;line-height:1.8;color:{theme["quote_text"]};">'
        f'{inner}</p></section>'
    )


def render_image(alt, src, theme=THEME):
    caption = ''
    if alt and alt not in ('图片', 'image', 'img'):
        caption = (
            f'<p style="margin:12px 0 0 0;text-align:center;font-size:13px;'
            f'color:{theme["muted"]};letter-spacing:0.05em;line-height:1.6;">{esc(alt)}</p>'
        )
    return (
        f'<section style="margin:28px 0;text-align:center;">'
        f'<img src="{src}" alt="{esc(alt)}" '
        f'style="max-width:100%;height:auto;border:1px solid {theme["line"]};'
        f'border-radius:0;display:block;margin:0 auto;">'
        f'{caption}</section>'
    )


def render_ul(items, theme=THEME):
    lis = ''.join(
        f'<li style="margin-bottom:10px;font-size:{theme["font_size"]};'
        f'line-height:{theme["line_height"]};color:{theme["text"]};">{inline(i, theme)}</li>'
        for i in items)
    return (
        f'<ul style="margin:0 0 {theme["para_gap"]} 0;padding-left:22px;">{lis}</ul>'
    )


def render_ol(items, theme=THEME):
    lis = ''.join(
        f'<li style="margin-bottom:10px;font-size:{theme["font_size"]};'
        f'line-height:{theme["line_height"]};color:{theme["text"]};">{inline(i, theme)}</li>'
        for i in items)
    return (
        f'<ol style="margin:0 0 {theme["para_gap"]} 0;padding-left:22px;">{lis}</ol>'
    )


def render_code_block(code, theme=THEME):
    """代码块：浅灰底 + 左侧细线，与白底文章协调"""
    return (
        f'<pre style="margin:24px 0;padding:14px 16px;background:{theme["code_bg"]};'
        f'border-left:2px solid {theme["line_dark"]};border-radius:0;overflow-x:auto;">'
        f'<code style="font-size:13px;line-height:1.7;color:#333333;'
        f'font-family:Menlo,Consolas,monospace;white-space:pre;">{esc(code)}</code></pre>'
    )


def render_hr(theme=THEME):
    """分隔：居中 60px 短横线（比满宽细线更精致）"""
    return (
        f'<section style="margin:38px 0;text-align:center;">'
        f'{rule("60px", "1px", theme["line_dark"], "0 auto", align="center")}'
        f'</section>'
    )


def render_tail(text, theme=THEME):
    """文尾互动区：上方发丝线 + 居中浅灰（收束感）"""
    return (
        f'<section style="margin:40px 0 6px 0;padding-top:24px;'
        f'border-top:1px solid {theme["line"]};text-align:center;">'
        f'<p style="margin:0;font-size:14px;line-height:1.9;color:{theme["muted"]};'
        f'letter-spacing:0.02em;">{inline(text, theme)}</p>'
        f'</section>'
    )


def render_signoff(text, theme=THEME):
    """落款：居中浅灰"""
    return (
        f'<p style="margin:0 0 6px 0;text-align:center;font-size:14px;'
        f'line-height:1.9;color:{theme["muted"]};letter-spacing:0.04em;">'
        f'{inline(text, theme)}</p>'
    )


# ============ 主解析 ============

def convert(md_text, theme=THEME, image_map=None):
    """返回 (html_body, meta, images)"""
    image_map = image_map or {}
    lines = md_text.split('\n')
    out = []
    meta = {'title': None, 'serial': None}
    images = []

    i = 0
    h2_count = 0          # 章节序号（01 / 02 …）
    first_para_done = False   # 导语段只处理第一段
    para_buf = []
    quote_buf = []
    ul_buf = []
    ol_buf = []

    def flush_para():
        nonlocal para_buf, first_para_done
        if not para_buf:
            return
        text = ' '.join(para_buf).strip()
        para_buf = []
        if not text:
            return
        if SERIAL_RE.match(text):
            meta['serial'] = int(SERIAL_RE.match(text).group(1))
            out.append(render_serial(text, theme))
        elif GOLDEN_RE.match(text):
            out.append(render_golden(text, theme))
        elif TAIL_RE.match(text):
            out.append(render_tail(text, theme))
        elif SIGN_RE.match(text):
            out.append(render_signoff(text, theme))
        else:
            if not first_para_done:
                out.append(render_lead(text, theme))   # 开篇第一段 = 导语
                first_para_done = True
            else:
                out.append(render_p(text, theme))

    def flush_quote():
        nonlocal quote_buf
        if quote_buf:
            out.append(render_quote(quote_buf, theme))
            quote_buf = []

    def flush_lists():
        nonlocal ul_buf, ol_buf
        if ul_buf:
            out.append(render_ul(ul_buf, theme))
            ul_buf = []
        if ol_buf:
            out.append(render_ol(ol_buf, theme))
            ol_buf = []

    def flush_all():
        flush_para()
        flush_quote()
        flush_lists()

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        # 代码围栏
        if stripped.startswith('```') or stripped.startswith('~~~'):
            flush_all()
            fence = stripped[:3]
            i += 1
            code_lines = []
            while i < len(lines) and not lines[i].strip().startswith(fence):
                code_lines.append(lines[i])
                i += 1
            i += 1
            out.append(render_code_block('\n'.join(code_lines), theme))
            continue

        # 空行
        if not stripped:
            flush_all()
            i += 1
            continue

        # 一级标题 -> 文章标题（不进正文）
        if stripped.startswith('# '):
            flush_all()
            if meta['title'] is None:
                meta['title'] = stripped[2:].strip()
            i += 1
            continue

        # 小标题
        if stripped.startswith('## '):
            flush_all()
            h2_count += 1
            out.append(render_h2(stripped[3:].strip(), theme, h2_count))
            i += 1
            continue
        if stripped.startswith('### '):
            flush_all()
            out.append(render_h3(stripped[4:].strip(), theme))
            i += 1
            continue

        # 分隔线
        if re.fullmatch(r'(-{3,}|\*{3,}|_{3,})', stripped):
            flush_all()
            out.append(render_hr(theme))
            i += 1
            continue

        # 引用块
        if stripped.startswith('>'):
            flush_para()
            flush_lists()
            quote_buf.append(re.sub(r'^>\s?', '', stripped))
            i += 1
            continue

        # 图片（独占一行）
        m = IMAGE_RE.match(line)
        if m:
            flush_all()
            alt, src = m.group(1), m.group(2)
            if src in image_map:
                src = image_map[src]
            elif not src.startswith('http'):
                images.append(src)
            out.append(render_image(alt, src, theme))
            i += 1
            continue

        # 无序列表
        if re.match(r'^[-*+]\s+', stripped):
            flush_para()
            flush_quote()
            if ol_buf:
                flush_lists()
            ul_buf.append(re.sub(r'^[-*+]\s+', '', stripped))
            i += 1
            continue

        # 有序列表
        m = re.match(r'^\d+[.、)]\s+(.*)$', stripped)
        if m:
            flush_para()
            flush_quote()
            if ul_buf:
                flush_lists()
            ol_buf.append(m.group(1))
            i += 1
            continue

        # 普通段落
        flush_quote()
        flush_lists()
        para_buf.append(stripped)
        i += 1

    flush_all()

    body = '\n'.join(out)
    wrapped = (
        f'<section style="font-family:{SANS_STACK};font-size:{theme["font_size"]};'
        f'line-height:{theme["line_height"]};color:{theme["text"]};'
        f'letter-spacing:0.02em;padding:0 2px;">\n{body}\n</section>'
    )
    return wrapped, meta, images


# ============ 微信正文图片上传 ============

def upload_content_image(token, path):
    """上传正文图片（非封面），返回 mmbiz URL"""
    result = subprocess.run(
        ['curl', '-s', '-X', 'POST',
         f'https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token={token}',
         '-F', f'media=@{path}'],
        capture_output=True, text=True)
    try:
        return json.loads(result.stdout).get('url')
    except Exception:
        print(f'  [warn] 上传失败 {path}: {result.stdout[:200]}', file=sys.stderr)
        return None


def get_token(appid, secret):
    out = subprocess.run(
        ['curl', '-s',
         f'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential'
         f'&appid={appid}&secret={secret}'],
        capture_output=True, text=True).stdout
    try:
        return json.loads(out).get('access_token')
    except Exception:
        print(f'  [error] 获取 token 失败: {out[:200]}', file=sys.stderr)
        return None


# ============ CLI ============

def main():
    ap = argparse.ArgumentParser(description='Markdown -> 微信公众号内联 HTML（克制 · 编辑感版）')
    ap.add_argument('markdown', help='输入的 markdown 文件')
    ap.add_argument('-o', '--output', help='输出 HTML 文件（默认 stdout）')
    ap.add_argument('--preview', help='额外输出一份本地浏览器预览（完整 HTML 文档，677px 模拟微信宽度，可直接全选复制粘贴到微信编辑器）')
    ap.add_argument('--open', action='store_true',
                    help='生成后用系统默认浏览器打开预览（macOS open / Linux xdg-open），方便直接全选复制')
    ap.add_argument('--image-map', help='本地图片路径 -> mmbiz URL 的 JSON 映射文件')
    ap.add_argument('--upload-images', action='store_true',
                    help='自动上传本地正文图片到微信（需 WECHAT_APPID/WECHAT_SECRET 环境变量）')
    ap.add_argument('--list-images', action='store_true', help='只列出待上传的本地图片')
    ap.add_argument('--title', help='覆盖文章标题')
    ap.add_argument('--theme-color', help='覆盖强调色，如 #1a1a1a（默认近黑）')
    args = ap.parse_args()

    theme = dict(THEME)
    if args.theme_color:
        theme['primary'] = args.theme_color
        theme['heading'] = args.theme_color

    with open(args.markdown, encoding='utf-8') as f:
        md_text = f.read()

    image_map = {}
    if args.image_map:
        with open(args.image_map, encoding='utf-8') as f:
            image_map = json.load(f)

    body, meta, images = convert(md_text, theme, image_map)

    # 去重保序
    seen = set()
    images = [p for p in images if not (p in seen or seen.add(p))]

    if args.list_images:
        for p in images:
            print(p)
        return 0

    if images and args.upload_images:
        appid = os.environ.get('WECHAT_APPID')
        secret = os.environ.get('WECHAT_SECRET')
        if not (appid and secret):
            print('[error] 上传图片需要 WECHAT_APPID / WECHAT_SECRET 环境变量', file=sys.stderr)
            return 1
        token = get_token(appid, secret)
        if not token:
            return 1
        base = os.path.dirname(os.path.abspath(args.markdown))
        for p in images:
            full = p if os.path.isabs(p) else os.path.join(base, p)
            if not os.path.exists(full):
                print(f'  [warn] 图片不存在，跳过: {full}', file=sys.stderr)
                continue
            url = upload_content_image(token, full)
            if url:
                image_map[p] = url
                print(f'  [ok] {os.path.basename(p)} -> {url}', file=sys.stderr)
            else:
                return 1
        body, meta, images_left = convert(md_text, theme, image_map)
        images = images_left

    title = args.title or meta.get('title') or ''
    title_bytes = len(title.encode('utf-8'))

    if args.preview:
        with open(args.preview, 'w', encoding='utf-8') as f:
            f.write(PREVIEW_TPL.format(title=esc(title), body=body))
        print(f'[ok] 预览已生成: {os.path.abspath(args.preview)}', file=sys.stderr)
        print('[手动粘贴] 浏览器打开预览 → Cmd/Ctrl+A 全选 → Cmd/Ctrl+C 复制 → '
              '粘贴到微信公众号编辑器正文区', file=sys.stderr)
        if args.open:
            opener = 'open' if sys.platform == 'darwin' else 'xdg-open'
            subprocess.run([opener, os.path.abspath(args.preview)])
            print('[ok] 已在默认浏览器打开', file=sys.stderr)

    result = {
        'title': title,
        'title_bytes': title_bytes,
        'serial': meta.get('serial'),
        'html': body,
        'pending_images': images,
    }

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(body)
        info = {
            'title': title,
            'title_bytes': title_bytes,
            'title_ok': title_bytes <= 64,
            'serial': meta.get('serial'),
            'output': os.path.abspath(args.output),
            'pending_images': images,
        }
        if args.preview:
            info['preview'] = os.path.abspath(args.preview)
        print(json.dumps(info, ensure_ascii=False, indent=2))
        if title_bytes > 64:
            print(f'\n[警告] 标题 {title_bytes} 字节，超过微信 64 字节上限，必须删减',
                  file=sys.stderr)
        if images:
            print(f'\n[警告] 有 {len(images)} 张本地图片未上传，微信正文只认 mmbiz.qpic.cn 域名',
                  file=sys.stderr)
    else:
        print(json.dumps(result, ensure_ascii=False))

    return 0


if __name__ == '__main__':
    sys.exit(main())
