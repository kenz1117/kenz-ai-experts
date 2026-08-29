#!/usr/bin/env node
'use strict';

/**
 * geo-brand-audit — HTML 汇报版构建
 *
 * 用法:
 *   node build-report.js <audited-json> [output-html]
 *
 * 说明:
 *   读取 assets/report-template.html，把审计数据以 <script> 形式注入，
 *   渲染逻辑全部在模板内的原生 JS 中完成。零外部依赖、单文件可分发。
 *
 * 退出码:
 *   0 — 成功
 *   2 — 文件缺失 / JSON 解析失败 / 模板缺失
 */

var fs = require('fs');
var path = require('path');

var TEMPLATE = path.join(__dirname, '..', 'assets', 'report-template.html');
var PLACEHOLDER = '/*__GEO_AUDIT_DATA__*/null';

var args = process.argv.slice(2);
if (args.length < 1) {
  console.error('用法: node build-report.js <audited-json> [output-html]');
  process.exit(2);
}

var jsonPath = path.resolve(args[0]);
var outputPath = args[1]
  ? path.resolve(args[1])
  : jsonPath.replace(/\.json$/i, '') + '-report.html';

if (!fs.existsSync(jsonPath)) { console.error('JSON 不存在: ' + jsonPath); process.exit(2); }
if (!fs.existsSync(TEMPLATE)) { console.error('模板缺失: ' + TEMPLATE); process.exit(2); }

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

var template = fs.readFileSync(TEMPLATE, 'utf8');

if (template.indexOf(PLACEHOLDER) < 0) {
  console.error('模板缺少数据占位符: ' + PLACEHOLDER);
  process.exit(2);
}

// 注入数据。转义 </script> 与 U+2028/2029，避免破坏 script 上下文。
var dataStr = JSON.stringify(report)
  .replace(/<\/script/gi, '<\\/script')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

var html = template.replace(PLACEHOLDER, dataStr);

try {
  fs.writeFileSync(outputPath, html, 'utf8');
} catch (e) {
  console.error('写入失败: ' + e.message);
  process.exit(2);
}

console.log('✓ HTML 汇报版已生成: ' + outputPath);
console.log('  ' + (fs.statSync(outputPath).size / 1024).toFixed(1) + ' KB  ·  单文件，可直接双击打开或分发');

process.exit(0);
