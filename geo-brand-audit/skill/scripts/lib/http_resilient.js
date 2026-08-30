#!/usr/bin/env node
'use strict';

/**
 * geo-brand-audit — 采集韧性库（零依赖）
 *
 * 供未来接入 API 驱动的采集引擎使用。解决的是「批量打外部接口」时
 * 必然会遇到的四件事，与业务逻辑无关，所以单独抽出来：
 *
 *   1. 并发受限的批量提交      —— 不把对端打爆，也不让总耗时失控
 *   2. 指数退避 + 抖动重试     —— 瞬时故障自己恢复，不惊动调用方
 *   3. 限流识别               —— 429 / 业务限流码要能认出来并放慢
 *   4. 四态失败模型           —— completed / failed / timeout / submit_failed
 *   5. compact + dataFile     —— 大数据落盘，只把指针带回来，避免上下文截断
 *
 * 为什么需要第 4 条：把失败笼统记成 "error"，调用方就无法区分
 * 「对端拒绝」「网络超时」「请求没发出去」—— 这三种的处置完全不同。
 *
 * 只用 Node 内置模块（http / https / fs / path），无 npm 依赖。
 */

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var { URL } = require('url');

/* ── 四态失败模型 ────────────────────────────────────────── */
var STATE = {
  COMPLETED: 'completed',        // 成功拿到响应
  FAILED: 'failed',              // 拿到响应但非 2xx（重试后仍失败）
  TIMEOUT: 'timeout',            // 超时（重试后仍失败）
  SUBMIT_FAILED: 'submit_failed' // 请求根本没发出去（DNS / 连接被拒 / 参数错误）
};

var DEFAULTS = {
  timeout: 30000,        // 单次请求超时 ms
  retries: 2,            // 额外重试次数（不含首次）
  backoffBase: 500,      // 退避基数 ms
  backoffFactor: 2,      // 退避倍数
  backoffMax: 8000,      // 单次退避上限 ms
  jitter: true,          // 退避加抖动，避免多请求同时重试
  concurrency: 3,        // 批量并发上限
  retryOn: [429, 500, 502, 503, 504], // 这些状态码才重试，4xx 业务错误不重试
  rateLimitCodes: [429]  // HTTP 层限流码
};

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/**
 * 指数退避 + 抖动。第 n 次重试等待 base * factor^n，上限 backoffMax。
 */
function backoffDelay(attempt, cfg) {
  var d = Math.min(cfg.backoffMax, cfg.backoffBase * Math.pow(cfg.backoffFactor, attempt));
  if (cfg.jitter) d = d * (0.5 + Math.random() * 0.5); // 50%-100% 抖动
  return Math.round(d);
}

/**
 * 判断响应体是否命中「业务层限流码」。
 * 很多国内接口返回 200 但 body 里带错误码（如 {"code":3108,"msg":"触发限流"}），
 * 只认 HTTP 429 会漏掉这一类。默认按 body 中的 code 字段匹配。
 */
function defaultRateLimitCheck(status, bodyText, cfg) {
  if (cfg.rateLimitCodes.indexOf(status) >= 0) return true;
  if (!bodyText) return false;
  try {
    var o = JSON.parse(bodyText);
    if (o && (o.code !== undefined || o.errcode !== undefined)) {
      var code = Number(o.code !== undefined ? o.code : o.errcode);
      return cfg.businessRateLimitCodes.indexOf(code) >= 0;
    }
  } catch (e) { /* 非 JSON，忽略 */ }
  return false;
}

/**
 * 单个 HTTP 请求，带超时、重试、退避、限流识别。
 *
 * @param {Object} opts
 *   url          目标地址（必填）
 *   method       默认 GET
 *   headers      请求头
 *   body         请求体（字符串或对象，对象会 JSON 序列化）
 *   timeout      覆盖默认超时
 *   retries      覆盖默认重试次数
 *   businessRateLimitCodes  业务层限流码数组，如 [3108]
 * @returns {Promise<{ok, state, status, body, error, attempts}>}
 */
