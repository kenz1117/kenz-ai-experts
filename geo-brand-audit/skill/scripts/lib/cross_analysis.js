#!/usr/bin/env node
'use strict';

/**
 * geo-brand-audit — 多源交叉分析层
 *
 * 把三个真实信号源对齐，回答六维评分单独回答不了的三个问题：
 *   1. 叙事鸿沟   — 检索/公开叙事的情绪 vs 社媒真实用户的情绪，差多少
 *   2. 三源矩阵   — 检索可见度 × 社媒声量 × 热搜热度，落在哪个象限
 *   3. 危机三通道 — 检索舆情 / 社媒 / 热搜，任一通道亮红灯即预警
 *
 * ── 与「AI 测 AI」的分界线（本文件的存在意义）────────────────────
 *   1. 只吃真实数据：SOCIAL / HOTSEARCH 每条样本都已在 schema.js 强制挂证据。
 *   2. 缺数据就是缺数据：对应指标一律为 null，绝不补 0、绝不用 AI 估。
 *      「未采集」与「采集过、确认为 0」是两回事，分别用 null 和 0 表达。
 *   3. 归一化公式全部显式写在 NORM 里，人工可复算，没有黑箱。
 *   4. 所有指数是横向对比用的相对值，不代表绝对市场份额。
 * ────────────────────────────────────────────────────────────
 */

var S = require('./schema.js');

// ── 归一化参数（公开可复算）──────────────────────────────────
var NORM = {
  // 声量/热度用对数归一化。对数是为了避免单条爆款把指数拉爆。
  socialCeiling: 100000,   // 总互动 10 万视为打满
  hotCeiling: 1000000      // 单条热度 100 万视为打满
};

var TH = {
  quad: 50,        // 社媒/热搜指数高/低分界（声量活跃线）
  gap: 20,         // 叙事鸿沟「显著」阈值（±20 分）
  crisis: 40,      // 单通道危机触发强度
  negRate: 0.25,   // 负面率触发线
  minSocialPosts: 10 // 社媒样本低于此条数时，危机判定标注低可信
};

/**
 * 三源的高/低分界**按源分别设定** —— 这是刻意的：
 * 检索可见度是 0-100 的质量分（对齐报告评级：≥60 为「一般」以上），
 * 社媒/热搜是对数归一化的声量档位。两者量纲不同，
 * 用同一把尺子比会把「质量 54 分但声量高」误判成全面领先。
 */
var QUAD_THRESHOLD_BY_SOURCE = {
  visibility: 60,   // 对齐 SKILL.md 评级：≥60 一般 / ≥75 良好 / ≥90 优秀
  social: 50,
  hotsearch: 50
};

// 声量/热度档位（对应 P1④ 判定带，让指数可读而不只是一个数字）
var BANDS = {
  social: [
    { min: 75, label: '高热', hint: '声量显著，话题已在扩散',   color: '#A32B2B' },
    { min: 50, label: '活跃', hint: '有稳定讨论',               color: '#D96F18' },
    { min: 25, label: '低迷', hint: '讨论稀少',                 color: '#B06A12' },
    { min: 0,  label: '沉寂', hint: '几乎无真实讨论',           color: '#9A9188' }
  ],
  hotsearch: [
    { min: 75, label: '爆榜', hint: '高热度在榜',     color: '#A32B2B' },
    { min: 50, label: '在榜', hint: '中等热度在榜',   color: '#D96F18' },
    { min: 1,  label: '偶发', hint: '上榜但热度低',   color: '#B06A12' },
    { min: 0,  label: '未上榜', hint: '窗口期内未见品牌词', color: '#9A9188' }
  ]
};

function bandOf(kind, v) {
  var list = BANDS[kind];
  if (!list || v === null || v === undefined) return null;
  for (var i = 0; i < list.length; i++) {
    if (v >= list[i].min) return list[i];
  }
  return list[list.length - 1];
}

/**
 * 情绪分：(正面% − 负面%)，天然落在 −100 ~ +100，中性不计入。
 */
function sentimentScore(dist) {
  if (!dist) return null;
  var p = Number(dist.positive);
  var n = Number(dist.negative);
  if (isNaN(p) || isNaN(n)) return null;
  return Math.round(p - n);
}

