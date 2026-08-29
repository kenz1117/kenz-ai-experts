#!/usr/bin/env node
'use strict';

/**
 * geo-brand-audit — Markdown 执行版构建
 *
 * 用法:
 *   node build-markdown.js <audited-json> [output-md]
 *
 * 产出面向内部执行：完整证据表（含 URL 与采集时间）、逐维失分诊断、
 * 可分工的行动清单、采集日志与失败项。
 *
 * 退出码:
 *   0 — 成功
 *   2 — 文件缺失 / JSON 解析失败
 */

var fs = require('fs');
var path = require('path');
var S = require('./lib/schema.js');

var args = process.argv.slice(2);
if (args.length < 1) {
  console.error('用法: node build-markdown.js <audited-json> [output-md]');
  process.exit(2);
}

var jsonPath = path.resolve(args[0]);
var outputPath = args[1]
  ? path.resolve(args[1])
  : jsonPath.replace(/\.json$/i, '') + '-execution.md';

if (!fs.existsSync(jsonPath)) { console.error('JSON 不存在: ' + jsonPath); process.exit(2); }

var report;
try {
  report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  console.error('JSON 解析失败: ' + e.message);
  process.exit(2);
}
if (!report.stages) {
  console.error('不是合并后的审计数据（缺少 stages）。请先运行 merge-stages.js。');
  process.exit(2);
}

var st = report.stages;
var L = [];
function w(s) { L.push(s === undefined || s === null ? '' : s); }
function blank() { L.push(''); }

