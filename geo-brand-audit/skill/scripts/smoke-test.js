#!/usr/bin/env node
'use strict';

/**
 * geo-brand-audit — 离线回归测试
 *
 * 用 output/samples/sample-audit.json 这份夹具，脱离任何活 API 验证：
 *   1. 合并报告通过 schema 校验
 *   2. HTML 汇报版能渲染出关键章节
 *   3. Markdown 执行版能渲染出关键章节
 *   4. 交叉分析「有阶段5」与「无阶段5（降级）」两条路径都正确
 *
 * 用法:
 *   node scripts/smoke-test.js            跑全部用例
 *   node scripts/smoke-test.js --keep     保留产物以便人工查看
 *
 * 退出码: 0 全通过 / 1 有用例失败
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var S = require('./lib/schema.js');
var CA = require('./lib/cross_analysis.js');

var ROOT = path.join(__dirname, '..');
var SAMPLE = path.join(ROOT, 'output', 'samples', 'sample-audit.json');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

if (!fs.existsSync(SAMPLE)) {
  console.error('样本夹具缺失: ' + SAMPLE);
  process.exit(1);
}

var report = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
var outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-smoke-'));
var keep = process.argv.indexOf('--keep') >= 0;

console.log('\n夹具: ' + path.relative(ROOT, SAMPLE) +
  '  （' + report.meta.brand + ' · ' + report.meta.category + '）');
if (report._sample) console.log('  ⚠ ' + report._sample.warning);
console.log('产物目录: ' + outDir + (keep ? '（保留）' : '\n'));

/* ── 1. schema 校验 ── */
console.log('\n[1] 合并报告 schema 校验');
var vr = S.validateReport(report);
ok('无 error', vr.errors.length === 0, vr.errors.slice(0, 3).map(function (e) { return e.path + ': ' + e.msg; }).join(' | '));
if (vr.warnings.length) {
  console.log('  ! 警告 ' + vr.warnings.length + ' 处（不阻断）:');
  vr.warnings.slice(0, 5).forEach(function (w) { console.log('      ' + w.path + ' — ' + w.msg); });
}

/* ── 2. 交叉分析：有阶段5 ── */
console.log('\n[2] 交叉分析 — 有阶段5（SOCIAL + HOTSEARCH）');
var cross = CA.crossAnalyze(report);
ok('available = true', cross.available === true);
ok('三源全部有数据', cross.sources.visibility && cross.sources.social && cross.sources.hotsearch);
ok('叙事鸿沟可计算', typeof cross.narrativeGap.gap === 'number', 'gap=' + cross.narrativeGap.gap);
ok('三源落象限', !!cross.threeSource.quadrant, cross.threeSource.quadrantLabel);
ok('危机通道数为 3', cross.crisis.channels.length === 3);
ok('危机可信度 100%', cross.crisis.confidence === 100, '实际 ' + cross.crisis.confidence);
ok('竞品并集非空', cross.competitorUnion.length > 0, cross.competitorUnion.length + ' 个');
console.log('      鸿沟 ' + cross.narrativeGap.gap + '（' + cross.narrativeGap.verdictLabel + '） · ' +
  cross.threeSource.quadrantLabel + ' · 危机 ' + cross.crisis.score + '（' + cross.crisis.levelLabel + '）');

/* ── 3. 交叉分析：无阶段5（降级路径） ── */
console.log('\n[3] 交叉分析 — 无阶段5（降级，不得估算）');
var stripped = JSON.parse(JSON.stringify(report));
delete stripped.stages.SOCIAL;
delete stripped.stages.HOTSEARCH;
// 必须重算：cross 是 merge 时由 stages 派生的，改了 stages 就得重新派生，
// 否则会留下过期的交叉分析结果（真实流水线里 merge-stages.js 就是这个顺序）。
stripped.cross = CA.crossAnalyze(stripped);
var cross2 = stripped.cross;
ok('available = false', cross2.available === false);
ok('社媒指数为 null（不补 0）', cross2.threeSource.socialIndex === null);
ok('热搜指数为 null（不补 0）', cross2.threeSource.hotIndex === null);
ok('叙事鸿沟为 null', cross2.narrativeGap.gap === null);
ok('叙事鸿沟判定为数据不足', cross2.narrativeGap.verdict === 'insufficient');
ok('不落象限', cross2.threeSource.quadrant === null);
ok('危机可信度 < 100', cross2.crisis.confidence < 100, '实际 ' + cross2.crisis.confidence);

/* ── 渲染辅助 ──
 * 重要：报告是「静态注入数据 + 浏览器端 JS 渲染」—— #app 初始为空，
 * 所有 DOM 在运行时才生成。因此静态 HTML 里：
 *   · 永远找不到渲染后的 <a> 标签（还没渲染）
 *   · 永远能找到模板源码里的中文串（无论数据如何）
 * 所以 DOM 层面的断言必须在数据层做：校验注入的数据契约，
 * 它决定了浏览器会渲染出什么。DOM 渲染本身已在浏览器里人工验证过。
 */