/**
 * 对数归一化到 0-100。
 */
function logNorm(v, ceiling) {
  v = Number(v);
  if (!isFinite(v) || v <= 0) return 0;
  if (v >= ceiling) return 100;
  return Math.round(Math.log10(1 + v) / Math.log10(1 + ceiling) * 100);
}

function isHigh(kind, v) {
  if (v === null || v === undefined) return null;
  var t = QUAD_THRESHOLD_BY_SOURCE[kind];
  if (t === undefined) t = TH.quad;
  return v >= t ? 'high' : 'low';
}

// ── 象限定义 ────────────────────────────────────────────────
var QUADRANTS = {
  leading:             { code: 'leading',             label: '全面领先',     hint: '三源均高，保持并放大优势',                 color: '#2F6B4F' },
  heat_without_assets: { code: 'heat_without_assets', label: '有热度无资产', hint: '用户已经在聊，但检索侧接不住 —— GEO 最大机会', color: '#D96F18' },
  assets_without_heat: { code: 'assets_without_heat', label: '有资产无热度', hint: '检索资产尚可，但缺真实讨论与话题度 —— 补内容分发', color: '#2C5F92' },
  dormant:             { code: 'dormant',             label: '双弱待启动',   hint: '三源均低，需从检索资产与内容双线起步',       color: '#9A9188' },
  mixed:               { code: 'mixed',               label: '参差',         hint: '各源表现不一致，需逐源定位',               color: '#B06A12' }
};

var GAP_VERDICTS = {
  overstated:   { code: 'overstated',   label: '叙事虚高', hint: '公开叙事明显好于社媒真实口碑 —— 高危错位，口碑已在埋雷', color: '#A32B2B' },
  understated:  { code: 'understated',  label: '叙事低估', hint: '社媒口碑好于检索叙事 —— 真实好评没被检索侧接住，GEO 机会', color: '#2C5F92' },
  aligned:      { code: 'aligned',      label: '叙事一致', hint: '两侧情绪基本一致，无显著错位',                         color: '#2F6B4F' },
  insufficient: { code: 'insufficient', label: '数据不足', hint: '缺少社媒或检索舆情的情绪分布，无法计算鸿沟',             color: '#9A9188' }
};

/**
 * 主入口。
 * @param {Object} report 合并后的报告（含 stages / score / meta）
 * @returns {Object} 交叉分析结果；available=false 表示没有任何多源数据
 */
