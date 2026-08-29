#!/usr/bin/env node
'use strict';

/**
 * 分维度行业基准 — 三级基准源解析
 *
 * 设计前提：绝不让 AI 凭空"估算行业平均水平"。
 * 那等于把编造从数据层搬到基准层，而且更隐蔽——读者会以为有据可依。
 *
 * 三级来源，优先级从高到低：
 *   measured    — 竞品同口径实测（同品类、同一次采集、每个维度挂证据）
 *   accumulated — 本地累积：同品类历史审计的维度分均值（需 ≥ MIN_SAMPLES 条）
 *   preset      — 用户在 references/benchmarks.json 填的真实行业数据
 *
 * 都取不到就不画线（返回 null），留白而不是编一个数字。
 */

var fs = require('fs');
var path = require('path');
var schema = require('./schema.js');

// 累积基准启用所需的最小样本量
var MIN_SAMPLES = 3;

var SOURCE_META = {
  measured:    { label: '竞品实测',   desc: '同品类竞品同口径实测',       dash: '',        opacity: 0.75, width: 1.6 },
  accumulated: { label: '累积基准',   desc: '同品类历史审计均值',         dash: '5 4',     opacity: 0.7,  width: 1.4 },
  preset:      { label: '行业配置',   desc: '用户配置的行业基准',         dash: '2 3',     opacity: 0.6,  width: 1.4 }
};

// ─────────────────────────────────────────────────────────────
// 1. 竞品同口径实测
// ─────────────────────────────────────────────────────────────

/**
 * 从 COMPETITIVE.dimensionBenchmarks 解析。
 * 每条必须有 evidence，否则丢弃该维度（无证据 = 编造）。
 */
function fromMeasured(competitive) {
  if (!competitive || !competitive.dimensionBenchmarks) return null;
  var db = competitive.dimensionBenchmarks;
  if (!Array.isArray(db.dimensions) || !db.dimensions.length) return null;

  var scores = {}, kept = 0;
  db.dimensions.forEach(function (d) {
    if (!d || !schema.dimensionByCode(d.code)) return;
    if (typeof d.score !== 'number' || d.score < 0 || d.score > 100) return;
    // 强制：无证据的竞品打分直接丢弃
    if (!d.evidence || !d.evidence.level) return;
    scores[d.code] = d.score;
    kept++;
  });

  // 至少 2 个维度才够画一条有意义的基准线
  if (kept < 2) return null;

  return {
    source: 'measured',
    label: SOURCE_META.measured.label,
    desc: SOURCE_META.measured.desc,
    sampleSize: Number(db.sampleSize) || 0,
    scores: scores,
    knownCount: kept,
    note: db.method || ''
  };
}

// ─────────────────────────────────────────────────────────────
// 2. 本地累积
// ─────────────────────────────────────────────────────────────

function benchmarkStorePath(baseDir, category) {
  return path.join(baseDir, '.benchmarks', safeName(category) + '.jsonl');
}