function request(opts) {
  var cfg = Object.assign({}, DEFAULTS, opts || {});
  cfg.businessRateLimitCodes = cfg.businessRateLimitCodes || [];

  var url = cfg.url;
  if (!url) return Promise.resolve({ ok: false, state: STATE.SUBMIT_FAILED, error: '缺少 url', attempts: 0 });

  var attempts = 0;
  var maxAttempts = cfg.retries + 1;

  function once() {
    attempts++;
    return new Promise(function (resolve) {
      var u;
      try { u = new URL(url); }
      catch (e) { return resolve({ ok: false, state: STATE.SUBMIT_FAILED, error: 'URL 非法: ' + e.message }); }

      var mod = u.protocol === 'https:' ? https : http;
      var payload = null;
      if (cfg.body !== undefined && cfg.body !== null) {
        payload = typeof cfg.body === 'string' ? cfg.body : JSON.stringify(cfg.body);
      }

      var headers = Object.assign({}, cfg.headers || {});
      if (payload && !headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

      var settled = false;
      var req = mod.request({
        protocol: u.protocol, hostname: u.hostname, port: u.port,
        path: u.pathname + u.search, method: cfg.method || (payload ? 'POST' : 'GET'),
        headers: headers
      }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          var text = Buffer.concat(chunks).toString('utf8');
          var status = res.statusCode || 0;
          var limited = defaultRateLimitCheck(status, text, cfg);
          // 关键：HTTP 200 但 body 带业务限流码，等于**没拿到数据**。
          // 采集视角下必须判为失败，否则既不会重试，也会被误记成成功。
          var success = status >= 200 && status < 300 && !limited;
          resolve({
            ok: success,
            state: success ? STATE.COMPLETED : STATE.FAILED,
            status: status,
            body: text,
            rateLimited: limited,
            attempts: attempts
          });
        });
      });

      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { req.destroy(); } catch (e) {}
        resolve({ ok: false, state: STATE.TIMEOUT, error: '超时 ' + cfg.timeout + 'ms', attempts: attempts });
      }, cfg.timeout);

      req.on('error', function (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, state: STATE.SUBMIT_FAILED, error: e.message, attempts: attempts });
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  function attemptLoop() {
    return once().then(function (r) {
      var shouldRetry =
        !r.ok &&
        attempts < maxAttempts &&
        (r.state === STATE.TIMEOUT ||                       // 超时一律重试
         r.state === STATE.SUBMIT_FAILED ||                 // 连接层失败重试
         (r.state === STATE.FAILED &&                        // HTTP 错误：只对白名单状态码重试
          (cfg.retryOn.indexOf(r.status) >= 0 || r.rateLimited)));

      if (!shouldRetry) return r;
      return sleep(backoffDelay(attempts - 1, cfg)).then(attemptLoop);
    });
  }

  return attemptLoop();
}

/**
 * 并发受限的批量执行。
 *
 * worker 抛错会被捕获为 submit_failed，不会中断整批。
 *
 * @param {Array} items      任务输入
 * @param {Function} worker  (item, index) => Promise<任意结果>
 * @param {Object} opts      concurrency / onProgress
 * @returns {Promise<{results:Array, stats:Object}>}
 *          results[i] = { index, state, data, error, rateLimited }
 */