// ── 小工具 ──
function cell(s) {
  return String(s === undefined || s === null ? '—' : s)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim() || '—';
}
function pct(x) { return (Math.round(Number(x || 0) * 1000) / 10).toFixed(1) + '%'; }
function signed(n) {
  if (n === null || n === undefined) return '—';
  return (n > 0 ? '+' : '') + n;
}
function dateOf(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function bar(score) {
  var n = S.clamp(Math.round(score / 5), 0, 20);
  return '█'.repeat(n) + '░'.repeat(20 - n);
}
function covTag(cov) {
  var c = S.normalizeCoverage(cov);
  return 'L1 ' + Math.round(c.L1 * 100) + '% / L2 ' + Math.round(c.L2 * 100) + '% / L3 ' + Math.round(c.L3 * 100) + '%';
}
function evTag(ev) {
  if (!ev || !ev.level) return '—';
  var meta = S.EVIDENCE_LEVELS[ev.level];
  var link = (ev.sources && ev.sources[0] && ev.sources[0].url)
    ? ' [' + (meta ? meta.label : ev.level) + '](' + ev.sources[0].url + ')'
    : ' ' + (meta ? meta.label : ev.level);
  return '`' + ev.level + '`' + link;
}

// ── 头部 ──
var cov = (report.evidence && report.evidence.coverage) || { L1: 0, L2: 0, L3: 0 };
var conf = (report.evidence && report.evidence.confidence) || S.confidenceOf(cov);
var total = report.score ? report.score.totalScore : 0;
var lv = S.levelOf(total);

w('# ' + report.meta.brand + ' · ' + report.meta.category + ' — GEO 可见度审计（执行版）');
blank();
w('> 由 **Hyreal FDE** · geo-brand-audit v' + (report.version || '1.0.0') + ' 生成　·　本文件面向内部执行：含完整证据表与可分工的行动项。对外汇报请使用 HTML 版。');
blank();
w('| 项目 | 值 |');
w('|---|---|');
w('| 品牌 | ' + cell(report.meta.brand) + ' |');
w('| 品类 | ' + cell(report.meta.category) + ' |');
w('| 官网 | ' + (report.meta.website ? '<' + report.meta.website + '>' : '未提供') + ' |');
w('| 采集档位 | ' + cell(report.meta.depthLabel || report.meta.depth) + ' |');
w('| 生成时间 | ' + cell(dateOf(report.generatedAt)) + ' |');
w('| **总分** | **' + total + ' / 100（' + lv.label + '）** |');
w('| 证据覆盖 | L1 ' + pct(cov.L1) + ' · L2 ' + pct(cov.L2) + ' · L3 ' + pct(cov.L3) + ' |');
w('| 结论置信度 | ' + conf.score + ' / 100（' + conf.label + '） |');
blank();
w('> **证据等级**：`L1` 已验证（抓到页面正文并确认）· `L2` 检索命中（搜索结果摘要含品牌）· `L3` 推演估计（无外部证据，AI 推理）。');
w('> 本报告不把 L3 当作事实陈述；凡标注 L3 的数字均为估计值，不可直接对外引用。');
blank();

// ── 基线对比 ──
if (report.baseline) {
  var b = report.baseline;
  w('## 优化前后对比');
  blank();
  w('基线报告：`' + b.file + '`' + (b.fileDir ? '（' + b.fileDir + '）' : '') +
    (b.generatedAt ? '，生成于 ' + dateOf(b.generatedAt) : ''));
  blank();
  if (b.delta !== null && b.delta !== undefined) {
    w('**总分变化：' + b.totalScore + ' → ' + total + '（' + signed(b.delta) + '）**');
  } else {
    w('基线报告无总分，无法对比。');
  }
  blank();
  w('| 维度 | 权重 | 基线 | 当前 | 变化 |');
  w('|---|:--:|:--:|:--:|:--:|');
  (b.dimensions || []).forEach(function (d) {
    w('| ' + cell(d.name) + ' | ' + Math.round(d.weight * 100) + '% | ' +
      cell(d.baseline) + ' | ' + cell(d.current) + ' | ' + signed(d.delta) + ' |');
  });
  blank();
  if (b.coverageShift) {
    w('证据质量变化：L1 占比 ' + pct(b.coverageShift.baseline.L1) + ' → ' + pct(b.coverageShift.current.L1) +
      '（' + signed(b.coverageShift.l1Delta) + ' 个百分点）');
    blank();
  }
}

// ── 一页纸摘要 ──
var ov = st.OVERVIEW || {};

// 执行摘要（置顶，金字塔原理：结论先行）
if (ov.executiveSummary) {
  var ES = ov.executiveSummary;
  w('## 执行摘要（Executive Summary）');
  blank();
  if (ES.headline) { w('> **' + ES.headline + '**'); blank(); }
  if (Array.isArray(ES.judgments) && ES.judgments.length) {
    ES.judgments.forEach(function (j, i) {
      w('**0' + (i + 1) + '.** ' + j.text);
      if (j.evidence) {
        var lvl = j.evidence.level || '';
        var url = (j.evidence.sources && j.evidence.sources[0] && j.evidence.sources[0].url) || '';
        w('  · `' + lvl + '` ' + (url ? '[' + lvl + '](' + url + ')' : ''));
      }
      blank();
    });
  }
  if (ES.biggestOpportunity) {
    var OP = ES.biggestOpportunity;
    w('**最大机会点 · ' + cell(OP.dimension) + '**');
    w('');
    w(OP.text);
    if (OP.expectedGain) { w(''); w('**预期 +' + OP.expectedGain + ' 分**'); }
    blank();
  }
}

// 分数解构（瀑布）
if (report.waterfall && report.waterfall.items && report.waterfall.items.length) {
  var WF = report.waterfall;
  w('## 分数解构');
  blank();
  w('从满分 100 按权重逐项扣除，落到总分 **' + WF.end + '**。');
  blank();
  w('| 步骤 | 扣分 | 剩余 |');
  w('|---|---:|---:|');
  w('| 满分 | — | 100.0 |');
  var wcur = 100;
  WF.items.forEach(function (it) {
    wcur -= it.loss;
    w('| − ' + cell(it.name) + ' | −' + it.loss.toFixed(1) + ' | ' + wcur.toFixed(1) + ' |');
  });
  w('| **总分** | — | **' + WF.end + '** |');
  blank();
  if (WF.benchmark !== null && WF.benchmark !== undefined) {
    w('> 行业基准 ' + WF.benchmark + '（整体口径，非分维度基准）');
    blank();
  }
}

w('## 摘要');
blank();
if (ov.summary) w(ov.summary);
blank();
if (Array.isArray(ov.highlights) && ov.highlights.length) {
  w('**核心优势**');
  blank();
  ov.highlights.forEach(function (h) { w('- ' + h); });
  blank();
}
if (Array.isArray(ov.risks) && ov.risks.length) {
  w('**主要风险**');
  blank();
  ov.risks.forEach(function (h) { w('- ' + h); });
  blank();
}

// ── 六维诊断 ──
w('## 六维诊断');
blank();
w('| 维度 | 权重 | 得分 | 进度 | 证据覆盖 |');
w('|---|:--:|:--:|---|:--:|');
(report.score.dimensions || []).forEach(function (d) {
  w('| ' + cell(d.name) + ' | ' + Math.round(d.weight * 100) + '% | **' + d.score + '** | `' +
    bar(d.score) + '` | ' + covTag(d.evidenceCoverage) + ' |');
});
blank();

(report.score.dimensions || []).forEach(function (d, i) {
  w('### ' + (i + 1) + '. ' + d.name + ' — ' + d.score + ' 分' + (d.missing ? ' ⚠️（数据缺失，默认值）' : ''));
  blank();
  w('权重 ' + Math.round(d.weight * 100) + '% · 证据覆盖 ' + covTag(d.evidenceCoverage));
  blank();
  if (d.comment) w(d.comment);
  blank();
  if (Array.isArray(d.findings) && d.findings.length) {
    d.findings.forEach(function (f) {
      var icon = f.type === 'critical' ? '🔴' : (f.type === 'warning' ? '🟠' : '🟢');
      var tail = f.evidence ? ' — ' + evTag(f.evidence) : '';
      w('- ' + icon + ' ' + f.text + tail);
    });
    blank();
  }
});

// ── 竞品集 ──
if (st.COMPETITORS) {
  w('## 竞品集');
  blank();
  if (st.COMPETITORS.method) w('产生方式：' + st.COMPETITORS.method);
  blank();
  if (Array.isArray(st.COMPETITORS.list) && st.COMPETITORS.list.length) {
    w('| 竞品 | 来源 | 共现次数 | 威胁 |');
    w('|---|:--:|:--:|:--:|');
    st.COMPETITORS.list.forEach(function (c) {
      w('| ' + cell(c.name) + ' | ' + (c.origin === 'user' ? '用户指定' : '检索共现') + ' | ' +
        cell(c.cooccurCount) + ' | ' + cell(c.threatLevel) + ' |');
    });
    blank();
  }
}

// ── 竞争位势 ──
if (st.COMPETITIVE && Array.isArray(st.COMPETITIVE.shareOfVoice)) {
  w('## 声量份额');
  blank();
  w('本品牌排名：第 **' + cell(st.COMPETITIVE.brandRank) + '** 位');
  blank();
  w('| 品牌 | 提及数 | 份额 |');
  w('|---|:--:|:--:|');
  st.COMPETITIVE.shareOfVoice.forEach(function (s) {
    var isBrand = s.name === report.meta.brand;
    w('| ' + (isBrand ? '**' + cell(s.name) + '**' : cell(s.name)) + ' | ' + cell(s.mentions) + ' | ' + pct(s.share) + ' |');
  });
  blank();
}

// ── 检索可见度明细 ──
if (st.VISIBILITY && Array.isArray(st.VISIBILITY.queryResults)) {
  w('## 检索可见度明细');
  blank();
  if (st.VISIBILITY.summary) {
    w('命中率 **' + pct(st.VISIBILITY.summary.hitRate) + '**（' + cell(st.VISIBILITY.summary.hitCount) +
      ' / ' + cell(st.VISIBILITY.summary.totalQueries) + ' 条查询出现品牌）');
    blank();
  }
  w('| 查询词 | 品牌出现 | 最佳排名 | 证据 |');
  w('|---|:--:|:--:|---|');
  st.VISIBILITY.queryResults.forEach(function (q) {
    w('| ' + cell(q.query) + ' | ' + (q.brandAppeared ? '✅' : '❌') + ' | ' +
      cell(q.bestRank) + ' | ' + evTag(q.evidence) + ' |');
  });
  blank();
}

// ── 内容资产 ──
if (st.ASSET && Array.isArray(st.ASSET.coverage)) {
  w('## 内容资产覆盖');
  blank();
  if (st.ASSET.officialSite) {
    w('官网：' + (st.ASSET.officialSite.exists
      ? (st.ASSET.officialSite.url ? '<' + st.ASSET.officialSite.url + '>' : '存在') +
        ' · 建设评分 ' + cell(st.ASSET.officialSite.score)
      : '❌ 未找到官网'));
    blank();
  }
  w('| 内容类型 | 数量 | 证据 |');
  w('|---|:--:|---|');
  st.ASSET.coverage.forEach(function (c) {
    w('| ' + cell(c.type) + ' | ' + cell(c.count) + ' | ' + evTag(c.evidence) + ' |');
  });
  blank();
  if (st.ASSET.freshness && st.ASSET.freshness.note) w('新鲜度：' + st.ASSET.freshness.note);
  blank();
}

// ── 结构化检测 ──
if (st.STRUCTURE && Array.isArray(st.STRUCTURE.checks)) {
  w('## 结构化与标记检测');
  blank();
  if (st.STRUCTURE.fetchNote) w('> ⚠️ ' + st.STRUCTURE.fetchNote);
  blank();
  w('| 检测项 | 结果 | 证据 |');
  w('|---|:--:|---|');
  st.STRUCTURE.checks.forEach(function (c) {
    w('| ' + cell(c.item) + ' | ' + (c.pass ? '✅ 通过' : '❌ 未通过') + ' | ' + evTag(c.evidence) + ' |');
  });
  blank();
}

// ── 权威背书 ──
if (st.AUTHORITY && Array.isArray(st.AUTHORITY.items)) {
  var TIER = {
    encyclopedia: '百科词条', knowledge_panel: '知识面板', media: '权威媒体',
    ranking: '行业榜单', community: '社区/UGC'
  };
  w('## 权威与背书');
  blank();
  w('| 层级 | 来源 | 标题 | 证据 |');
  w('|---|---|---|---|');
  st.AUTHORITY.items.forEach(function (it) {
    var title = it.url ? '[' + cell(it.title) + '](' + it.url + ')' : cell(it.title);
    w('| ' + cell(TIER[it.tier] || it.tier) + ' | ' + cell(it.source) + ' | ' + title + ' | ' + evTag(it.evidence) + ' |');
  });
  blank();
}

// ── 舆情 ──
if (st.SENTIMENT) {
  w('## 舆情健康');
  blank();
  var dist = st.SENTIMENT.distribution || {};
  w('正面 ' + cell(dist.positive) + '% · 中性 ' + cell(dist.neutral) + '% · 负面 ' + cell(dist.negative) + '%');
  blank();
  w('负面率 **' + pct(st.SENTIMENT.negativeRate) + '** · 风险等级 **' + cell(st.SENTIMENT.riskLevel) +
    '** · 趋势 **' + cell(st.SENTIMENT.trend) + '**');
  blank();
  if (Array.isArray(st.SENTIMENT.issues) && st.SENTIMENT.issues.length) {
    w('| 议题 | 严重度 | 说明 | 证据 |');
    w('|---|:--:|---|---|');
    st.SENTIMENT.issues.forEach(function (i) {
      w('| ' + cell(i.topic) + ' | ' + cell(i.severity) + ' | ' + cell(i.detail || i.description) + ' | ' + evTag(i.evidence) + ' |');
    });
    blank();
  }
}

// ── 根因分析（咨询式） ──
if (st.SCORE && Array.isArray(st.SCORE.dimensions)) {
  var rcList = st.SCORE.dimensions.filter(function (d) { return d.rootCause; })
                                   .sort(function (a, b) { return a.score - b.score; });
  if (rcList.length) {
    w('## 根因分析');
    blank();
    w('> 按得分升序，只分析失分项。根因必须指向可改变的动作，否则属于编造。');
    blank();
    rcList.forEach(function (d) {
      var rc = d.rootCause;
      w('### ' + cell(d.name) + ' · ' + d.score + ' 分');
      blank();
      w('- **现象**　' + cell(rc.symptom));
      w('- **直接原因**　' + cell(rc.directCause));
      w('- **根本原因**　' + cell(rc.rootCause));
      if (rc.evidence) {
        w('- **证据**　' + evTag(rc.evidence));
      }
      blank();
    });
  }
}

// ── 行动清单（2×2 矩阵） ──
if (st.ACTION && Array.isArray(st.ACTION.actions) && st.ACTION.actions.length) {
  var AC = st.ACTION.actions;
  var pr = S.prioritizeActions(AC);
  w('## 行动优先级（2×2 矩阵）');
  blank();
  w('**象限口径**：影响力按本报告预期提分均值 **' + pr.meanGain + '** 分二分（相对口径）；可行性按工时二分（heavy 归入低可行性）。');
  blank();
  Object.keys(pr.quadrants).forEach(function (k) {
    var items = pr.quadrants[k];
    if (!items.length) return;
    var q = S.QUADRANTS[k];
    w('### ' + q.label + '　<span style="color:' + q.color + '">■</span>');
    w('');
    w('> ' + q.hint);
    blank();
    w('| 行动 | 提分 | 工时 |');
    w('|---|---:|---|');
    items.forEach(function (it) {
      var d = it.action;
      w('| ' + cell(d.title) + ' | +' + it.gain + ' | ' + cell({ quick_win: '低（1-2 周）', moderate: '中（1-3 月）', heavy: '高（3-6 月）' }[d.effort] || cell(d.effort)) + ' |');
    });
    blank();
  });
  // 完整清单（按 P0/P1/P2）
  w('### 完整清单（按 P0/P1/P2）');
  blank();
  w('| 优先级 | 维度 | 行动 | 提分 | 工时 |');
  w('|---|---|---|---:|---|');
  AC.slice().sort(function (a, b) { return (a.priority || '').localeCompare(b.priority || ''); }).forEach(function (a) {
    var spec = S.dimensionByCode(a.dimension);
    w('| ' + cell(a.priority) + ' | ' + cell(spec ? spec.name : a.dimension) + ' | ' + cell(a.title) + ' | +' + cell(a.expectedGain) + ' | ' + cell({ quick_win: '低', moderate: '中', heavy: '高' }[a.effort] || a.effort) + ' |');
  });
  blank();
}

// ── AI 提及推演附录 ──
if (st.SIMULATION && st.SIMULATION.enabled) {
  w('## 附录：AI 提及推演（不参与总分）');
  blank();
  w('> ' + (st.SIMULATION.note || '以下为 AI 推演结果，不代表实测数据。'));
  blank();
  if (Array.isArray(st.SIMULATION.platforms) && st.SIMULATION.platforms.length) {
    w('| 平台 | 推演提及率区间 | 置信度 |');
    w('|---|:--:|:--:|');
    st.SIMULATION.platforms.forEach(function (p) {
      var r = Array.isArray(p.range) && p.range.length === 2
        ? (pct(p.range[0]) + ' – ' + pct(p.range[1]))
        : '—';
      w('| ' + cell(p.platform) + ' | ' + r + ' | ' + cell(p.confidence) + ' |');
    });
    blank();
  }
  w('**该附录的数据全部为 L3 推演估计，不可对外引用，也不用于计算本报告总分。**');
  blank();
}

// ── 采集日志 ──
w('## 采集日志');
blank();
w('| 项 | 值 |');
w('|---|---|');
w('| 采集档位 | ' + cell(report.meta.depthLabel || report.meta.depth) + ' |');
w('| 已完成阶段 | ' + cell((report.stagesCompleted || report.meta.stagesCompleted || []).join(', ')) + ' |');
w('| 未生成阶段文件 | ' + cell((report.meta.stagesMissing || []).join(', ') || '无') + ' |');
w('| 兜底维度 | ' + cell((report.meta.filledDimensions || []).join(', ') || '无') + ' |');
w('| 证据覆盖 | L1 ' + pct(cov.L1) + ' · L2 ' + pct(cov.L2) + ' · L3 ' + pct(cov.L3) + ' |');
blank();

if (cov.L1 < 0.3) {
  w('> ⚠️ **L1 覆盖率仅 ' + pct(cov.L1) + '**，低于 30%。本报告结论偏依赖检索命中与推演。');
  w('> 如需对外正式交付，建议使用 `--depth deep` 重跑以提升已验证证据占比。');
  blank();
}

w('---');
blank();
w('*由 **Hyreal FDE** · geo-brand-audit v' + (report.version || '1.0.0') + ' 生成 · ' + dateOf(report.generatedAt) + '*');

fs.writeFileSync(outputPath, L.join('\n'), 'utf8');
console.log('✓ Markdown 执行版已生成: ' + outputPath);
console.log('  ' + (fs.statSync(outputPath).size / 1024).toFixed(1) + ' KB  ·  ' + L.length + ' 行');
process.exit(0);