function injectedData(htmlFile) {
  var h = fs.readFileSync(htmlFile, 'utf8');
  var m = h.match(/window\.__AUDIT__\s*=\s*([\s\S]*?);\s*<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

/* ── 4. 渲染 HTML + Markdown ── */
console.log('\n[4] 渲染');
function run(script, args) {
  var cp = require('child_process').spawnSync(
    process.execPath, [path.join(ROOT, 'scripts', script)].concat(args),
    { encoding: 'utf8' }
  );
  return { code: cp.status, out: (cp.stdout || '') + (cp.stderr || '') };
}

var htmlOut = path.join(outDir, 'sample-report.html');
var r1 = run('build-report.js', [SAMPLE, htmlOut]);
ok('build-report 退出码 0', r1.code === 0, r1.out.trim().slice(0, 200));
if (fs.existsSync(htmlOut)) {
  var html = fs.readFileSync(htmlOut, 'utf8');
  ok('HTML 非空', html.length > 10000, html.length + ' 字节');
  ok('HTML 已注入数据（占位符被替换）', html.indexOf('__GEO_AUDIT_DATA__') < 0);
  ok('HTML 含客户端渲染入口', html.indexOf('id="app"') >= 0);

  // 数据层断言：这些字段决定浏览器会渲染出什么
  var inj = injectedData(htmlOut);
  ok('注入的数据可解析', !!inj);
  if (inj) {
    ok('注入数据含 SOCIAL', !!(inj.stages && inj.stages.SOCIAL));
    ok('注入数据含 HOTSEARCH', !!(inj.stages && inj.stages.HOTSEARCH));
    ok('cross.available = true', !!(inj.cross && inj.cross.available));
    ok('cross 含 crisis 三通道', !!(inj.cross && inj.cross.crisis && inj.cross.crisis.channels.length === 3));
    var posts = (inj.stages && inj.stages.SOCIAL && inj.stages.SOCIAL.posts) || [];
    ok('社媒样本全部带 url（渲染后即可点击）',
      posts.length > 0 && posts.every(function (p) { return !!p.url; }),
      posts.filter(function (p) { return !p.url; }).length + ' 条缺 url');
  }
}

var mdOut = path.join(outDir, 'sample-execution.md');
var r2 = run('build-markdown.js', [SAMPLE, mdOut]);
ok('build-markdown 退出码 0', r2.code === 0, r2.out.trim().slice(0, 200));
if (fs.existsSync(mdOut)) {
  var md = fs.readFileSync(mdOut, 'utf8');
  ok('MD 非空', md.length > 5000, md.length + ' 字节');
  ok('MD 含多源交叉分析', md.indexOf('## 多源交叉分析') >= 0);
  ok('MD 含叙事鸿沟', md.indexOf('### 叙事鸿沟') >= 0);
  ok('MD 含三源矩阵', md.indexOf('### 三源可见度矩阵') >= 0);
  ok('MD 含危机三通道', md.indexOf('### 危机三通道') >= 0);
  ok('MD 帖子标题为可点击链接', /\[.+\]\(https:\/\/example\.com\/.+\)/.test(md));
}

/* ── 5. 降级渲染（抽掉阶段5 后仍能出报告） ── */
console.log('\n[5] 降级渲染 — 无阶段5 时报告仍完整');
var strippedPath = path.join(outDir, 'stripped.json');
fs.writeFileSync(strippedPath, JSON.stringify(stripped), 'utf8');
var html2 = path.join(outDir, 'stripped-report.html');
run('build-report.js', [strippedPath, html2]);
if (fs.existsSync(html2)) {
  var h2 = fs.readFileSync(html2, 'utf8');
  ok('降级 HTML 能生成', h2.length > 10000);
  var inj2 = injectedData(html2);
  ok('降级数据可解析', !!inj2);
  if (inj2) {
    // 降级时数据层必须明确标记"未采集"，模板据此渲染留白分支而非估算值
    ok('降级数据无 SOCIAL', !inj2.stages.SOCIAL);
    ok('降级数据无 HOTSEARCH', !inj2.stages.HOTSEARCH);
    ok('降级数据 cross.available = false', inj2.cross && inj2.cross.available === false);
    ok('降级数据社媒指数为 null', inj2.cross && inj2.cross.threeSource.socialIndex === null);
    ok('降级不含任何社媒样本', !((inj2.stages || {}).SOCIAL || {}).posts);
  }
}

/* ── 汇总 ── */
console.log('\n' + '─'.repeat(52));
console.log('通过 ' + pass + ' · 失败 ' + fail);
if (!keep) {
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) {}
}
if (fail === 0) {
  console.log('✓ 全部通过');
  process.exit(0);
} else {
  console.log('✗ 存在失败用例');
  process.exit(1);
}
