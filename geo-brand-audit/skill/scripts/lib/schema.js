#!/usr/bin/env node
'use strict';

/**
 * geo-brand-audit — 统一数据结构（单一事实源）
 *
 * 本文件是整套 skill 的契约：Prompts 生成的 JSON、validate.js 的校验规则、
 * merge-stages.js 的合并逻辑、两个 build 脚本的渲染逻辑，全部以此为准。
 * 改数据结构只需改这里。
 */

// ─────────────────────────────────────────────────────────────
// 证据等级
// ─────────────────────────────────────────────────────────────

var EVIDENCE_LEVELS = {
  L1: { code: 'L1', label: '已验证', short: '实', color: '#059669', desc: '抓到页面正文并确认提及，可溯源' },
  L2: { code: 'L2', label: '检索命中', short: '检', color: '#2563eb', desc: '搜索结果标题/摘要命中品牌' },
  L3: { code: 'L3', label: '推演估计', short: '估', color: '#94a3b8', desc: '无外部证据，AI 基于上下文推理' }
};

var EVIDENCE_ORDER = ['L1', 'L2', 'L3'];

// ─────────────────────────────────────────────────────────────
// 六维评分模型
// ─────────────────────────────────────────────────────────────

var DIMENSIONS = [
  { code: 'RETRIEVABILITY',   name: '检索可见度',   weight: 0.25, fallback: 40, stage: 'VISIBILITY',  axis: '品牌在真实搜索中被找到的能力' },
  { code: 'AUTHORITY',        name: '权威与背书',   weight: 0.20, fallback: 35, stage: 'AUTHORITY',   axis: '第三方为品牌背书的分量' },
  { code: 'CONTENT_ASSETS',   name: '内容资产',     weight: 0.15, fallback: 40, stage: 'ASSET',       axis: '自有内容的覆盖度与新鲜度' },
  { code: 'STRUCTURE_MARKUP', name: '结构化与标记', weight: 0.15, fallback: 30, stage: 'STRUCTURE',   axis: '内容被机器解析与摘录的难易' },
  { code: 'SENTIMENT',        name: '舆情健康',     weight: 0.15, fallback: 70, stage: 'SENTIMENT',   axis: '负面议题占比与风险趋势' },
  { code: 'COMPETITIVE',      name: '竞争位势',     weight: 0.10, fallback: 50, stage: 'COMPETITIVE', axis: '相对共现竞品的声量份额' }
];

// ─────────────────────────────────────────────────────────────
// 评级
// ─────────────────────────────────────────────────────────────

var LEVELS = [
  { min: 90, label: '优秀', color: '#059669', bg: '#f0fdf4' },
  { min: 75, label: '良好', color: '#0d9488', bg: '#f0fdfa' },
  { min: 60, label: '一般', color: '#d97706', bg: '#fffbeb' },
  { min: 0,  label: '较差', color: '#dc2626', bg: '#fef2f2' }
];

// ─────────────────────────────────────────────────────────────
// 采集档位
// ─────────────────────────────────────────────────────────────

var DEPTHS = {
  quick:    { code: 'quick',    label: '快速摸底', fetch: false, topN: 5,  concurrency: 1, eta: '2-3 分钟' },
  standard: { code: 'standard', label: '标准诊断', fetch: true,  topN: 10, concurrency: 3, eta: '5-8 分钟' },
  deep:     { code: 'deep',     label: '正式报告', fetch: true,  topN: 20, concurrency: 3, eta: '15-25 分钟' }
};

// ─────────────────────────────────────────────────────────────
// 阶段划分
// ─────────────────────────────────────────────────────────────

var STAGE_FILES = [
  { n: 1, file: 'stage1.json', title: '定范围',   codes: ['PROFILE', 'COMPETITORS'], parallelWith: [] },
  { n: 2, file: 'stage2.json', title: '采资产',   codes: ['ASSET', 'STRUCTURE', 'AUTHORITY'], parallelWith: [3] },
  { n: 3, file: 'stage3.json', title: '测可见+扫舆情', codes: ['VISIBILITY', 'COMPETITIVE', 'SENTIMENT'], parallelWith: [2] },
  { n: 4, file: 'stage4.json', title: '评分与行动', codes: ['OVERVIEW', 'SCORE', 'ACTION', 'SIMULATION'], parallelWith: [] },
  // 阶段5 — 可选增强：多源真实信号（社媒舆情 + 热搜）。
  // 缺失不阻断主流水线：六维评分与行动清单不依赖它，
  // 它只驱动「交叉分析层」（叙事鸿沟 / 三源矩阵 / 危机通道）。
  { n: 5, file: 'stage5.json', title: '多源信号（可选）', codes: ['SOCIAL', 'HOTSEARCH'], parallelWith: [], optional: true }
];

var ALL_STAGE_CODES = STAGE_FILES.reduce(function (acc, s) {
  return acc.concat(s.codes);
}, []);

// 可选阶段：缺失不算错。新增数据源一律先标可选，避免破坏既有审计报告。
var OPTIONAL_STAGE_CODES = ['SIMULATION', 'SOCIAL', 'HOTSEARCH'];

var REQUIRED_STAGE_CODES = ALL_STAGE_CODES.filter(function (c) {
  return OPTIONAL_STAGE_CODES.indexOf(c) < 0;
});

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