function crossAnalyze(report) {
  var st = (report && report.stages) || {};
  var meta = (report && report.meta) || {};
  var score = (report && report.score) || {};
  var social = st.SOCIAL || null;
  var hot = st.HOTSEARCH || null;
  var sentiment = st.SENTIMENT || null;
  var competitive = st.COMPETITIVE || null;

  var out = {
    available: !!(social || hot),
    sources: {
      visibility: (typeof score.totalScore === 'number'),
      social: !!social,
      hotsearch: !!hot
    },
    norm: NORM,
    thresholds: TH
  };

  // ══ 1. 叙事鸿沟 ═══════════════════════════════════════════
  var searchSent = sentiment ? sentimentScore(sentiment.distribution) : null;
  var socialSent = social ? sentimentScore(social.distribution) : null;
  var gap = (searchSent !== null && socialSent !== null) ? (searchSent - socialSent) : null;

  var gapVerdict;
  if (gap === null) gapVerdict = 'insufficient';
  else if (gap >= TH.gap) gapVerdict = 'overstated';
  else if (gap <= -TH.gap) gapVerdict = 'understated';
  else gapVerdict = 'aligned';

  out.narrativeGap = {
    searchSentiment: searchSent,
    socialSentiment: socialSent,
    gap: gap,
    verdict: gapVerdict,
    verdictLabel: GAP_VERDICTS[gapVerdict].label,
    verdictHint: GAP_VERDICTS[gapVerdict].hint,
    verdictColor: GAP_VERDICTS[gapVerdict].color,
    // 两侧各自的负面率，便于人工核对情绪分是否可信
    searchNegativeRate: (sentiment && typeof sentiment.negativeRate === 'number') ? sentiment.negativeRate : null,
    socialNegativeRate: (social && typeof social.negativeRate === 'number') ? social.negativeRate : null
  };

  // ══ 2. 三源可见度矩阵 ═════════════════════════════════════
  var visibilityIndex = (typeof score.totalScore === 'number')
    ? Math.round(score.totalScore) : null;

  var socialIndex = null;
  var socialEngagement = null;
  if (social) {
    var eng = 0;
    (social.platforms || []).forEach(function (p) { eng += Number(p.engagement) || 0; });
    // 平台级互动缺失时，退回到逐帖累加
    if (eng <= 0 && Array.isArray(social.posts)) {
      social.posts.forEach(function (p) { eng += Number(p.engagement) || 0; });
    }
    if (eng > 0) { socialEngagement = eng; socialIndex = logNorm(eng, NORM.socialCeiling); }
    else socialIndex = null; // 采集过但无互动数据 —— 不补 0
  }

  var hotIndex = null;
  if (hot) {
    if (hot.brandOnList) {
      // 上榜是事实。有热度值就归一化；没有则给定性的最小值 1，区别于「未上榜」的 0。
      hotIndex = (typeof hot.maxBrandHeat === 'number')
        ? Math.max(1, logNorm(hot.maxBrandHeat, NORM.hotCeiling))
        : 1;
    } else {
      // 明确采集过且确认未上榜 → 0 是事实，不是缺数据
      hotIndex = 0;
    }
  }

  var qv = isHigh('visibility', visibilityIndex);
  var qs = isHigh('social', socialIndex);
  var qh = isHigh('hotsearch', hotIndex);

  var quadrant = null;
  var knownQ = [qv, qs, qh].filter(function (x) { return x !== null; });
  if (knownQ.length >= 2) {
    var allHigh = knownQ.every(function (x) { return x === 'high'; });
    var allLow = knownQ.every(function (x) { return x === 'low'; });
    if (allHigh) quadrant = 'leading';
    else if (allLow) quadrant = 'dormant';
    else if (qv === 'low' && (qs === 'high' || qh === 'high')) quadrant = 'heat_without_assets';
    else if (qv === 'high' && (qs === 'low' || qh === 'low')) quadrant = 'assets_without_heat';
    else quadrant = 'mixed';
  }

  var sb = bandOf('social', socialIndex);
  var hb = bandOf('hotsearch', hotIndex);

  out.threeSource = {
    visibilityIndex: visibilityIndex,
    socialIndex: socialIndex,
    hotIndex: hotIndex,
    socialEngagement: socialEngagement,
    levels: { visibility: qv, social: qs, hotsearch: qh },
    // 各源的高/低分界不同，报告里要显式标出，避免读者误以为同质可比
    thresholds: QUAD_THRESHOLD_BY_SOURCE,
    bands: {
      social: sb ? { label: sb.label, hint: sb.hint, color: sb.color } : null,
      hotsearch: hb ? { label: hb.label, hint: hb.hint, color: hb.color } : null
    },
    quadrant: quadrant,
    quadrantLabel: quadrant ? QUADRANTS[quadrant].label : '数据不足',
    quadrantHint: quadrant ? QUADRANTS[quadrant].hint : '至少需 2 个源有数据才能定位象限',
    quadrantColor: quadrant ? QUADRANTS[quadrant].color : '#9A9188'
  };

  // ══ 3. 危机三通道 ═════════════════════════════════════════
  var channels = [];

  // 通道1：检索舆情
  var c1 = { code: 'sentiment', name: '检索舆情', hasData: !!sentiment, triggered: false, intensity: 0, reason: '' };
  if (sentiment) {
    var nr1 = Number(sentiment.negativeRate);
    var i1 = isNaN(nr1) ? 0 : Math.min(100, Math.round(nr1 * 200)); // 负面率 50% 打满
    if (sentiment.riskLevel === 'high') i1 = Math.max(i1, 70);
    c1.intensity = i1;
    c1.triggered = i1 >= TH.crisis || sentiment.riskLevel === 'high';
    c1.reason = c1.triggered
      ? '负面率 ' + pct(sentiment.negativeRate) + (sentiment.riskLevel === 'high' ? '，且风险等级为 high' : '')
      : '负面率 ' + pct(sentiment.negativeRate) + '，未达预警线';
  } else {
    c1.reason = '未采集';
  }
  channels.push(c1);

  // 通道2：社媒真实讨论
  var c2 = { code: 'social', name: '社媒口碑', hasData: !!social, triggered: false, intensity: 0, reason: '' };
  if (social) {
    var nr2 = Number(social.negativeRate);
    var i2 = isNaN(nr2) ? 0 : Math.min(100, Math.round(nr2 * 200));
    // 负面帖的互动占比显著高于其数量占比 → 负面更易爆，加权
    var negSpread = computeNegativeSpread(social);
    if (negSpread && negSpread.ratio >= 1.5) {
      i2 = Math.min(100, i2 + 15);
      c2.detail = '负面帖互动占比 ' + pct(negSpread.engagementShare) +
        ' 为其数量占比 ' + pct(negSpread.countShare) + ' 的 ' + negSpread.ratio.toFixed(1) + ' 倍，负面更易扩散';
    }
    // 样本量：条数太少时负面率噪声大，明确标注，避免把小样本当结论
    var postCount = Array.isArray(social.posts) ? social.posts.length : 0;
    c2.sampleCount = postCount;
    c2.lowSample = postCount > 0 && postCount < TH.minSocialPosts;

    c2.intensity = i2;
    c2.triggered = i2 >= TH.crisis;
    c2.reason = c2.triggered
      ? '社媒负面率 ' + pct(social.negativeRate) + (c2.detail ? '；' + c2.detail : '')
      : '社媒负面率 ' + pct(social.negativeRate) + '，未达预警线';
    if (c2.lowSample) {
      c2.reason += '（样本仅 ' + postCount + ' 条，低于 ' + TH.minSocialPosts + ' 条，负面率噪声较大）';
    }
  } else {
    c2.reason = '未采集';
  }
  channels.push(c2);

  // 通道3：热搜
  var c3 = { code: 'hotsearch', name: '热搜信号', hasData: !!hot, triggered: false, intensity: 0, reason: '' };
  if (hot) {
    var negItems = (hot.items || []).filter(function (i) { return i && i.brandHit && i.sentiment === 'negative'; });
    var i3 = 0;
    if (hot.brandOnList && (hot.negativeAssociation || negItems.length)) i3 = 75;
    else if (hot.brandOnList) i3 = 20; // 上榜本身是中性的，但意味着被放大审视
    c3.intensity = i3;
    c3.triggered = i3 >= TH.crisis;
    c3.reason = hot.brandOnList
      ? (c3.triggered ? '品牌已上榜且关联负面内容（' + negItems.length + ' 条负面条目）' : '品牌已上榜，未发现负面关联')
      : '品牌未上榜';
    if (negItems.length) c3.negatives = negItems.map(function (i) { return { platform: i.platform, title: i.title, url: i.url || null }; });
  } else {
    c3.reason = '未采集';
  }
  channels.push(c3);

  var withData = channels.filter(function (c) { return c.hasData; });
  var triggered = withData.filter(function (c) { return c.triggered; });
  var maxI = withData.reduce(function (m, c) { return Math.max(m, c.intensity); }, 0);
  var crisisScore = Math.min(100, maxI + (triggered.length > 1 ? (triggered.length - 1) * 10 : 0));

  out.crisis = {
    score: crisisScore,
    level: crisisScore >= 60 ? 'high' : (crisisScore >= 30 ? 'medium' : 'low'),
    levelLabel: crisisScore >= 60 ? '高危' : (crisisScore >= 30 ? '关注' : '平稳'),
    channels: channels,
    triggeredCount: triggered.length,
    channelsWithData: withData.length,
    // 有多少通道实际有数据，决定这个分有多可信
    confidence: withData.length === 0 ? 0 : Math.round(withData.length / channels.length * 100)
  };

  // ══ 4. 竞品多维并集 ═══════════════════════════════════════
  out.competitorUnion = buildCompetitorUnion(meta.brand, competitive, social, hot);

  // ══ 5. 覆盖率（这一层有多实）══════════════════════════════
  var srcCount = (out.sources.visibility ? 1 : 0) + (out.sources.social ? 1 : 0) + (out.sources.hotsearch ? 1 : 0);
  var covAcc = { L1: 0, L2: 0, L3: 0 };
  var covN = 0;
  [social, hot].forEach(function (stage) {
    if (stage && stage.evidenceCoverage) {
      var c = S.normalizeCoverage(stage.evidenceCoverage);
      EACH_L(function (k) { covAcc[k] += c[k]; });
      covN++;
    }
  });
  if (covN > 0) EACH_L(function (k) { covAcc[k] = covAcc[k] / covN; });

  out.coverage = {
    sourcesAvailable: srcCount,
    sourcesTotal: 3,
    ratio: Math.round(srcCount / 3 * 100) / 100,
    evidenceCoverage: covAcc,
    confidence: S.confidenceOf(covAcc)
  };

  return out;
}