function runBatch(items, worker, opts) {
  var cfg = Object.assign({}, DEFAULTS, opts || {});
  var list = items || [];
  var results = new Array(list.length);
  var cursor = 0;
  var running = 0;

  return new Promise(function (resolve) {
    if (!list.length) {
      return resolve({ results: results, stats: tally(results) });
    }

    function next() {
      if (cursor >= list.length) {
        if (running === 0) resolve({ results: results, stats: tally(results) });
        return;
      }
      var i = cursor++;
      running++;
      Promise.resolve()
        .then(function () { return worker(list[i], i); })
        .then(function (data) {
          results[i] = { index: i, state: STATE.COMPLETED, data: data };
        })
        .catch(function (e) {
          // worker 自己抛的错 = 提交层失败；若它返回了带 state 的对象则沿用其判定
          results[i] = (e && e.state)
            ? Object.assign({ index: i }, e)
            : { index: i, state: STATE.SUBMIT_FAILED, error: (e && e.message) || String(e) };
        })
        .then(function () {
          running--;
          if (cfg.onProgress) cfg.onProgress(cursor, list.length);
          next();
        });
    }

    var n = Math.max(1, Math.min(cfg.concurrency, list.length));
    for (var k = 0; k < n; k++) next();
  });
}

function tally(results) {
  var t = { total: results.length, completed: 0, failed: 0, timeout: 0, submit_failed: 0, unknown: 0 };
  (results || []).forEach(function (r) {
    if (!r) { t.unknown++; return; }
    if (t[r.state] === undefined) t.unknown++;
    else t[r.state]++;
  });
  return t;
}

/**
 * compact + dataFile：把全量数据落盘，只回传摘要与文件路径。
 *
 * 解决的问题：批量采集的结果直接塞回对话会撑爆上下文、或被截断成半个 JSON。
 * 落盘后只带指针，需要详情时再按行读取。
 *
 * @param {*} full         全量数据
 * @param {Object} opts    { dir, name } —— dir 为落盘目录，name 为文件名（不含扩展名）
 * @param {Function} summarize  (full) => 摘要对象（可选）
 * @returns {{summary:Object, dataFile:String|null}}
 */
function compact(full, opts, summarize) {
  var o = opts || {};
  var summary = summarize ? summarize(full) : defaultSummarize(full);
  var dataFile = null;
  if (o.dir && o.name) {
    try {
      if (!fs.existsSync(o.dir)) fs.mkdirSync(o.dir, { recursive: true });
      dataFile = path.join(o.dir, o.name + '.json');
      fs.writeFileSync(dataFile, JSON.stringify(full, null, 2), 'utf8');
      summary.dataFile = dataFile;
      summary.dataBytes = fs.statSync(dataFile).size;
    } catch (e) {
      summary.dataFileError = e.message;
    }
  }
  return { summary: summary, dataFile: dataFile };
}

function defaultSummarize(full) {
  var arr = Array.isArray(full) ? full : (full && Array.isArray(full.items) ? full.items : null);
  var s = { count: arr ? arr.length : 1, truncated: true };
  if (arr) {
    // 只带前 3 条预览，避免摘要本身过大
    s.preview = arr.slice(0, 3);
    s.note = '仅预览前 3 条，全量见 dataFile';
  }
  return s;
}

module.exports = {
  STATE: STATE,
  DEFAULTS: DEFAULTS,
  request: request,
  runBatch: runBatch,
  compact: compact,
  tally: tally,
  backoffDelay: backoffDelay
};

/* ── CLI 自检 ──────────────────────────────────────────────
 * 用本地 HTTP 服务模拟四种结局，验证韧性行为确实生效。
 *   node http_resilient.js
 */
