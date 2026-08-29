#!/usr/bin/env node
'use strict';

/**
 * geo-brand-audit — 阶段合并
 *
 * 用法:
 *   node merge-stages.js <output-dir> [options]
 *
 * 选项:
 *   --brand <name>        品牌名（缺省从 stage1.PROFILE 读取）
 *   --product <type>      品类（缺省从 stage1.PROFILE 读取）
 *   --depth <quick|standard|deep>   采集档位，写入 meta
 *   --baseline <file>     上次合并报告路径，出 delta
 *   --force               有 error 也继续合并
 *   --out <file>          指定输出文件
 *
 * 退出码:
 *   0 — 成功
 *   1 — 校验未通过（未加 --force）
 *   2 — 文件缺失或解析失败
 */

var fs = require('fs');
var path = require('path');
var S = require('./lib/schema.js');
var BM = require('./lib/benchmark.js');

var VERSION = '1.1.0';

// ── 参数 ──
var args = process.argv.slice(2);
var opts = { dir: null, brand: null, product: null, depth: 'standard', baseline: null,
             force: false, out: null, noRecord: false, preset: null };

while (args.length) {
  var a = args.shift();
  if (a === '--brand') opts.brand = args.shift();
  else if (a === '--product') opts.product = args.shift();
  else if (a === '--depth') opts.depth = args.shift();
  else if (a === '--baseline') opts.baseline = args.shift();
  else if (a === '--out') opts.out = args.shift();
  else if (a === '--force') opts.force = true;
  else if (a === '--no-record') opts.noRecord = true;
  else if (a === '--preset') opts.preset = args.shift();
  else if (!opts.dir) opts.dir = a;
}

if (!opts.dir) {
  console.error('用法: node merge-stages.js <output-dir> [--brand X] [--product Y] [--depth standard] [--baseline f] [--no-record] [--force]');
  process.exit(2);
}

var dir = path.resolve(opts.dir);
if (!fs.existsSync(dir)) {
  console.error('目录不存在: ' + dir);
  process.exit(2);
}

// ── 读取阶段文件 ──
var stages = {};
var missing = [];
var parseErrors = [];

S.STAGE_FILES.forEach(function (sf) {
  var f = path.join(dir, sf.file);
  if (!fs.existsSync(f)) { missing.push(sf.file); return; }
  var obj;
  try {
    obj = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    parseErrors.push(sf.file + ' — ' + e.message);
    return;
  }
  sf.codes.forEach(function (code) {
    if (obj[code]) stages[code] = obj[code];
  });
});

if (parseErrors.length) {
  console.error('JSON 解析失败:');
  parseErrors.forEach(function (m) { console.error('  ' + m); });
  process.exit(2);
}

if (!stages.PROFILE) {
  console.error('缺少阶段1（stage1.json / PROFILE），无法合并。');
  process.exit(2);
}

// ── 校验 ──
var allErrors = [];
var allWarnings = [];

S.STAGE_FILES.forEach(function (sf) {
  sf.codes.forEach(function (code) {
    if (!stages[code]) return;
    var r = S.validateStage(code, stages[code]);
    r.errors.forEach(function (e) { allErrors.push({ file: sf.file, path: code + '.' + e.path, msg: e.msg }); });
    r.warnings.forEach(function (w) { allWarnings.push({ file: sf.file, path: code + '.' + w.path, msg: w.msg }); });
  });
});

if (allWarnings.length) {
  console.log('警告 ' + allWarnings.length + ' 处:');
  allWarnings.slice(0, 20).forEach(function (w) { console.log('  [W] ' + w.path + ' — ' + w.msg); });
}

if (allErrors.length) {
  console.error('错误 ' + allErrors.length + ' 处:');
  allErrors.slice(0, 40).forEach(function (e) { console.error('  [E] ' + e.path + ' — ' + e.msg); });
  if (!opts.force) {
    console.error('\n合并中止。修复后重试，或加 --force 强制合并（缺失维度将用 fallback 填充）。');
    process.exit(1);
  }
  console.log('（--force：继续合并）');
}

// ── 基础信息 ──
var brand = opts.brand || stages.PROFILE.brand || 'unknown';
var product = opts.product || stages.PROFILE.category || 'unknown';

// ── 补齐维度 ──
var rawDims = (stages.SCORE && Array.isArray(stages.SCORE.dimensions)) ? stages.SCORE.dimensions.slice() : [];
var dimMap = {};
rawDims.forEach(function (d) { if (d && d.code) dimMap[d.code] = d; });

