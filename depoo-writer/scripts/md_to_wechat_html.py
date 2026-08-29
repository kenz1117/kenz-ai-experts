#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Markdown -> 微信公众号内联样式 HTML

微信会过滤 <style> 标签，所有样式必须内联。本脚本输出可直接用于
/cgi-bin/draft/add 接口 content 字段的 HTML。

用法:
    python3 md_to_wechat_html.py article.md -o article.html
    python3 md_to_wechat_html.py article.md -o article.html --upload-images
    python3 md_to_wechat_html.py article.md -o article.html --image-map map.json
    python3 md_to_wechat_html.py article.md --list-images

image-map.json 格式:
    {"/abs/local/img.png": "https://mmbiz.qpic.cn/..."}
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
    "primary": "#0f6e8c",        # 主色：小标题左边框、金句、链接
    "text": "#3f3f3f",           # 正文
    "heading": "#1a1a1a",        # 小标题
    "muted": "#8c8c8c",          # 弱化文字（开场篇数、图注）
    "quote_bg": "#f7f8fa",       # 引用块背景
    "quote_text": "#5c5c5c",
    "quote_border": "#d8dde3",
    "font_size": "15px",
    "line_height": "1.75",
    "para_gap": "18px",
    "serial_bg": "#f4f6f7",      # 「第 N 篇原创」条背景
}

FONT_STACK = ("-apple-system, BlinkMacSystemFont, 'Helvetica Neue', "
              "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif")


def esc(s):
    return html.escape(s, quote=False)


# ============ 行内解析 ============