if (require.main === module) {
  (function selfTest() {
    var hits = { ok: 0, flaky: 0, limited: 0, slow: 0 };
    var server = http.createServer(function (req, res) {
      if (req.url === '/ok') {
        hits.ok++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.url === '/flaky') {
        hits.flaky++;
        if (hits.flaky < 3) { res.writeHead(500); return res.end('boom'); }  // 前两次失败
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, after: hits.flaky }));
      }
      if (req.url === '/limited') {
        hits.limited++;
        // 典型国内接口风格：HTTP 200 + body 里带业务限流码
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ code: 3108, msg: '触发限流' }));
      }
      if (req.url === '/slow') {
        hits.slow++;
        setTimeout(function () { res.writeHead(200); res.end('late'); }, 3000);
        return;
      }
      res.writeHead(404); res.end('nf');
    });

    server.listen(0, '127.0.0.1', function () {
      var base = 'http://127.0.0.1:' + server.address().port;
      var pass = 0, fail = 0;
      function ok(n, c, d) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } }

      console.log('\n[http_resilient 自检] 本地服务 ' + base);

      Promise.all([
        request({ url: base + '/ok', timeout: 5000 }),
        request({ url: base + '/flaky', timeout: 5000, retries: 3, backoffBase: 20 }),
        request({ url: base + '/limited', timeout: 5000, retries: 1, backoffBase: 20,
                  businessRateLimitCodes: [3108] }),
        request({ url: base + '/slow', timeout: 300, retries: 0 }),
        request({ url: 'http://127.0.0.1:1/nope', timeout: 1000, retries: 0 }),
        request({ url: 'not-a-url', timeout: 1000 })
      ]).then(function (rs) {
        console.log('\n[1] 单请求四态');
        ok('成功 -> completed', rs[0].state === STATE.COMPLETED, rs[0].state);
        ok('重试后成功 -> completed', rs[1].state === STATE.COMPLETED, rs[1].state);
        ok('重试确实发生了（attempts>=3）', rs[1].attempts >= 3, 'attempts=' + rs[1].attempts);
        ok('业务限流码被识别', rs[2].rateLimited === true);
        ok('限流后 -> failed', rs[2].state === STATE.FAILED, rs[2].state);
        ok('超时 -> timeout', rs[3].state === STATE.TIMEOUT, rs[3].state);
        ok('连接被拒 -> submit_failed', rs[4].state === STATE.SUBMIT_FAILED, rs[4].state);
        ok('URL 非法 -> submit_failed', rs[5].state === STATE.SUBMIT_FAILED, rs[5].state);

        console.log('\n[2] 批量并发 + 四态统计');
        var items = ['/ok', '/ok', '/slow', '/nope404', '/ok', '/flaky'];
        return runBatch(items, function (u) {
          return request({ url: base + u, timeout: 400, retries: 0 }).then(function (r) {
            if (!r.ok) { var e = new Error(r.error || ('HTTP ' + r.status)); e.state = r.state; throw e; }
            return r.body;
          });
        }, { concurrency: 3 }).then(function (out) {
          ok('结果数与输入一致', out.results.length === items.length);
          ok('统计含 completed', out.stats.completed >= 3, JSON.stringify(out.stats));
          ok('统计含 timeout', out.stats.timeout >= 1, JSON.stringify(out.stats));
          ok('统计含 failed', out.stats.failed >= 1, JSON.stringify(out.stats));
          console.log('      统计 ' + JSON.stringify(out.stats));

          console.log('\n[3] compact + dataFile 防截断');
          var tmp = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'geo-res-'));
          var big = { items: [] };
          for (var i = 0; i < 500; i++) big.items.push({ i: i, text: 'x'.repeat(200) });
          var c = compact(big, { dir: tmp, name: 'sample' }, function (d) {
            return { count: d.items.length };
          });
          ok('落盘成功', !!c.dataFile && fs.existsSync(c.dataFile));
          ok('摘要只带预览（防截断）', c.summary.count === 500 && Object.keys(c.summary).length < 10);
          ok('全量在文件里', c.summary.dataBytes > 50000, c.summary.dataBytes + ' 字节');
          fs.rmSync(tmp, { recursive: true, force: true });
        });
      }).then(function () {
        server.close();
        console.log('\n' + '─'.repeat(46));
        console.log('通过 ' + pass + ' · 失败 ' + fail);
        process.exit(fail === 0 ? 0 : 1);
      }).catch(function (e) {
        server.close();
        console.error('自检异常:', e);
        process.exit(1);
      });
    });
  })();
}