function EACH_L(fn) { ['L1', 'L2', 'L3'].forEach(fn); }

function pct(v) {
  var n = Number(v);
  if (isNaN(n)) return '—';
  return Math.round(n * 1000) / 10 + '%';
}

/**
 * 负面帖的互动占比 / 数量占比。>1 说明负面内容更容易拿到互动（更易扩散）。
 */
function computeNegativeSpread(social) {
  var posts = Array.isArray(social.posts) ? social.posts : [];
  if (!posts.length) return null;
  var negC = 0, negE = 0, totE = 0;
  var hasEng = false;
  posts.forEach(function (p) {
    if (!p) return;
    var e = Number(p.engagement) || 0;
    if (e > 0) hasEng = true;
    totE += e;
    if (p.sentiment === 'negative') { negC++; negE += e; }
  });
  if (!hasEng || totE <= 0 || negC === 0) return null;
  var countShare = negC / posts.length;
  var engagementShare = negE / totE;
  return {
    countShare: countShare,
    engagementShare: engagementShare,
    ratio: countShare > 0 ? engagementShare / countShare : 0
  };
}

/**
 * 合并「检索声量榜」与「社媒讨论」里的竞品，标注每个竞品在三源上的表现。
 */
function buildCompetitorUnion(brand, competitive, social, hot) {
  var map = {};

  function slot(name) {
    if (!name || name === brand) return null;
    if (!map[name]) {
      map[name] = {
        name: name,
        searchShare: null,      // 检索声量份额 0-1
        socialMentions: null,   // 社媒提及次数
        onHotsearch: false,     // 是否上过热搜
        sources: []
      };
    }
    return map[name];
  }

  ((competitive && competitive.shareOfVoice) || []).forEach(function (s) {
    var e = slot(s && s.name);
    if (!e) return;
    e.searchShare = Number(s.share) || 0;
    if (e.sources.indexOf('检索') < 0) e.sources.push('检索');
  });

  ((social && social.competitorsMentioned) || []).forEach(function (c) {
    var e = slot(c && c.name);
    if (!e) return;
    e.socialMentions = Number(c.mentions) || 0;
    if (e.sources.indexOf('社媒') < 0) e.sources.push('社媒');
  });

  // 热搜：标题里出现竞品名即算命中（粗匹配，报告里会标为「标题匹配」）
  var hotItems = (hot && hot.items) || [];
  Object.keys(map).forEach(function (name) {
    for (var i = 0; i < hotItems.length; i++) {
      var t = hotItems[i] && String(hotItems[i].title || '');
      if (t && t.indexOf(name) >= 0) {
        map[name].onHotsearch = true;
        if (map[name].sources.indexOf('热搜') < 0) map[name].sources.push('热搜');
        break;
      }
    }
  });

  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) {
      // 多源出现的排前面，其次按检索份额
      if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
      return (b.searchShare || 0) - (a.searchShare || 0);
    });
}

module.exports = {
  crossAnalyze: crossAnalyze,
  sentimentScore: sentimentScore,
  logNorm: logNorm,
  NORM: NORM,
  TH: TH,
  QUADRANTS: QUADRANTS,
  GAP_VERDICTS: GAP_VERDICTS
};

// ── CLI：直接对一份合并报告跑交叉分析，便于调试 ──────────────
if (require.main === module) {
  var fs = require('fs');
  var f = process.argv[2];
  if (!f) {
    console.error('用法: node cross_analysis.js <merged-audit.json>');
    process.exit(2);
  }
  var rep = JSON.parse(fs.readFileSync(f, 'utf8'));
  var r = crossAnalyze(rep);
  console.log(JSON.stringify(r, null, 2));
}