function safeName(s) {
  return String(s || 'unknown').replace(/[\/\\:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function readStore(file) {
  if (!fs.existsSync(file)) return [];
  var out = [];
  String(fs.readFileSync(file, 'utf8')).split('\n').forEach(function (line) {
    line = line.trim();
    if (!line) return;
    try {
      var o = JSON.parse(line);
      if (o && o.dimensions) out.push(o);
    } catch (e) { /* 跳过损坏行 */ }
  });
  return out;
}

/**
 * 写入一次审计的维度分到累积库。
 * @param {string} baseDir 输出目录
 * @param {string} category 品类
 * @param {string} brand 品牌
 * @param {Array} dimensions 六维数组
 * @returns {{ok:boolean, file:string, samples:number}}
 */
function record(baseDir, category, brand, dimensions) {
  var file = benchmarkStorePath(baseDir, category);
  var dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return { ok: false, file: file, samples: 0 }; }
  }
  var scores = {};
  (dimensions || []).forEach(function (d) {
    if (d && d.code && typeof d.score === 'number' && !d.missing) scores[d.code] = d.score;
  });
  if (!Object.keys(scores).length) return { ok: false, file: file, samples: 0 };

  var row = { at: new Date().toISOString(), brand: brand, category: category, dimensions: scores };

  // upsert：同一品牌只保留最新一条，避免重复审计把库撑大、也避免单品牌刷权重
  var entries = readStore(file).filter(function (e) {
    return (e.brand || 'unknown') !== (brand || 'unknown');
  });
  entries.push(row);

  try {
    fs.writeFileSync(file, entries.map(function (e) {
      return JSON.stringify(e);
    }).join('\n') + '\n', 'utf8');
  } catch (e) {
    return { ok: false, file: file, samples: 0 };
  }
  return { ok: true, file: file, samples: entries.length };
}

function fromAccumulated(baseDir, category, excludeBrand) {
  var entries = readStore(benchmarkStorePath(baseDir, category));
  // 同品牌只取最新一条，避免单一品牌刷权重
  var byBrand = {};
  entries.forEach(function (e) {
    var b = e.brand || 'unknown';
    if (excludeBrand && b === excludeBrand) return;
    if (!byBrand[b] || String(e.at) > String(byBrand[b].at)) byBrand[b] = e;
  });
  var uniq = Object.keys(byBrand).map(function (k) { return byBrand[k]; });

  if (uniq.length < MIN_SAMPLES) {
    return { tooFew: true, samples: uniq.length, needed: MIN_SAMPLES };
  }

  var sum = {}, cnt = {};
  uniq.forEach(function (e) {
    Object.keys(e.dimensions || {}).forEach(function (code) {
      var v = Number(e.dimensions[code]);
      if (isNaN(v)) return;
      sum[code] = (sum[code] || 0) + v;
      cnt[code] = (cnt[code] || 0) + 1;
    });
  });

  var scores = {}, kept = 0;
  Object.keys(sum).forEach(function (code) {
    if (!schema.dimensionByCode(code)) return;
    if (cnt[code] < MIN_SAMPLES) return; // 单维度样本不足也不给
    scores[code] = Math.round(sum[code] / cnt[code]);
    kept++;
  });

  if (kept < 2) return { tooFew: true, samples: uniq.length, needed: MIN_SAMPLES };

  return {
    source: 'accumulated',
    label: SOURCE_META.accumulated.label,
    desc: SOURCE_META.accumulated.desc,
    sampleSize: uniq.length,
    scores: scores,
    knownCount: kept,
    note: '同品类 ' + uniq.length + ' 个品牌的维度分均值'
  };
}

// ─────────────────────────────────────────────────────────────
// 3. 用户预设
// ─────────────────────────────────────────────────────────────

function fromPreset(presetFile, category) {
  if (!presetFile || !fs.existsSync(presetFile)) return null;
  var cfg;
  try { cfg = JSON.parse(fs.readFileSync(presetFile, 'utf8')); }
  catch (e) { return null; }

  var cats = cfg.categories || {};
  var hit = cats[category];
  if (!hit) {
    // 尝试模糊匹配（去空格、大小写）
    var key = Object.keys(cats).filter(function (k) {
      return k && category && (k === category ||
        String(k).replace(/\s/g, '') === String(category).replace(/\s/g, ''));
    })[0];
    if (!key) return null;
    hit = cats[key];
  }

  var dims = hit.dimensions || hit;
  var scores = {}, kept = 0;
  Object.keys(dims).forEach(function (code) {
    if (!schema.dimensionByCode(code)) return;
    var v = Number(dims[code]);
    if (isNaN(v) || v < 0 || v > 100) return;
    scores[code] = v;
    kept++;
  });

  if (kept < 2) return null;

  return {
    source: 'preset',
    label: hit.source || SOURCE_META.preset.label,
    desc: hit.sourceNote || SOURCE_META.preset.desc,
    sampleSize: Number(hit.sampleSize) || 0,
    scores: scores,
    knownCount: kept,
    note: hit.note || ''
  };
}

// ─────────────────────────────────────────────────────────────
// 统一入口
// ─────────────────────────────────────────────────────────────

/**
 * 解析本次审计可用的分维度基准。
 *
 * @param {object} opts
 *   baseDir      输出目录（累积库位置）
 *   category     品类
 *   brand        本次品牌（累积时排除自身）
 *   competitive  stages.COMPETITIVE
 *   presetFile   用户配置路径
 *   overall      SCORE.industryBenchmark（兜底用）
 * @returns {null | {
 *   source, label, desc, sampleSize, knownCount, note,
 *   scores: {code:number},
 *   fallbackOverall: number|null,
 *   rejected: Array  // 被丢弃的来源及原因，用于透明披露
 * }}
 */
function resolve(opts) {
  opts = opts || {};
  var rejected = [];

  var m = fromMeasured(opts.competitive);
  if (m) {
    m.fallbackOverall = (typeof opts.overall === 'number') ? opts.overall : null;
    m.rejected = rejected;
    return m;
  }
  rejected.push({ source: 'measured', reason: '无竞品同口径实测数据（或缺少证据）' });

  var a = fromAccumulated(opts.baseDir, opts.category, opts.brand);
  if (a && !a.tooFew) {
    a.fallbackOverall = (typeof opts.overall === 'number') ? opts.overall : null;
    a.rejected = rejected;
    return a;
  }
  rejected.push({
    source: 'accumulated',
    reason: a && a.samples > 0
      ? '样本不足（' + a.samples + '/' + MIN_SAMPLES + ' 个同品类品牌）'
      : '尚无同品类历史审计记录'
  });

  var p = fromPreset(opts.presetFile, opts.category);
  if (p) {
    p.fallbackOverall = (typeof opts.overall === 'number') ? opts.overall : null;
    p.rejected = rejected;
    return p;
  }
  rejected.push({ source: 'preset', reason: '未配置该品类的行业基准' });

  return null;
}

module.exports = {
  MIN_SAMPLES: MIN_SAMPLES,
  SOURCE_META: SOURCE_META,
  resolve: resolve,
  record: record,
  readStore: readStore,
  benchmarkStorePath: benchmarkStorePath,
  fromMeasured: fromMeasured,
  fromAccumulated: fromAccumulated,
  fromPreset: fromPreset
};