def inline(text, theme=THEME):
    """处理 **加粗**、*斜体*、`代码`、[文字](链接)"""
    # 先占位代码，避免内部被解析
    codes = []

    def stash_code(m):
        codes.append(m.group(1))
        return f"\x00CODE{len(codes) - 1}\x00"

    text = re.sub(r'`([^`]+)`', stash_code, text)

    text = esc(text)

    # 加粗（含金句里的「」）
    text = re.sub(r'\*\*(.+?)\*\*',
                  lambda m: f'<strong style="color:{theme["heading"]};font-weight:600;">{m.group(1)}</strong>',
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

    # 还原代码
    def restore_code(m):
        idx = int(m.group(1))
        return (f'<code style="background:#f2f4f5;padding:2px 5px;border-radius:3px;'
                f'font-size:13px;color:#c7254e;font-family:Menlo,Consolas,monospace;">'
                f'{esc(codes[idx])}</code>')

    text = re.sub(r'\x00CODE(\d+)\x00', restore_code, text)
    return text


# ============ 块级渲染 ============

SERIAL_RE = re.compile(r'^\s*这是迪谱学长的第\s*(\d+)\s*篇原创[！!]?\s*$')
GOLDEN_RE = re.compile(r'^\*\*「(.+)」\*\*$')
IMAGE_RE = re.compile(r'^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$')


def render_serial(matched_text, theme=THEME):
    n = SERIAL_RE.match(matched_text).group(1)
    return (
        f'<section style="margin:0 0 22px 0;padding:10px 14px;background:{theme["serial_bg"]};'
        f'border-radius:6px;text-align:center;">'
        f'<span style="font-size:14px;color:{theme["muted"]};letter-spacing:0.05em;">'
        f'这是迪谱学长的第 {n} 篇原创</span>'
        f'</section>'
    )


def render_golden(text, theme=THEME):
    """本号金句：加粗 + 「」+ 独立成段"""
    inner = GOLDEN_RE.match(text).group(1)
    return (
        f'<section style="margin:26px 0;padding:16px 18px;'
        f'background:{theme["quote_bg"]};border-left:3px solid {theme["primary"]};border-radius:0 6px 6px 0;">'
        f'<p style="margin:0;font-size:16px;line-height:1.7;color:{theme["primary"]};'
        f'font-weight:600;letter-spacing:0.03em;">「{inline(inner, theme)}」</p>'
        f'</section>'
    )


def render_h2(text, theme=THEME):
    return (
        f'<h2 style="margin:34px 0 16px 0;padding-left:11px;font-size:17px;line-height:1.5;'
        f'color:{theme["heading"]};font-weight:600;border-left:3px solid {theme["primary"]};'
        f'letter-spacing:0.02em;">{inline(text, theme)}</h2>'
    )


def render_h3(text, theme=THEME):
    return (
        f'<h3 style="margin:26px 0 12px 0;font-size:15px;line-height:1.5;'
        f'color:{theme["heading"]};font-weight:600;">{inline(text, theme)}</h3>'
    )


def render_p(text, theme=THEME):
    return (
        f'<p style="margin:0 0 {theme["para_gap"]} 0;font-size:{theme["font_size"]};'
        f'line-height:{theme["line_height"]};color:{theme["text"]};'
        f'letter-spacing:0.03em;word-break:break-word;">{inline(text, theme)}</p>'
    )


def render_quote(lines, theme=THEME):
    inner = '<br>'.join(inline(l, theme) for l in lines)
    return (
        f'<blockquote style="margin:20px 0;padding:12px 15px;background:{theme["quote_bg"]};'
        f'border-left:3px solid {theme["quote_border"]};border-radius:0 4px 4px 0;">'
        f'<p style="margin:0;font-size:14px;line-height:1.7;color:{theme["quote_text"]};">'
        f'{inner}</p></blockquote>'
    )


def render_image(alt, src, theme=THEME):
    caption = ''
    if alt and alt not in ('图片', 'image', 'img'):
        caption = (
            f'<p style="margin:8px 0 0 0;text-align:center;font-size:13px;'
            f'color:{theme["muted"]};">{esc(alt)}</p>'
        )
    return (
        f'<section style="margin:22px 0;text-align:center;">'
        f'<img src="{src}" alt="{esc(alt)}" '
        f'style="max-width:100%;height:auto;border-radius:6px;display:block;margin:0 auto;">'
        f'{caption}</section>'
    )


def render_ul(items, theme=THEME):
    lis = ''.join(
        f'<li style="margin-bottom:8px;font-size:{theme["font_size"]};'
        f'line-height:{theme["line_height"]};color:{theme["text"]};">{inline(i, theme)}</li>'
        for i in items)
    return (
        f'<ul style="margin:0 0 {theme["para_gap"]} 0;padding-left:22px;">{lis}</ul>'
    )


def render_ol(items, theme=THEME):
    lis = ''.join(
        f'<li style="margin-bottom:8px;font-size:{theme["font_size"]};'
        f'line-height:{theme["line_height"]};color:{theme["text"]};">{inline(i, theme)}</li>'
        for i in items)
    return (
        f'<ol style="margin:0 0 {theme["para_gap"]} 0;padding-left:22px;">{lis}</ol>'
    )


def render_code_block(code, theme=THEME):
    return (
        f'<pre style="margin:20px 0;padding:14px 16px;background:#282c34;border-radius:6px;'
        f'overflow-x:auto;"><code style="font-size:13px;line-height:1.6;color:#abb2bf;'
        f'font-family:Menlo,Consolas,monospace;white-space:pre;">{esc(code)}</code></pre>'
    )


def render_hr(theme=THEME):
    return (f'<hr style="margin:30px 0;border:none;border-top:1px solid #ececec;">')


# ============ 主解析 ============

def convert(md_text, theme=THEME, image_map=None):
    """返回 (html_body, meta, images)"""
    image_map = image_map or {}
    lines = md_text.split('\n')
    out = []
    meta = {'title': None, 'serial': None}
    images = []

    i = 0
    para_buf = []
    quote_buf = []
    ul_buf = []
    ol_buf = []

    def flush_para():
        nonlocal para_buf
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
            out.append(render_h2(stripped[3:].strip(), theme))
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
        f'<section style="font-family:{FONT_STACK};font-size:{theme["font_size"]};'
        f'line-height:{theme["line_height"]};color:{theme["text"]};'
        f'letter-spacing:0.03em;padding:2px 4px;">\n{body}\n</section>'
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
    ap = argparse.ArgumentParser(description='Markdown -> 微信公众号内联 HTML')
    ap.add_argument('markdown', help='输入的 markdown 文件')
    ap.add_argument('-o', '--output', help='输出 HTML 文件（默认 stdout）')
    ap.add_argument('--image-map', help='本地图片路径 -> mmbiz URL 的 JSON 映射文件')
    ap.add_argument('--upload-images', action='store_true',
                    help='自动上传本地正文图片到微信（需 WECHAT_APPID/WECHAT_SECRET 环境变量）')
    ap.add_argument('--list-images', action='store_true', help='只列出待上传的本地图片')
    ap.add_argument('--title', help='覆盖文章标题')
    ap.add_argument('--theme-color', help='覆盖主色，如 #0f6e8c')
    args = ap.parse_args()

    theme = dict(THEME)
    if args.theme_color:
        theme['primary'] = args.theme_color

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
        # 用新映射重新转换
        body, meta, images_left = convert(md_text, theme, image_map)
        images = images_left

    title = args.title or meta.get('title') or ''
    title_bytes = len(title.encode('utf-8'))

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
