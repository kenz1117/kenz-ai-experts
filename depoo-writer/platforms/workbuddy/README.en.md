# Depoo · WeChat Official Account Writing Expert (WorkBuddy)

An **interactive** writing agent for WeChat official accounts. It asks before it assumes — writing depth, first-hand material, and delivery method are all confirmed with you, never decided silently.

> This directory is the WorkBuddy thin wrapper. The platform-agnostic core — methodology, scripts, style profile — lives in [`../../skill/`](../../skill) and is shared by every platform build.

---

## Persona

An upperclassman a few steps ahead of the reader: "the pitfalls I hit and the paths I verified", not "here's what you should do".

Differentiation triangle (woven into the prose, never listed up front):

- **Business** — 15 years of frontline work across HR, advertising, and new-media operations
- **AI-native** — Author of the *China AI Field Deployment (FDE) Industry Whitepaper*; senior AI lecturer
- **Growth** — Certified Douyin Local Services lecturer; full funnel across livestream, short video, and paid traffic

---

## How it works

### It asks first

| Item | Required? |
|---|---|
| Depth D1 (800–1500) / D2 (1500–2500) / **D3 (2500–4000, default)** | **Always** |
| First-hand material (have you actually used it?) | Required for hands-on reviews |
| Type A review / B workflow / C enterprise / D opinion | When unclear |
| Target reader | Suggested for enterprise pieces |
| Delivery (render HTML for pasting / push to draft box) | Before finalising |

**Hard rule**: no hands-on impressions for tools never used.

### Five-layer self-check (L1–L5)

1. **L1** Hard rules — banned phrasing, fact-checking, title ≤ 64 bytes
2. **L2** Voice consistency — opening triad, one-sentence paragraphs, bolded 「」 punchlines
3. **L3** Content quality — diachronic/synchronic analysis, plain-language translation, actionable, no鸡汤
4. **L4** Human presence
5. **L5** AI-flavor check — 25 patterns (24 generic + 1 house rule), ships at ≥ 42/50

> The house rule, **E25 "generic 'user' piling and preachy tone"**, came from real editing: at most 2 occurrences of 「用户」 per article, never twice in one sentence, and zero 「咱们 / 别觉得 / 你总得」. See `skill/references/ai-flavor-check.md`.

---

## Delivery

### Path A (default): render HTML, paste manually

```bash
python3 skill/scripts/md_to_wechat_html.py article.md \
    -o wechat.html --preview preview.html --open
```

Open the preview → select all → copy → paste into the WeChat editor. **No API permission needed**, works on unverified accounts.

### Path B (optional): push to the draft box

Requires a **verified** account (unverified ones get `48001` from `draft/add`). An external action — only runs when you explicitly ask.

---

## Typography: restrained, editorial

The restrained floor never moves: **pure white, no background blocks, no rounded corners, no shadows**. Polish comes from detail, not decoration.

| Element | Treatment |
|---|---|
| Typeface | **Serif / sans pairing** — serif for headings and punchlines, sans for body |
| Opening counter | Serif + wide tracking + centred hairline below |
| Lead paragraph | First paragraph at 17px, slightly darker |
| Section heading | Serif number (01/02) + title + 28×2 rule beneath |
| Punchline | Serif 18px bracketed by hairlines (pull-quote style) |
| Blockquote | 3px left rule, no background |
| Image | 1px hairline border |
| Footer | Hairline above + centred grey |
| Divider | Centred 60×1 short rule |

Every style is inlined (WeChat strips `<style>`), and the markup uses WeChat-native `section + p`.

---

## Install

```bash
bash assemble.sh                  # builds a self-contained bundle, runs self-check
cp -R dist/depoo-writer ~/.workbuddy/plugins/marketplaces/my-experts/plugins/
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/register_expert.py \
  ~/.workbuddy/plugins/marketplaces/my-experts/plugins/depoo-writer
```

## Changelog

- **v1.1.0** — Typography engine reworked as "restrained, editorial" (serif pairing / section numbers / lead paragraph / pull-quote punchlines / footer close); delivery now defaults to rendered HTML for manual pasting; AI-flavor check gains rule 25 plus a one-command scanner; fixed the template-level bug where 「迪谱学长」 was shortened to 「迪谱」 in self-reference
- v1.0.0 — Initial release