function levelOf(score) {
  var n = Number(score) || 0;
  for (var i = 0; i < LEVELS.length; i++) {
    if (n >= LEVELS[i].min) return LEVELS[i];
  }
  return LEVELS[LEVELS.length - 1];
}

function dimensionByCode(code) {
  for (var i = 0; i < DIMENSIONS.length; i++) {
    if (DIMENSIONS[i].code === code) return DIMENSIONS[i];
  }
  return null;
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * 归一化证据覆盖率为 { L1: x, L2: y, L3: z }，三项合计 1。
 * 输入允许任意 subset 的原始计数或比例。
 */
function normalizeCoverage(raw) {
  var out = { L1: 0, L2: 0, L3: 0 };
  if (!raw || typeof raw !== 'object') return out;
  var total = 0;
  EVIDENCE_ORDER.forEach(function (k) {
    var v = Number(raw[k]);
    if (!isNaN(v) && v > 0) { out[k] = v; total += v; }
  });
  if (total <= 0) return out;
  EVIDENCE_ORDER.forEach(function (k) { out[k] = out[k] / total; });
  return out;
}

/**
 * 置信度：L1 占比越高越可信。
 * 返回 { score: 0-100, label: '高'|'中'|'低' }
 */
function confidenceOf(coverage) {
  var c = normalizeCoverage(coverage);
  var score = Math.round((c.L1 * 1 + c.L2 * 0.6 + c.L3 * 0.15) * 100);
  var label = score >= 70 ? '高' : (score >= 40 ? '中' : '低');
  return { score: score, label: label };
}

// ─────────────────────────────────────────────────────────────
// 校验规则
//
// 每条规则: { path, type, required, hint }
//   path     — 点分路径，* 表示数组通配
//   type     — string|number|boolean|object|array|evidence|enum(a|b)
//   required — 缺失是否报错
// ─────────────────────────────────────────────────────────────

var STAGE_RULES = {
  PROFILE: [
    { path: 'brand', type: 'string', required: true, hint: '品牌名称' },
    { path: 'category', type: 'string', required: true, hint: '产品/品类' },
    { path: 'website', type: 'string', required: false, hint: '官网 URL，无则 null' },
    { path: 'summary', type: 'string', required: true, hint: '品牌一句话定位' },
    { path: 'queryMatrix', type: 'array', required: true, hint: '查询词矩阵（驱动阶段3）' },
    { path: 'queryMatrix.*.intent', type: 'string', required: true },
    { path: 'queryMatrix.*.queries', type: 'array', required: true }
  ],
  COMPETITORS: [
    { path: 'list', type: 'array', required: true, hint: '竞品列表' },
    { path: 'list.*.name', type: 'string', required: true },
    { path: 'list.*.origin', type: 'enum(cooccurrence|user)', required: true, hint: 'cooccurrence=检索共现涌现 / user=用户指定' },
    { path: 'list.*.cooccurCount', type: 'number', required: false },
    { path: 'list.*.threatLevel', type: 'enum(high|medium|low)', required: true },
    { path: 'method', type: 'string', required: true, hint: '竞品集产生方式说明' },
    { path: 'evidence', type: 'evidence', required: true }
  ],
  ASSET: [
    { path: 'officialSite.url', type: 'string', required: false },
    { path: 'officialSite.exists', type: 'boolean', required: true },
    { path: 'officialSite.score', type: 'number', required: true, hint: '0-100' },
    { path: 'coverage', type: 'array', required: true, hint: '内容覆盖明细：产品页/FAQ/参数/评测/博客' },
    { path: 'coverage.*.type', type: 'string', required: true },
    { path: 'coverage.*.count', type: 'number', required: true },
    { path: 'coverage.*.evidence', type: 'evidence', required: true },
    { path: 'freshness', type: 'object', required: false },
    { path: 'evidenceCoverage', type: 'coverage', required: true }
  ],
  STRUCTURE: [
    { path: 'checks', type: 'array', required: true, hint: '结构化检测项：jsonld/table/qa/heading/meta 等' },
    { path: 'checks.*.item', type: 'string', required: true },
    { path: 'checks.*.pass', type: 'boolean', required: true },
    { path: 'checks.*.evidence', type: 'evidence', required: true },
    { path: 'fetchNote', type: 'string', required: false, hint: '抓取失败原因（curl 被拦时必填）' },
    { path: 'evidenceCoverage', type: 'coverage', required: true }
  ],
  AUTHORITY: [
    { path: 'items', type: 'array', required: true, hint: '权威背书条目' },
    { path: 'items.*.source', type: 'string', required: true },
    { path: 'items.*.title', type: 'string', required: true },
    { path: 'items.*.url', type: 'string', required: false },
    { path: 'items.*.tier', type: 'enum(encyclopedia|knowledge_panel|media|ranking|community)', required: true },
    { path: 'items.*.evidence', type: 'evidence', required: true },
    { path: 'evidenceCoverage', type: 'coverage', required: true }
  ],
  VISIBILITY: [
    { path: 'queryResults', type: 'array', required: true, hint: '每条查询词的真实检索结果' },
    { path: 'queryResults.*.query', type: 'string', required: true },
    { path: 'queryResults.*.brandAppeared', type: 'boolean', required: true },
    { path: 'queryResults.*.bestRank', type: 'number', required: false },
    { path: 'queryResults.*.evidence', type: 'evidence', required: true },
    { path: 'summary.hitRate', type: 'number', required: true, hint: '0-1，品牌出现的查询占比' },
    { path: 'evidenceCoverage', type: 'coverage', required: true }
  ],
  COMPETITIVE: [
    { path: 'shareOfVoice', type: 'array', required: true, hint: '声量份额：含本品牌与竞品' },
    { path: 'shareOfVoice.*.name', type: 'string', required: true },
    { path: 'shareOfVoice.*.mentions', type: 'number', required: true },
    { path: 'shareOfVoice.*.share', type: 'number', required: true, hint: '0-1' },
    { path: 'brandRank', type: 'number', required: true, hint: '本品牌在声量榜中的名次' },
    { path: 'evidenceCoverage', type: 'coverage', required: true },
    // 分维度行业基准（竞品同口径实测）—— 可选，但每条必须挂证据，否则等于编基准
    { path: 'dimensionBenchmarks', type: 'object', required: false, hint: '竞品同口径维度打分，用作分维度基准' },
    { path: 'dimensionBenchmarks.sampleSize', type: 'number', required: false },
    { path: 'dimensionBenchmarks.method', type: 'string', required: false },
    { path: 'dimensionBenchmarks.dimensions', type: 'array', required: false },
    { path: 'dimensionBenchmarks.dimensions.*.code', type: 'string', required: false },
    { path: 'dimensionBenchmarks.dimensions.*.score', type: 'number', required: false },
    { path: 'dimensionBenchmarks.dimensions.*.evidence', type: 'evidence', required: false }
  ],
  SENTIMENT: [
    { path: 'distribution.positive', type: 'number', required: true, hint: '0-100 整数' },
    { path: 'distribution.neutral', type: 'number', required: true },
    { path: 'distribution.negative', type: 'number', required: true },
    { path: 'negativeRate', type: 'number', required: true, hint: '0-1' },
    { path: 'riskLevel', type: 'enum(low|medium|high)', required: true },
    { path: 'trend', type: 'enum(up|stable|down)', required: true },
    { path: 'issues', type: 'array', required: true },
    { path: 'issues.*.topic', type: 'string', required: true },
    { path: 'issues.*.severity', type: 'enum(high|medium|low)', required: true },
    { path: 'issues.*.evidence', type: 'evidence', required: true },
    { path: 'evidenceCoverage', type: 'coverage', required: true }
  ],
  OVERVIEW: [
    { path: 'score', type: 'number', required: true, hint: '0-100，须与 SCORE.totalScore 一致' },
    { path: 'confidence', type: 'number', required: true, hint: '0-100，证据置信度' },
    { path: 'summary', type: 'string', required: true, hint: '100-300 字' },
    { path: 'highlights', type: 'array', required: true, hint: '2-5 条' },
    { path: 'risks', type: 'array', required: true, hint: '2-5 条' },
    // 咨询式：执行摘要（金字塔原理的结论先行层）
    { path: 'executiveSummary', type: 'object', required: true, hint: '执行摘要，报告置顶' },
    { path: 'executiveSummary.headline', type: 'string', required: true, hint: '一句话结论：最大判断，60 字内' },
    { path: 'executiveSummary.judgments', type: 'array', required: true, hint: '恰好 3 条核心判断' },
    { path: 'executiveSummary.judgments.*.text', type: 'string', required: true },
    { path: 'executiveSummary.judgments.*.evidence', type: 'evidence', required: true, hint: '每条判断必须有证据支撑' },
    { path: 'executiveSummary.biggestOpportunity', type: 'object', required: true },
    { path: 'executiveSummary.biggestOpportunity.text', type: 'string', required: true },
    { path: 'executiveSummary.biggestOpportunity.expectedGain', type: 'number', required: true },
    { path: 'executiveSummary.biggestOpportunity.dimension', type: 'string', required: true }
  ],
  SCORE: [
    { path: 'totalScore', type: 'number', required: true, hint: '0-100' },
    { path: 'industryBenchmark', type: 'number', required: false },
    { path: 'dimensions', type: 'array', required: true, hint: '必须 6 项，code 与 schema.js 一致' },
    { path: 'dimensions.*.code', type: 'string', required: true },
    { path: 'dimensions.*.score', type: 'number', required: true },
    { path: 'dimensions.*.comment', type: 'string', required: true },
    { path: 'dimensions.*.evidenceCoverage', type: 'coverage', required: true },
    // 咨询式：根因链（可选给，但给了就必须挂证据，否则等于编造）
    { path: 'dimensions.*.rootCause', type: 'object', required: false, hint: '根因链：现象→直接原因→根本原因' },
    { path: 'dimensions.*.rootCause.symptom', type: 'string', required: false },
    { path: 'dimensions.*.rootCause.directCause', type: 'string', required: false },
    { path: 'dimensions.*.rootCause.rootCause', type: 'string', required: false },
    { path: 'dimensions.*.rootCause.evidence', type: 'evidence', required: false },
    { path: 'commentary', type: 'string', required: true }
  ],
  ACTION: [
    { path: 'actions', type: 'array', required: true },
    { path: 'actions.*.priority', type: 'enum(P0|P1|P2)', required: true },
    { path: 'actions.*.dimension', type: 'string', required: true, hint: '须为六维 code 之一' },
    { path: 'actions.*.title', type: 'string', required: true },
    { path: 'actions.*.description', type: 'string', required: true, hint: '须引用具体数据' },
    { path: 'actions.*.expectedGain', type: 'number', required: true, hint: '预期提分，单条 <= 8' },
    { path: 'actions.*.effort', type: 'enum(quick_win|moderate|heavy)', required: true },
    { path: 'actions.*.nextSteps', type: 'array', required: true },
    { path: 'roadmap', type: 'array', required: true },
    { path: 'summary', type: 'string', required: true }
  ],
  SIMULATION: [
    { path: 'enabled', type: 'boolean', required: true },
    { path: 'note', type: 'string', required: true, hint: '必须声明不参与总分计算' },
    { path: 'platforms', type: 'array', required: false },
    { path: 'platforms.*.platform', type: 'string', required: false },
    { path: 'platforms.*.range', type: 'array', required: false, hint: '[下限, 上限]，0-1' },
    { path: 'platforms.*.confidence', type: 'enum(high|medium|low)', required: false }
  ],

  // ── 阶段5（可选）：真实社媒信号 ──
  // 铁律：每条帖子必须有 url（可点击、可核查）。无 url 的帖子不得进入样本，
  // 宁可少几条也不能掺入无法追溯的内容 —— 这正是与「AI 模拟舆情」的分界线。
  SOCIAL: [
    { path: 'platforms', type: 'array', required: true, hint: '已采集的平台清单（xhs/dy/gzh/wb/bilibili/zhihu…）' },
    { path: 'platforms.*.platform', type: 'string', required: true },
    { path: 'platforms.*.itemCount', type: 'number', required: true, hint: '该平台实际取到的样本条数' },
    { path: 'platforms.*.engagement', type: 'number', required: false, hint: '该平台样本总互动量（赞+藏+评+转）' },
    { path: 'platforms.*.evidence', type: 'evidence', required: true },
    { path: 'posts', type: 'array', required: true, hint: '真实帖子样本，每条须带可点击 url' },
    { path: 'posts.*.platform', type: 'string', required: true },
    { path: 'posts.*.title', type: 'string', required: true },
    { path: 'posts.*.url', type: 'string', required: true, hint: '原始帖子链接，报告须可点击' },
    { path: 'posts.*.sentiment', type: 'enum(positive|neutral|negative)', required: true },
    { path: 'posts.*.engagement', type: 'number', required: false },
    { path: 'posts.*.publishedAt', type: 'string', required: false },
    { path: 'posts.*.evidence', type: 'evidence', required: true },
    { path: 'distribution.positive', type: 'number', required: true, hint: '0-100，与 neutral+negative 合计 100' },
    { path: 'distribution.neutral', type: 'number', required: true },
    { path: 'distribution.negative', type: 'number', required: true },
    { path: 'negativeRate', type: 'number', required: true, hint: '0-1' },
    { path: 'topTopics', type: 'array', required: false, hint: '高频议题，用于反哺检索词' },
    { path: 'topTopics.*.topic', type: 'string', required: false },
    { path: 'topTopics.*.count', type: 'number', required: false },
    { path: 'topTopics.*.sentiment', type: 'enum(positive|neutral|negative)', required: false },
    { path: 'competitorsMentioned', type: 'array', required: false, hint: '社媒讨论中共现的竞品' },
    { path: 'competitorsMentioned.*.name', type: 'string', required: false },
    { path: 'competitorsMentioned.*.mentions', type: 'number', required: false },
    { path: 'windowDays', type: 'number', required: false, hint: '采集时间窗（默认 30 天）' },
    { path: 'evidenceCoverage', type: 'coverage', required: true },
    { path: 'note', type: 'string', required: false, hint: '采集受限说明（如平台不可达）' }
  ],

  // ── 阶段5（可选）：真实热搜信号 ──
  HOTSEARCH: [
    { path: 'items', type: 'array', required: true, hint: '真实热搜条目（品牌词命中与品类环境）' },
    { path: 'items.*.platform', type: 'string', required: true, hint: 'wb/dy/baidu/zhihu/bilibili/ks/toutiao' },
    { path: 'items.*.title', type: 'string', required: true },
    { path: 'items.*.url', type: 'string', required: false },
    { path: 'items.*.heat', type: 'number', required: false, hint: '平台热度值（原样记录，不做跨台归一化）' },
    { path: 'items.*.brandHit', type: 'boolean', required: true, hint: '该条目是否命中本品牌' },
    { path: 'items.*.sentiment', type: 'enum(positive|neutral|negative)', required: false },
    { path: 'items.*.evidence', type: 'evidence', required: true },
    { path: 'brandOnList', type: 'boolean', required: true, hint: '品牌词是否上榜' },
    { path: 'maxBrandHeat', type: 'number', required: false, hint: '品牌相关条目中的最高热度' },
    { path: 'categoryHeat', type: 'number', required: false, hint: '品类环境热度（用于判断品类升温/降温）' },
    { path: 'negativeAssociation', type: 'boolean', required: false, hint: '上榜条目是否关联负面' },
    { path: 'windowDays', type: 'number', required: false },
    { path: 'evidenceCoverage', type: 'coverage', required: true },
    { path: 'note', type: 'string', required: false }
  ]
};

// ─────────────────────────────────────────────────────────────
// 校验实现
// ─────────────────────────────────────────────────────────────

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function checkEvidence(val, path, errors, warnings) {
  if (!val || typeof val !== 'object') {
    errors.push({ path: path, msg: 'evidence 必须是对象' });
    return;
  }
  if (!EVIDENCE_LEVELS[val.level]) {
    errors.push({ path: path + '.level', msg: 'level 必须为 L1/L2/L3' });
  }
  if (val.level === 'L1' || val.level === 'L2') {
    if (!Array.isArray(val.sources) || val.sources.length === 0) {
      errors.push({ path: path + '.sources', msg: 'L1/L2 必须提供 sources（至少 1 条 URL）' });
    } else {
      var noUrl = val.sources.filter(function (s) { return !s || !s.url; }).length;
      if (noUrl > 0) {
        errors.push({ path: path + '.sources', msg: noUrl + ' 条 source 缺少 url' });
      }
    }
  }
  if (val.level === 'L3' && !val.note) {
    warnings.push({ path: path + '.note', msg: 'L3 推演应写 note 说明推演依据' });
  }
  if (val.level === 'L1' && !val.fetchedAt) {
    warnings.push({ path: path + '.fetchedAt', msg: 'L1 建议记录抓取时间' });
  }
}

/**
 * 根因链完整性：给了 rootCause 就必须四件套齐全 + 挂证据。
 * 缺证据 = 编造，直接报错而不是警告。
 */
function checkRootCause(rc, path, errors, warnings) {
  if (!rc || typeof rc !== 'object') return;
  if (typeof rc !== 'object' || Array.isArray(rc)) {
    errors.push({ path: path, msg: 'rootCause 必须是对象' });
    return;
  }
  ['symptom', 'directCause', 'rootCause'].forEach(function (k) {
    if (!rc[k]) errors.push({ path: path + '.' + k, msg: '根因链不完整，缺少 ' + k });
  });
  if (!rc.evidence) {
    errors.push({ path: path + '.evidence', msg: '根因必须挂证据，否则属于编造。无证据请删除该 rootCause' });
  } else {
    checkEvidence(rc.evidence, path + '.evidence', errors, warnings);
    if (rc.evidence.level === 'L3' && !rc.evidence.note) {
      errors.push({ path: path + '.evidence.note', msg: 'L3 根因必须写 note 说明推演依据' });
    }
  }
  // 万能答案检测
  var banned = ['不重视', '投入不足', '意识不够', '缺乏战略', '能力有限', '不够重视', '资源不足'];
  var text = [rc.symptom, rc.directCause, rc.rootCause].join(' ');
  banned.forEach(function (w) {
    if (text.indexOf(w) >= 0) {
      warnings.push({ path: path + '.rootCause', msg: '疑似万能答案「' + w + '」——这是结果不是原因，请继续往下挖一层' });
    }
  });
}

function checkCoverage(val, path, errors, warnings) {
  if (!val || typeof val !== 'object') {
    errors.push({ path: path, msg: 'evidenceCoverage 必须是对象' });
    return;
  }
  var sum = 0;
  EVIDENCE_ORDER.forEach(function (k) {
    var v = Number(val[k]);
    if (isNaN(v) || v < 0) { errors.push({ path: path + '.' + k, msg: '必须为 >= 0 的数字' }); return; }
    sum += v;
  });
  if (Math.abs(sum - 1) > 0.02 && sum > 0) {
    warnings.push({ path: path, msg: 'L1+L2+L3 合计应为 1，当前 ' + sum.toFixed(2) + '（将自动归一化）' });
  }
}

function resolvePath(obj, path) {
  // 返回 [{value, path}] —— 支持 * 数组通配
  var segs = path.split('.');
  var out = [{ value: obj, path: '' }];
  for (var i = 0; i < segs.length; i++) {
    var seg = segs[i];
    var next = [];
    for (var j = 0; j < out.length; j++) {
      var cur = out[j];
      if (cur.value === null || cur.value === undefined) continue;
      if (seg === '*') {
        if (!Array.isArray(cur.value)) continue;
        cur.value.forEach(function (item, idx) {
          next.push({ value: item, path: cur.path + '[' + idx + ']' });
        });
      } else {
        next.push({ value: cur.value[seg], path: (cur.path ? cur.path + '.' : '') + seg });
      }
    }
    out = next;
  }
  return out;
}

/**
 * 校验单个 stage 对象。
 * @returns {{errors: Array, warnings: Array}}
 */
function validateStage(code, obj) {
  var errors = [], warnings = [];
  var rules = STAGE_RULES[code];
  if (!rules) {
    return { errors: [{ path: code, msg: '未知 stageCode' }], warnings: [] };
  }
  if (!obj || typeof obj !== 'object') {
    return { errors: [{ path: code, msg: 'stage 内容必须是对象' }], warnings: [] };
  }

  rules.forEach(function (rule) {
    var nodes = resolvePath(obj, rule.path);
    if (nodes.length === 0) {
      if (rule.required) errors.push({ path: rule.path, msg: '缺失必填字段' + (rule.hint ? '（' + rule.hint + '）' : '') });
      return;
    }
    nodes.forEach(function (node) {
      var v = node.value;
      if (v === undefined || v === null) {
        if (rule.required) errors.push({ path: node.path, msg: '缺失必填字段' + (rule.hint ? '（' + rule.hint + '）' : '') });
        return;
      }
      var t = rule.type;
      if (t === 'evidence') { checkEvidence(v, node.path, errors, warnings); return; }
      if (t === 'coverage') { checkCoverage(v, node.path, errors, warnings); return; }
      if (t.indexOf('enum(') === 0) {
        var allowed = t.slice(5, -1).split('|');
        if (allowed.indexOf(String(v)) < 0) {
          errors.push({ path: node.path, msg: '取值必须为 ' + allowed.join(' / ') + '，当前 "' + v + '"' });
        }
        return;
      }
      if (typeOf(v) !== t) {
        errors.push({ path: node.path, msg: '类型应为 ' + t + '，实际 ' + typeOf(v) });
      }
    });
  });

  // 分维度基准：给了就必须 code 合法 + 挂证据，无证据的维度会被丢弃
  if (code === 'COMPETITIVE' && obj.dimensionBenchmarks) {
    var dbm = obj.dimensionBenchmarks;
    if (!Array.isArray(dbm.dimensions)) {
      errors.push({ path: 'dimensionBenchmarks.dimensions', msg: '必须是数组' });
    } else {
      dbm.dimensions.forEach(function (d, i) {
        var bp = 'dimensionBenchmarks.dimensions[' + i + ']';
        if (!d || typeof d !== 'object') {
          errors.push({ path: bp, msg: '必须是对象' });
          return;
        }
        if (!dimensionByCode(d.code)) {
          errors.push({ path: bp + '.code', msg: '非法的维度 code: ' + d.code });
          return;
        }
        if (typeof d.score !== 'number' || d.score < 0 || d.score > 100) {
          errors.push({ path: bp + '.score', msg: 'score 须为 0-100 数字' });
        }
        if (!d.evidence) {
          errors.push({ path: bp + '.evidence', msg: '竞品维度打分必须挂证据，否则属于编造基准' });
        } else {
          checkEvidence(d.evidence, bp + '.evidence', errors, warnings);
        }
      });
    }
  }

  // 根因链：单阶段校验也要拦（AI 是逐阶段跑 validate 的）
  if (code === 'SCORE' && Array.isArray(obj.dimensions)) {
    obj.dimensions.forEach(function (d, i) {
      if (d && d.rootCause) {
        checkRootCause(d.rootCause, 'dimensions[' + i + '].rootCause', errors, warnings);
      }
    });
  }

  return { errors: errors, warnings: warnings };
}

/**
 * 校验合并后的完整报告（跨阶段一致性）。
 */
function validateReport(report) {
  var errors = [], warnings = [];

  if (!report.stages) {
    return { errors: [{ path: 'stages', msg: '缺少 stages' }], warnings: [] };
  }

  // 只校验必填阶段。SIMULATION / SOCIAL / HOTSEARCH 为可选增强，缺失不报错。
  REQUIRED_STAGE_CODES.forEach(function (code) {
    if (!report.stages[code]) {
      errors.push({ path: 'stages.' + code, msg: '缺少 stage' });
    }
  });

  var score = report.stages && report.stages.SCORE;
  if (score) {
    var dims = score.dimensions || [];
    var seen = {};
    dims.forEach(function (d, i) {
      var p = 'stages.SCORE.dimensions[' + i + ']';
      if (!dimensionByCode(d.code)) {
        errors.push({ path: p + '.code', msg: '未知维度 code: ' + d.code });
      }
      if (seen[d.code]) errors.push({ path: p + '.code', msg: '维度重复: ' + d.code });
      seen[d.code] = true;
      if (typeof d.score !== 'number' || d.score < 0 || d.score > 100) {
        errors.push({ path: p + '.score', msg: 'score 须为 0-100 数字' });
      }
      // 根因链：给了就必须完整且挂证据，缺证据 = 编造
      if (d.rootCause) checkRootCause(d.rootCause, p + '.rootCause', errors, warnings);
    });
    DIMENSIONS.forEach(function (spec) {
      if (!seen[spec.code]) {
        errors.push({ path: 'stages.SCORE.dimensions', msg: '缺少维度: ' + spec.code + '（' + spec.name + '）' });
      }
    });

    // 总分重算校验
    var recomputed = recomputeTotal(dims);
    if (typeof score.totalScore === 'number' && Math.abs(recomputed - score.totalScore) > 1.5) {
      warnings.push({
        path: 'stages.SCORE.totalScore',
        msg: 'totalScore=' + score.totalScore + '，按权重重算为 ' + recomputed + '（差 ' + Math.abs(recomputed - score.totalScore).toFixed(1) + '，将采用重算值）'
      });
    }

    // 权重和
    var wsum = dims.reduce(function (a, d) {
      var spec = dimensionByCode(d.code);
      return a + (spec ? spec.weight : 0);
    }, 0);
    if (dims.length && Math.abs(wsum - 1) > 0.001) {
      warnings.push({ path: 'stages.SCORE.dimensions', msg: '覆盖维度权重合计 ' + wsum.toFixed(2) + '，应为 1.00' });
    }
  }

  // OVERVIEW.score 与 SCORE.totalScore 一致性
  var ov = report.stages && report.stages.OVERVIEW;
  if (ov && score && typeof ov.score === 'number' && typeof score.totalScore === 'number') {
    if (Math.abs(ov.score - score.totalScore) > 1.5) {
      warnings.push({ path: 'stages.OVERVIEW.score', msg: '与 SCORE.totalScore 不一致（' + ov.score + ' vs ' + score.totalScore + '）' });
    }
  }

  // 执行摘要：3 条判断，且最大机会点的维度须合法
  if (ov && ov.executiveSummary) {
    var es = ov.executiveSummary;
    if (Array.isArray(es.judgments) && es.judgments.length !== 3) {
      warnings.push({ path: 'stages.OVERVIEW.executiveSummary.judgments', msg: '建议恰好 3 条核心判断，当前 ' + es.judgments.length + ' 条' });
    }
    if (es.biggestOpportunity && es.biggestOpportunity.dimension && !dimensionByCode(es.biggestOpportunity.dimension)) {
      errors.push({ path: 'stages.OVERVIEW.executiveSummary.biggestOpportunity.dimension', msg: '非法的维度 code: ' + es.biggestOpportunity.dimension });
    }
  }

  // ACTION.dimension 必须是六维之一
  var act = report.stages && report.stages.ACTION;
  if (act && Array.isArray(act.actions)) {
    act.actions.forEach(function (a, i) {
      if (a.dimension && !dimensionByCode(a.dimension)) {
        errors.push({ path: 'stages.ACTION.actions[' + i + '].dimension', msg: '非法的维度 code: ' + a.dimension });
      }
      if (typeof a.expectedGain === 'number' && a.expectedGain > 8) {
        warnings.push({ path: 'stages.ACTION.actions[' + i + '].expectedGain', msg: '单条预期提分 ' + a.expectedGain + ' > 8，偏高' });
      }
    });
  }

  // SIMULATION 必须声明不进总分
  var sim = report.stages && report.stages.SIMULATION;
  if (sim && sim.enabled && !/不(参与|计入)/.test(String(sim.note || ''))) {
    warnings.push({ path: 'stages.SIMULATION.note', msg: 'note 应明确声明"不参与总分计算"' });
  }

  // SENTIMENT 分布合计
  var sen = report.stages && report.stages.SENTIMENT;
  if (sen && sen.distribution) {
    var s = Number(sen.distribution.positive) + Number(sen.distribution.neutral) + Number(sen.distribution.negative);
    if (Math.abs(s - 100) > 1) {
      errors.push({ path: 'stages.SENTIMENT.distribution', msg: 'positive+neutral+negative 应等于 100，当前 ' + s });
    }
  }

  // SOCIAL 分布合计 + 样本可追溯性（可选阶段，仅在存在时校验）
  var soc = report.stages && report.stages.SOCIAL;
  if (soc) {
    if (soc.distribution) {
      var sd = Number(soc.distribution.positive) + Number(soc.distribution.neutral) + Number(soc.distribution.negative);
      if (Math.abs(sd - 100) > 1) {
        errors.push({ path: 'stages.SOCIAL.distribution', msg: 'positive+neutral+negative 应等于 100，当前 ' + sd });
      }
    }
    if (Array.isArray(soc.posts) && soc.posts.length) {
      var noUrl = soc.posts.filter(function (p) { return !p || !p.url; }).length;
      // 无 url 的样本无法核查，等同于编造 —— 直接报错而非警告
      if (noUrl > 0) {
        errors.push({
          path: 'stages.SOCIAL.posts',
          msg: noUrl + '/' + soc.posts.length + ' 条样本缺少 url。社媒样本必须可点击溯源，无 url 请删除该条而不是留空'
        });
      }
      // 覆盖平台数：仅 1 个平台时提醒（铁律：多平台覆盖，单平台结论偏颇）
      var plats = {};
      soc.posts.forEach(function (p) { if (p && p.platform) plats[p.platform] = 1; });
      var pn = Object.keys(plats).length;
      if (pn === 1) {
        warnings.push({ path: 'stages.SOCIAL.posts', msg: '样本仅覆盖 1 个平台，跨平台对比结论可能偏颇，建议补全' });
      }
    }
  }

  // HOTSEARCH 一致性（可选阶段）
  var hot = report.stages && report.stages.HOTSEARCH;
  if (hot) {
    if (Array.isArray(hot.items)) {
      var hits = hot.items.filter(function (i) { return i && i.brandHit; }).length;
      if (hot.brandOnList !== (hits > 0)) {
        warnings.push({
          path: 'stages.HOTSEARCH.brandOnList',
          msg: 'brandOnList=' + hot.brandOnList + '，但 items 中 brandHit=true 的有 ' + hits + ' 条，两者应一致'
        });
      }
    }
    if (hot.brandOnList && typeof hot.maxBrandHeat !== 'number') {
      warnings.push({ path: 'stages.HOTSEARCH.maxBrandHeat', msg: '品牌已上榜但缺 maxBrandHeat，热搜指数将退化为定性判断' });
    }
  }

  return { errors: errors, warnings: warnings };
}

/**
 * 按权重重算总分。缺失维度用 fallback 补齐后归一化。
 */
function recomputeTotal(dims) {
  var total = 0, wsum = 0;
  (dims || []).forEach(function (d) {
    var spec = dimensionByCode(d.code);
    if (!spec) return;
    total += clamp(d.score, 0, 100) * spec.weight;
    wsum += spec.weight;
  });
  if (wsum <= 0) return 0;
  return Math.round(total / wsum);
}

/**
 * 汇总全报告的证据覆盖率（按维度权重加权）。
 */
function rollupCoverage(report) {
  var acc = { L1: 0, L2: 0, L3: 0 };
  // 优先用合并后的 score.dimensions（含兜底维度），否则退回 stages.SCORE
  var dims = (report.score && report.score.dimensions) ||
    (report.stages && report.stages.SCORE && report.stages.SCORE.dimensions) || [];
  var wsum = 0;
  dims.forEach(function (d) {
    var spec = dimensionByCode(d.code);
    if (!spec) return;
    var c = normalizeCoverage(d.evidenceCoverage);
    EVIDENCE_ORDER.forEach(function (k) { acc[k] += c[k] * spec.weight; });
    wsum += spec.weight;
  });
  if (wsum <= 0) return { L1: 0, L2: 0, L3: 0 };
  EVIDENCE_ORDER.forEach(function (k) { acc[k] = acc[k] / wsum; });
  return acc;
}

/**
 * 分数瀑布图：从满分 100 起，按各维度权重逐项扣分，落到总分。
 * 恒等式：Σ loss = 100 − totalScore（权重合计为 1 时成立）
 */
function computeWaterfall(dims, totalScore, benchmark) {
  var items = (dims || []).map(function (d) {
    var spec = dimensionByCode(d.code);
    var w = spec ? spec.weight : (d.weight || 0);
    return {
      code: d.code,
      name: d.name || (spec ? spec.name : d.code),
      weight: w,
      score: d.score,
      loss: Math.round((100 - d.score) * w * 100) / 100
    };
  }).sort(function (a, b) { return b.loss - a.loss; });

  var sumLoss = 0;
  items.forEach(function (it) { sumLoss += it.loss; });

  return {
    start: 100,
    items: items,
    end: totalScore,
    totalLoss: Math.round(sumLoss * 10) / 10,
    benchmark: (benchmark === null || benchmark === undefined) ? null : benchmark
  };
}

/**
 * 影响力 × 可行性 2×2 优先级矩阵。
 * 影响力按本报告 expectedGain 均值二分（相对口径，避免绝对阈值在不同品牌上失效）；
 * 可行性按 effort 二分（heavy = 低可行）。
 */
var QUADRANTS = {
  quick:      { code: 'quick',      label: '速赢',     hint: '高影响 · 易落地，优先开工', color: '#2F6B4F' },
  strategic:  { code: 'strategic',  label: '重点投入', hint: '高影响 · 需专项资源',     color: '#2C5F92' },
  fillin:     { code: 'fillin',     label: '补齐',     hint: '影响有限 · 顺手做',       color: '#B06A12' },
  reconsider: { code: 'reconsider', label: '暂缓',     hint: '影响低 · 投入大，再评估', color: '#9A9188' }
};

function prioritizeActions(actions) {
  var out = { quadrants: { quick: [], strategic: [], fillin: [], reconsider: [] }, meanGain: 0, items: [] };
  if (!Array.isArray(actions) || !actions.length) return out;

  var gains = actions.map(function (a) { return Number(a.expectedGain) || 0; });
  var mean = gains.reduce(function (a, b) { return a + b; }, 0) / gains.length;
  out.meanGain = Math.round(mean * 10) / 10;

  out.items = actions.map(function (a) {
    var gain = Number(a.expectedGain) || 0;
    var impact = gain >= mean ? 'high' : 'low';
    var feas = a.effort === 'heavy' ? 'low' : 'high';
    var q = impact === 'high'
      ? (feas === 'high' ? 'quick' : 'strategic')
      : (feas === 'high' ? 'fillin' : 'reconsider');
    return { action: a, gain: gain, impact: impact, feasibility: feas, quadrant: q };
  });

  out.items.forEach(function (it) { out.quadrants[it.quadrant].push(it); });
  return out;
}

module.exports = {
  EVIDENCE_LEVELS: EVIDENCE_LEVELS,
  EVIDENCE_ORDER: EVIDENCE_ORDER,
  DIMENSIONS: DIMENSIONS,
  LEVELS: LEVELS,
  DEPTHS: DEPTHS,
  STAGE_FILES: STAGE_FILES,
  ALL_STAGE_CODES: ALL_STAGE_CODES,
  OPTIONAL_STAGE_CODES: OPTIONAL_STAGE_CODES,
  REQUIRED_STAGE_CODES: REQUIRED_STAGE_CODES,
  STAGE_RULES: STAGE_RULES,
  levelOf: levelOf,
  dimensionByCode: dimensionByCode,
  clamp: clamp,
  normalizeCoverage: normalizeCoverage,
  confidenceOf: confidenceOf,
  validateStage: validateStage,
  validateReport: validateReport,
  recomputeTotal: recomputeTotal,
  rollupCoverage: rollupCoverage,
  computeWaterfall: computeWaterfall,
  prioritizeActions: prioritizeActions,
  QUADRANTS: QUADRANTS
};
