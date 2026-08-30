#!/usr/bin/env node
'use strict';

/**
 * geo-brand-audit — 阶段 JSON 校验器
 *
 * 用法:
 *   node validate.js <stage-file>           校验单个阶段文件
 *   node validate.js --dir <output-dir>     校验目录下所有 stage*.json
 *   node validate.js --report <merged.json> 校验合并后的完整报告
 *
 * 退出码:
 *   0 — 通过（可能含 warning）
 *   1 — 存在 error
 *   2 — 文件读取/解析失败
 */

var fs = require('fs');
var path = require('path');
var S = require('./lib/schema.js');

var args = process.argv.slice(2);

function die(msg, code) {
  console.error(msg);
  process.exit(code === undefined ? 2 : code);
}

function readJson(p) {
  var abs = path.resolve(p);
  if (!fs.existsSync(abs)) die('文件不存在: ' + abs, 2);
  var raw;
  try { raw = fs.readFileSync(abs, 'utf8'); }
  catch (e) { die('读取失败: ' + abs + ' — ' + e.message, 2); }
  try { return JSON.parse(raw); }
  catch (e) { die('JSON 解析失败: ' + abs + ' — ' + e.message, 2); }
}

function print(title, result) {
  var ok = true;
  console.log('\n── ' + title + ' ──');
  if (!result.errors.length && !result.warnings.length) {
    console.log('  ✓ 通过');
    return true;
  }
  if (result.errors.length) {
    ok = false;
    console.log('  ✗ 错误 ' + result.errors.length + ' 处:');
    result.errors.slice(0, 40).forEach(function (e) {
      console.log('    [E] ' + e.path + ' — ' + e.msg);
    });
    if (result.errors.length > 40) console.log('    ... 其余 ' + (result.errors.length - 40) + ' 处省略');
  }
  if (result.warnings.length) {
    console.log('  ! 警告 ' + result.warnings.length + ' 处:');
    result.warnings.slice(0, 20).forEach(function (w) {
      console.log('    [W] ' + w.path + ' — ' + w.msg);
    });
  }
  return ok;
}

var mode = 'file';
var target = args[0];

if (args[0] === '--dir') { mode = 'dir'; target = args[1]; }
else if (args[0] === '--report') { mode = 'report'; target = args[1]; }

if (!target) {
  die('用法: node validate.js <stage-file> | --dir <output-dir> | --report <merged.json>', 2);
}

var allOk = true;

if (mode === 'file') {
  var obj = readJson(target);
  // 单文件可能是 { PROFILE: {...}, COMPETITORS: {...} } 形式
  // 约定：下划线开头的顶层键（如 _note）为元数据/注释，不参与 stage 识别
  var keys = Object.keys(obj).filter(function (k) { return k.indexOf('_') !== 0; });
  var isStageMap = keys.length > 0 && keys.every(function (k) { return S.ALL_STAGE_CODES.indexOf(k) >= 0; });
  if (!isStageMap) {
    die('无法识别为 stage 文件：顶层 key 应为 stageCode（如 PROFILE / ASSET / SCORE）。\n' +
        '若校验合并报告请用 --report。', 2);
  }
  keys.forEach(function (code) {
    allOk = print(code, S.validateStage(code, obj[code])) && allOk;
  });

} else if (mode === 'dir') {
  var dir = path.resolve(target);
  if (!fs.existsSync(dir)) die('目录不存在: ' + dir, 2);
  S.STAGE_FILES.forEach(function (sf) {
    var f = path.join(dir, sf.file);
    if (!fs.existsSync(f)) {
      console.log('\n── ' + sf.file + '（阶段' + sf.n + ' ' + sf.title + '）──');
      console.log('  · 未生成（阶段未完成）');
      return;
    }
    var obj = readJson(f);
    sf.codes.forEach(function (code) {
      if (!obj[code]) {
        allOk = print(sf.file + ' → ' + code, { errors: [{ path: code, msg: '缺失该 stage' }], warnings: [] }) && allOk;
        return;
      }
      allOk = print(sf.file + ' → ' + code, S.validateStage(code, obj[code])) && allOk;
    });
  });

} else {
  var report = readJson(target);
  if (!report.stages) die('该文件不是合并报告（缺少 stages 字段）', 2);
  S.ALL_STAGE_CODES.forEach(function (code) {
    if (!report.stages[code]) return;
    var r = S.validateStage(code, report.stages[code]);
    if (r.errors.length || r.warnings.length) {
      allOk = print('stages.' + code, r) && allOk;
    }
  });
  allOk = print('报告级一致性', S.validateReport(report)) && allOk;
}

console.log('');
if (allOk) {
  console.log('✓ 校验通过');
  process.exit(0);
} else {
  console.log('✗ 存在错误，请先修复后再合并/渲染');
  process.exit(1);
}