var filled = [];
var dimensions = S.DIMENSIONS.map(function (spec) {
  var d = dimMap[spec.code];
  if (!d) {
    filled.push(spec.code);
    return {
      code: spec.code,
      name: spec.name,
      weight: spec.weight,
      score: spec.fallback,
      comment: '⚠️ 数据缺失，使用保守默认值 ' + spec.fallback + ' 分（该维度未完成采集）',
      evidenceCoverage: { L1: 0, L2: 0, L3: 1 },
      missing: true
    };
  }
  var out = {
    code: spec.code,
    name: spec.name || d.name,
    weight: spec.weight,
    score: S.clamp(d.score, 0, 100),
    comment: d.comment || '',
    evidenceCoverage: S.normalizeCoverage(d.evidenceCoverage),
    findings: Array.isArray(d.findings) ? d.findings : []
  };
  // 根因链透传（有则保留，无则略过）
  if (d.rootCause) out.rootCause = d.rootCause;
  return out;
});

if (filled.length) {
  console.log('补齐缺失维度（fallback）: ' + filled.join(', '));
}

var totalScore = S.recomputeTotal(dimensions);
var lv = S.levelOf(totalScore);

// ── 组装报告 ──
var report = {
  version: VERSION,
  generatedAt: new Date().toISOString(),
  meta: {
    brand: brand,
    category: product,
    website: stages.PROFILE.website || null,
    depth: S.DEPTHS[opts.depth] ? opts.depth : 'standard',
    depthLabel: (S.DEPTHS[opts.depth] || S.DEPTHS.standard).label,
    stagesCompleted: Object.keys(stages),
    stagesMissing: missing,
    filledDimensions: filled
  },
  stages: stages,
  score: {
    totalScore: totalScore,
    level: lv.label,
    levelColor: lv.color,
    dimensions: dimensions
  }
};

// ── 证据覆盖率与置信度 ──
var coverage = S.rollupCoverage(report);
report.evidence = {
  coverage: coverage,
  confidence: S.confidenceOf(coverage)
};

// ── 报告级一致性校验 ──
var rr = S.validateReport(report);
if (rr.warnings.length) {
  rr.warnings.forEach(function (x) { console.log('  [W] ' + x.path + ' — ' + x.msg); });
}
if (rr.errors.length) {
  console.error('报告级错误 ' + rr.errors.length + ' 处:');
  rr.errors.forEach(function (x) { console.error('  [E] ' + x.path + ' — ' + x.msg); });
  if (!opts.force) {
    console.error('\n合并中止。修复后重试，或加 --force 强制合并。');
    process.exit(1);
  }
}

// ── 分维度行业基准（三级来源，取不到就不画线） ──
var PRESET_FILE = opts.preset
  ? path.resolve(opts.preset)
  : path.join(__dirname, '..', 'references', 'benchmarks.json');

var bench = BM.resolve({
  baseDir: dir,
  category: product,
  brand: brand,
  competitive: stages.COMPETITIVE,
  presetFile: PRESET_FILE,
  overall: (stages.SCORE && typeof stages.SCORE.industryBenchmark === 'number')
    ? stages.SCORE.industryBenchmark : null
});

if (bench) {
  report.benchmark = {
    source: bench.source,
    label: bench.label,
    desc: bench.desc,
    sampleSize: bench.sampleSize,
    knownCount: bench.knownCount,
    note: bench.note,
    scores: bench.scores,
    rejected: bench.rejected || []
  };
  console.log('分维度基准: ' + bench.label + '（' + bench.knownCount + '/6 维' +
    (bench.sampleSize ? ' · 样本 ' + bench.sampleSize : '') + '）');
} else {
  console.log('分维度基准: 无可用来源，不画基准线（可在 references/benchmarks.json 配置，或累积 ' +
    BM.MIN_SAMPLES + ' 个同品类品牌后自动生成）');
}

// 累积样本（供未来形成 accumulated 基准）
if (!opts.noRecord) {
  var rec = BM.record(dir, product, brand, dimensions);
  if (rec.ok) console.log('累积样本已记录: ' + path.relative(process.cwd(), rec.file) +
    '（该品类累计 ' + rec.samples + ' 条' + (rec.samples < BM.MIN_SAMPLES ? '，需 ' + BM.MIN_SAMPLES + ' 条才启用累积基准' : '') + '）');
}

// ── 咨询式增强：分数瀑布 + 优先级矩阵 ──
report.waterfall = S.computeWaterfall(
  dimensions,
  totalScore,
  (stages.SCORE && stages.SCORE.industryBenchmark !== undefined) ? stages.SCORE.industryBenchmark : null
);
report.priorities = S.prioritizeActions(stages.ACTION && stages.ACTION.actions);

// ── 多源交叉分析层（可选阶段5：SOCIAL / HOTSEARCH）──
// 阶段5 缺失时不做任何估算，只标记 available:false，报告中显示「未采集」。
var CA = require('./lib/cross_analysis.js');
var cross = CA.crossAnalyze(report);
report.cross = cross;

