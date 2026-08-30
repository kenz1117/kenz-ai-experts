# Brand GEO Advisor — WorkBuddy Wrapper

This directory is the **thin wrapper** that adapts the `geo-brand-audit` expert to
**WorkBuddy**. The actual methodology, scripts and report template live in the
repository's `skill/` directory (the platform-agnostic core). This directory only
contains WorkBuddy-specific shell files:

- `.codebuddy-plugin/plugin.json` — expert manifest (skills points to `./skill`)
- `agents/geo-brand-audit.md` — expert persona & interaction workflow (including the rule: *missing inputs must be confirmed via AskUserQuestion*)
- `avatars/expert.jpg` — expert card avatar
- `assemble.sh` — assembles the core into a self-contained, installable package

## Capabilities

- **Evidence-driven** — every score is tagged L1 Verified / L2 Search Hit / L3 Inferred, with an evidence coverage ratio
- **Six-dimension scoring** — RETRIEVABILITY 25% / AUTHORITY 20% / CONTENT_ASSETS 15% / STRUCTURE_MARKUP 15% / SENTIMENT 15% / COMPETITIVE 10%
- **Tiered collection** — quick / standard / deep
- **Competitor co-occurrence** — competitors emerge from real co-occurrence, not from guesswork
- **Multi-source cross-analysis** (optional Stage 5) — aligns real social sentiment and hot-search signals against retrieval assets; outputs Narrative Gap / Three-Source Visibility Matrix / Three-Channel Crisis Alert / Multi-dimensional Competitor Union
- **Interactive** — asks before assuming, whenever brand / category / tier / competitors / previous JSON are missing
- **Deliverables** — HTML report deck + Markdown execution plan

> **We do not produce numbers like "AI mention rate: 62%."**
> That is AI simulating AI: unverifiable, irreproducible, and impossible to re-validate
> after optimization. Scores here rest on traceable public evidence. AI simulation is
> kept as an appendix only, outputs a range plus confidence, and never enters the score.
>
> Likewise, cross-analysis consumes **only really collected** social and hot-search data.
> When data is missing, the metric is `null` and the report says "not collected" — never
> backfilled with an AI estimate. "Not collected" and "collected, confirmed zero" are
> rendered differently, because they are different things.

## Offline regression

After changing scripts or the report template, verify nothing broke — no live API needed:

```bash
cd skill && node scripts/smoke-test.js
```

Covers 5 groups / 39 assertions: schema validation, cross-analysis with and without
Stage 5, HTML + Markdown rendering, and degraded rendering. See `skill/output/samples/README.md`.

## Install (from source)

```bash
# 1) Assemble a self-contained package (the skill/ core is copied in as ./skill)
bash platforms/workbuddy/assemble.sh
# Output: platforms/workbuddy/dist/geo-brand-audit/

# 2) Copy into the experts directory and register
cp -R platforms/workbuddy/dist/geo-brand-audit \
  ~/.workbuddy/plugins/marketplaces/my-experts/plugins/
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/register_expert.py \
  ~/.workbuddy/plugins/marketplaces/my-experts/plugins/geo-brand-audit
```

## Cross-platform adaptation

The expert is designed as **one core, multiple thin wrappers**:

| Platform | How to place | Tool names to adapt |
| --- | --- | --- |
| **WorkBuddy** | This wrapper + `skill/` core | Native `AskUserQuestion` / `WebSearch` / `WebFetch` |
| **Claude Code / Codex** | Drop `skill/` into `.claude/skills/` | Already has those tools — near-zero changes |
| **OpenClaw / QClaw / Hermes** | Drop `skill/` into the platform's skills dir (`SKILL.md` already carries `metadata.clawdbot`) | Rename `AskUserQuestion` / `WebSearch` / `WebFetch` per platform |
| **Cursor / custom agents** | Use `skill/` as system prompt + run `node skill/scripts/*.js` | Swap in your own ask/search tools |

Scoring logic, evidence grading and the report template need **no changes** — only tool
names and the `$SKILL_DIR` path.

---

## Coverage limits (read before citing)

What this expert **cannot** see. Knowing the boundary tells you which conclusions can be
cited directly and which need another layer of verification.

| Limit | Detail | Impact |
| --- | --- | --- |
| **China platforms only** | Retrieval, social and hot-search are all China-based | No overseas view; not for outbound brands |
| **No traditional SEO data** | No Baidu/Bing index, keyword rank, backlinks or crawl coverage | Not an SEO diagnosis |
| **AI simulation is appendix-only** | `SIMULATION` outputs a range + confidence and **never enters the score** | Must not be cited as measured data |
| **Retrieval is a proxy for AI visibility** | AI answers rely heavily on retrieval (RAG), but a proxy is not the thing itself | Correlated, not identical |
| **Hot search is signal-level** | Provides heat and list presence only, not fine-grained sentiment | For deep negative detection, go back to social samples |
| **Social samples are small** | Agent-retrieved, typically 10–30 items | Negative rate is noisy; report flags samples under 10 |
| **Sentiment is agent-judged** | Based on title/body wording, not platform data | Judgment evidence is kept in the sample table for line-by-line review |
| **Volume/heat indices are relative** | Log-normalized against manually set ceilings | For cross-sectional comparison only, not absolute market share |
| **Benchmarks may be absent** | Dimension baselines only accept measured / accumulated / configured sources | When unavailable, **no baseline is drawn** rather than estimated |

> Cross-analysis thresholds and normalization ceilings live at the top of
> `skill/scripts/lib/cross_analysis.js` (`NORM` / `TH` / `QUAD_THRESHOLD_BY_SOURCE`)
> and can be tuned per category — but the methodology must be stated alongside the report.

---

## Known issues

| # | Symptom | Status / workaround |
|:--:|---|---|
| 1 | **Headless screenshot fails on Chinese paths** — `file://` URLs containing CJK return `400 Param Incorrect` | Copy the HTML to an ASCII path (e.g. `/tmp/preview.html`) first |
| 2 | **`chrome-headless-shell --screenshot` captures the viewport, not the full page** | Use `puppeteer-core` with `executablePath` pointing at the local chrome-headless-shell, `setViewport` to `scrollHeight`, then `fullPage: true` |
| 3 | **Windows (Git Bash) paths** — paths passed to `python.exe` must be `C:/Users/...`, not `/c/Users/...` | Otherwise Windows Python resolves them as `c:\c\Users\...` |
| 4 | **Sandbox proxy blocks git push hosts** — CONNECT tunnels to `github.com` / `ssh.github.com` return 200 then go black; only `api.github.com` is allowed | Push via the GitHub Contents API file-by-file; normal networks are unaffected |
| 5 | **Rendered content is absent from static HTML** — the report injects data and renders client-side; `#app` starts empty | Assert at the data layer; open the generated HTML in a browser to see it |
| 6 | **macOS `sips` has no `--compress` flag** | Use `sips -z 512 512 in --out out.jpg -s format jpeg` (omit compress) |
| 7 | **`cross` is derived at merge time** — recompute it after manually editing `stages` | Otherwise stale cross-analysis persists; `merge-stages.js` gets the order right |

---

## Packaging

```bash
# Assemble first, then package the self-contained bundle
python3 ~/.workbuddy/plugins/cache/workbuddy-builtin/skill-expert-manager/0.1.0/scripts/package_expert.py \
  platforms/workbuddy/dist/geo-brand-audit ./dist/
```