if (cross.available) {
  var g = cross.narrativeGap;
  console.log('交叉分析: 叙事鸿沟 ' +
    (g.gap === null ? '—（数据不足）' : (g.gap > 0 ? '+' : '') + g.gap + ' ' + g.verdictLabel) +
    ' · 三源 ' + cross.threeSource.quadrantLabel +
    ' · 危机 ' + cross.crisis.score + '（' + cross.crisis.levelLabel + '）' +
    ' · 竞品并集 ' + cross.competitorUnion.length + ' 个');
} else {
  console.log('交叉分析: 未采集阶段5（SOCIAL / HOTSEARCH），跳过（不做估算）');
}

// ── OVERVIEW 兜底 ──
if (!stages.OVERVIEW) {
  report.stages.OVERVIEW = {
    score: totalScore,
    confidence: report.evidence.confidence.score,
    summary: '⚠️ 综述未生成（阶段4 未完成）。以下为按六维权重自动汇总的结果。',
    highlights: [],
    risks: filled.length ? ['部分维度未完成采集：' + filled.join('、')] : []
  };
}

// ── 基线对比 ──
if (opts.baseline) {
  var bp = path.resolve(opts.baseline);
  if (!fs.existsSync(bp)) {
    console.error('基线文件不存在: ' + bp);
    process.exit(2);
  }
  var base;
  try { base = JSON.parse(fs.readFileSync(bp, 'utf8')); }
  catch (e) { console.error('基线 JSON 解析失败: ' + e.message); process.exit(2); }

  var baseDims = {};
  if (base.score && Array.isArray(base.score.dimensions)) {
    base.score.dimensions.forEach(function (d) { baseDims[d.code] = d.score; });
  } else if (base.stages && base.stages.SCORE && Array.isArray(base.stages.SCORE.dimensions)) {
    base.stages.SCORE.dimensions.forEach(function (d) { baseDims[d.code] = d.score; });
  }

  var baseTotal = base.score ? base.score.totalScore
    : (base.stages && base.stages.SCORE ? base.stages.SCORE.totalScore : null);

  var dimDeltas = dimensions.map(function (d) {
    var b = baseDims[d.code];
    return {
      code: d.code,
      name: d.name,
      weight: d.weight,
      current: d.score,
      baseline: (b === undefined ? null : b),
      delta: (b === undefined ? null : Math.round((d.score - b) * 10) / 10)
    };
  });

  report.baseline = {
    file: path.basename(bp),
    fileDir: path.basename(path.dirname(bp)),
    generatedAt: base.generatedAt || null,
    totalScore: baseTotal,
    delta: (baseTotal === null || baseTotal === undefined) ? null : Math.round((totalScore - baseTotal) * 10) / 10,
    dimensions: dimDeltas,
    coverageShift: base.evidence && base.evidence.coverage
      ? {
          baseline: base.evidence.coverage,
          current: coverage,
          l1Delta: Math.round((coverage.L1 - (base.evidence.coverage.L1 || 0)) * 1000) / 10
        }
      : null
  };
  console.log('基线对比: ' + (report.baseline.delta === null ? '无基线总分' :
    (report.baseline.delta >= 0 ? '+' : '') + report.baseline.delta + ' 分'));
}

// ── 写出 ──
function safeName(s) {
  return String(s).replace(/[\/\\:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

var outFile = opts.out
  ? path.resolve(opts.out)
  : path.join(dir, safeName(brand) + '-' + safeName(product) + '-audit.json');

fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

// ── 进度文件（断点续跑）──
var progress = {
  updatedAt: new Date().toISOString(),
  brand: brand,
  category: product,
  depth: report.meta.depth,
  completedStages: Object.keys(stages),
  pendingStages: missing,
  merged: outFile,
  baseline: opts.baseline ? path.relative(process.cwd(), path.resolve(opts.baseline)) : null
};
fs.writeFileSync(path.join(dir, '.progress.json'), JSON.stringify(progress, null, 2), 'utf8');

console.log('');
console.log('✓ 合并完成: ' + outFile);
console.log('  总分 ' + totalScore + '（' + lv.label + '）  ' +
  '证据 L1 ' + Math.round(coverage.L1 * 100) + '% / L2 ' + Math.round(coverage.L2 * 100) +
  '% / L3 ' + Math.round(coverage.L3 * 100) + '%  置信度' + report.evidence.confidence.score + '(' +
  report.evidence.confidence.label + ')');
if (missing.length) console.log('  ⚠️ 未生成阶段: ' + missing.join(', '));
process.exit(0);
