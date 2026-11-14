#!/usr/bin/env node
// 本地 Linux 优化前后对比：隔离数据、慢 Java 候选、真实 HTTP 功能矩阵与延迟/吞吐测量。
// 用 /usr/bin/node 运行；绝不触碰真实账号 token，也不改写真实实例目录。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const REAL = process.env.LYCOMC_REAL_DATA || path.join(os.homedir(), '.local/share/lycomc');
const PERF = process.env.LYCOMC_BENCH_OUT || path.join(os.homedir(), '.cache/lycomc-perf/compare');
const BASELINE = process.env.LYCOMC_BENCH_BASELINE;
const OPTIMIZED = process.env.LYCOMC_BENCH_OPTIMIZED;
const PORT_BASE = Number(process.env.LYCOMC_BENCH_PORT || '9510');
const SLOW_SECONDS = Number(process.env.LYCOMC_BENCH_SLOW_SECONDS || '5');
if (!BASELINE || !OPTIMIZED) {
  console.error('用法: LYCOMC_BENCH_BASELINE=<旧二进制> LYCOMC_BENCH_OPTIMIZED=<新二进制> /usr/bin/node scripts/compare-binaries.mjs');
  process.exit(2);
}
if (!fs.existsSync(BASELINE) || !fs.existsSync(OPTIMIZED)) throw new Error('对比二进制不存在');
fs.mkdirSync(PERF, { recursive: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const r3 = (x) => Math.round(x * 1000) / 1000;
const pct = (a, b) => a > 0 ? r3((a - b) / a * 100) : null;
const ratio = (a, b) => b > 0 ? r3(a / b) : null;
function percentile(values, q) {
  const a = [...values].sort((x, y) => x - y);
  if (a.length === 0) return null;
  return a[Math.min(a.length - 1, Math.ceil(q * a.length) - 1)];
}
function processAlive(pid) {
  try {
    const s = cp.execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return s !== '' && !s.startsWith('Z');
  } catch { return false; }
}
function readRss(pid) {
  try {
    const kb = Number(cp.execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim());
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch { return null; }
}
function realDataHashes() {
  const files = ['settings.json', 'accounts.json', 'web.port', 'versions/1.20.1/options.txt', 'versions/fabric-loader-0.20.1-1.20.1/options.txt'];
  const out = {};
  for (const f of files) {
    const p = path.join(REAL, f);
    if (fs.existsSync(p)) out[f] = sha(p);
  }
  return out;
}
function prepare(label, binary, port) {
  const out = path.join(PERF, label);
  const data = path.join(out, 'data');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(data, 'versions'), { recursive: true });
  for (const id of ['1.20.1', 'fabric-loader-0.20.1-1.20.1']) {
    const src = path.join(REAL, 'versions', id);
    const dst = path.join(data, 'versions', id);
    cp.execFileSync('cp', ['-a', src, dst], { stdio: 'ignore' });
  }
  for (const name of ['libraries', 'assets']) {
    fs.symlinkSync(path.join(REAL, name), path.join(data, name), 'dir');
  }
  for (const name of ['java', 'logs', 'cache']) fs.mkdirSync(path.join(data, name), { recursive: true });
  const fakeJava = path.join(out, 'fake-java.sh');
  const args = path.join(out, 'fake-java-args.txt');
  const fakeBody = '#!/usr/bin/env bash\nset -eo pipefail\nif [ "$1" = "-version" ]; then\n  printf \'openjdk version "17.0.20.1" 2026-08-18\\n\' >&2\n  exit 0\nfi\n: > "' + args + '"\nprintf \'%s\\n\' "$@" >> "' + args + '"\nexit 0\n';
  fs.writeFileSync(fakeJava, fakeBody);
  fs.chmodSync(fakeJava, 0o755);
  const slowHome = path.join(out, 'slowjdk');
  const slowBin = path.join(slowHome, 'bin');
  fs.mkdirSync(slowBin, { recursive: true });
  const slowBody = '#!/usr/bin/env sh\nif [ "$1" = "-version" ]; then\n  sleep ' + String(SLOW_SECONDS) + '\nfi\nexit 0\n';
  fs.writeFileSync(path.join(slowBin, 'java'), slowBody);
  fs.chmodSync(path.join(slowBin, 'java'), 0o755);
  const accounts = [{ name: 'Steve', uuid: '5627dd98-e6be-3c21-b8a8-e92344183641', kind: 'offline' }];
  fs.writeFileSync(path.join(data, 'accounts.json'), JSON.stringify(accounts, null, 2) + '\n');
  fs.chmodSync(path.join(data, 'accounts.json'), 0o600);
  const settings = {
    memoryMb: 6144,
    javaPath: fakeJava,
    extraJvmArgs: ['-XX:+UseG1GC'],
    selectVersion: '1.20.1',
    downloadSource: 'bmcl',
    maxConcurrent: 16,
    closeOnLaunch: false,
    gameLang: 'zh_cn',
    defaultAccount: 'Steve',
    quickPlayServer: null,
  };
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  const env = {
    ...process.env,
    HOME: os.homedir(),
    LYCOMC_PORT: String(port),
    LYCOMC_NO_OPEN: '1',
    LYCOMC_DATA_DIR: data,
    JAVA_HOME: slowHome,
    PATH: slowBin + ':/usr/bin:/bin',
    TMPDIR: process.env.TMPDIR || path.join(os.homedir(), '.cache/lycomc-web-tmp'),
  };
  return { label, out, data, env, port, binary, fakeJava, args, slowHome };
}
async function startServer(ctx) {
  const logFd = fs.openSync(path.join(ctx.out, 'server.log'), 'w');
  const child = cp.spawn(ctx.binary, [], { cwd: ROOT, env: ctx.env, detached: true, stdio: ['ignore', logFd, logFd] });
  ctx.child = child;
  ctx.logFd = logFd;
  for (let i = 0; i < 80; i++) {
    const portFile = path.join(ctx.data, 'web.port');
    const actual = fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8').trim() : String(ctx.port);
    const base = 'http://127.0.0.1:' + actual;
    try {
      const r = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        const health = await r.json();
        if (health && health.name === 'lycomc') {
          ctx.base = base;
          ctx.actualPort = Number(actual);
          ctx.health = health;
          return ctx;
        }
      }
    } catch {}
    await delay(250);
  }
  throw new Error(ctx.label + ' 服务启动超时，见 ' + path.join(ctx.out, 'server.log'));
}
async function stopServer(ctx) {
  const pid = ctx.child && ctx.child.pid;
  if (pid) {
    try { process.kill(-pid, 'SIGTERM'); } catch {}
    for (let i = 0; i < 40 && processAlive(pid); i++) await delay(200);
    try { process.kill(-pid, 'SIGKILL'); } catch {}
    for (let i = 0; i < 20 && processAlive(pid); i++) await delay(200);
  }
  try { fs.closeSync(ctx.logFd); } catch {}
  const ps = cp.execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  const stray = ps.split('\n').filter((l) => l.includes(ctx.out) && (l.includes('slowjdk') || l.includes('fake-java.sh') || l.includes(ctx.binary)));
  return { pid, serverAlive: pid ? processAlive(pid) : false, stray };
}
async function req(ctx, p, init) {
  const options = { ...(init || {}), signal: (init && init.signal) || AbortSignal.timeout(30000) };
  const r = await fetch(ctx.base + p, options);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: r.status, body, headers: r.headers };
}
async function put(ctx, patch) {
  const r = await req(ctx, '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  if (r.status !== 200) throw new Error('PUT /api/settings 失败 ' + r.status + ' ' + JSON.stringify(r.body));
  return r.body;
}
async function timed(fn) {
  const t = process.hrtime.bigint();
  const value = await fn();
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, value };
}
async function measurePerformance(ctx) {
  const stateSamples = [];
  for (let i = 0; i < 5; i++) {
    const t = await timed(() => req(ctx, '/api/state'));
    stateSamples.push({ label: i === 0 ? 'cold' : 'warm-' + i, ms: r3(t.ms), status: t.value.status, javas: Array.isArray(t.value.body.javas) ? t.value.body.javas.length : null });
  }
  const stateMs = stateSamples.map((x) => x.ms);
  const parallelStart = process.hrtime.bigint();
  const parallelState = await Promise.all(Array.from({ length: 8 }, () => req(ctx, '/api/state')));
  const stateParallelMs = r3(Number(process.hrtime.bigint() - parallelStart) / 1e6);
  const home = await (await fetch(ctx.base + '/')).text();
  if (!home.includes('/assets/')) throw new Error('首页没有 assets 引用');
  const asset = '/assets/' + home.split('/assets/')[1].split('"')[0];
  const localAsset = path.join(ROOT, 'web/dist', asset.slice(1));
  const assetBytes = fs.existsSync(localAsset) ? fs.statSync(localAsset).size : null;
  for (let i = 0; i < 2; i++) await (await fetch(ctx.base + asset)).arrayBuffer();
  const staticSamples = [];
  for (let i = 0; i < 24; i++) {
    const t = await timed(async () => {
      const r = await fetch(ctx.base + asset);
      const b = Buffer.from(await r.arrayBuffer());
      return { status: r.status, bytes: b.length };
    });
    staticSamples.push({ ms: r3(t.ms), status: t.value.status, bytes: t.value.bytes });
  }
  const staticMs = staticSamples.map((x) => x.ms);
  const staticParallelStart = process.hrtime.bigint();
  const staticParallel = await Promise.all(Array.from({ length: 16 }, async () => {
    const r = await fetch(ctx.base + asset);
    const b = Buffer.from(await r.arrayBuffer());
    return { status: r.status, bytes: b.length };
  }));
  const staticParallelMs = r3(Number(process.hrtime.bigint() - staticParallelStart) / 1e6);
  const staticParallelBytes = staticParallel.reduce((n, x) => n + x.bytes, 0);
  const staticThroughputMiB = r3(staticParallelBytes / 1048576 / (staticParallelMs / 1000));
  const rssAfter = readRss(ctx.child.pid);
  const health = await req(ctx, '/api/health');
  return {
    stateSamples,
    stateP50Ms: r3(percentile(stateMs, 0.5)),
    stateP95Ms: r3(percentile(stateMs, 0.95)),
    stateWorstMs: r3(Math.max(...stateMs)),
    stateParallel: { requests: 8, wallMs: stateParallelMs, ok: parallelState.filter((x) => x.status === 200).length },
    staticAsset: { path: asset, bytes: assetBytes, requests: 24 },
    staticSequential: {
      samples: staticSamples,
      p50Ms: r3(percentile(staticMs, 0.5)),
      p95Ms: r3(percentile(staticMs, 0.95)),
      ok: staticSamples.filter((x) => x.status === 200 && x.bytes > 0).length,
    },
    staticParallel: {
      requests: 16,
      wallMs: staticParallelMs,
      bytes: staticParallelBytes,
      throughputMiBPerSec: staticThroughputMiB,
      ok: staticParallel.filter((x) => x.status === 200 && x.bytes > 0).length,
    },
    rssAfterBytes: rssAfter,
    healthAfterLoad: { status: health.status, ok: health.status === 200 && health.body && health.body.name === 'lycomc' },
  };
}
async function launchCase(ctx, result, label, body, expectedValue) {
  await fs.promises.writeFile(ctx.args, '');
  const posted = await req(ctx, '/api/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (posted.status !== 200 || !posted.body.jobId) throw new Error(label + ': POST /api/launch 失败 ' + JSON.stringify(posted));
  const jobId = posted.body.jobId;
  let job = null;
  for (let i = 0; i < 80; i++) {
    const j = await req(ctx, '/api/jobs/' + jobId);
    job = j.body;
    if (job && job.state !== 'running') break;
    await delay(100);
  }
  let argv = [];
  for (let i = 0; i < 80; i++) {
    const s = await fs.promises.readFile(ctx.args, 'utf8').catch(() => '');
    if (s.trim()) { argv = s.split('\n').filter(Boolean); break; }
    await delay(100);
  }
  await delay(150);
  const logs = job && Array.isArray(job.logs) ? job.logs : [];
  const cmd = logs.find((x) => x.startsWith('命令:')) || '';
  const idx = cmd.indexOf('--quickPlayMultiplayer');
  let jobCmdValue = null;
  if (idx >= 0) {
    const rest = cmd.slice(idx + '--quickPlayMultiplayer'.length).trim().split(/\s+/)[0];
    jobCmdValue = rest || null;
  }
  const argIdx = argv.indexOf('--quickPlayMultiplayer');
  const argValue = argIdx >= 0 ? (argv[argIdx + 1] ?? null) : null;
  const pass = job && job.state === 'done' && argv.length > 0 && (expectedValue === null ? (idx === -1 && argIdx === -1) : (idx >= 0 && jobCmdValue === expectedValue && argIdx >= 0 && argValue === expectedValue)) && !argv.includes('--demo') && !argv.includes('--quickPlaySingleplayer') && !argv.includes('--quickPlayRealms') && !argv.includes('--width') && !argv.some((a) => a.includes('--evil'));
  const c = {
    label,
    requestServer: body.server === undefined ? 'missing' : body.server,
    expectedValue,
    jobId,
    jobState: job && job.state,
    jobQuickPlayLog: logs.find((x) => x.includes('直连服务器')) || null,
    jobCommandHasQuickPlay: idx >= 0,
    jobCommandValue: jobCmdValue,
    fakeArgsQuickPlayIndex: argIdx,
    fakeArgsValue: argValue,
    fakeArgsLength: argv.length,
    fakeArgsHasDemo: argv.includes('--demo'),
    fakeArgsHasSingle: argv.includes('--quickPlaySingleplayer'),
    fakeArgsHasRealms: argv.includes('--quickPlayRealms'),
    fakeArgsHasWidth: argv.includes('--width'),
    fakeArgsHasEvil: argv.some((a) => a.includes('--evil')),
    pass,
  };
  result.cases.push(c);
  const n = String(result.cases.length).padStart(2, '0');
  const selectedFlags = argv.filter((a) => a.startsWith('-') && (a.includes('quickPlay') || a.includes('demo') || a.includes('width') || a.includes('evil')));
  await fs.promises.writeFile(path.join(ctx.out, 'fake-java-args-' + n + '.json'), JSON.stringify({ label, quickPlayMultiplayerIndex: argIdx, quickPlayMultiplayerValue: argValue, selectedFlags, totalArgs: argv.length }, null, 2) + '\n');
  return c;
}
async function functionalTests(ctx) {
  const result = { api: ctx.base, settingsProbe: [], readOnly: [], sse: {}, cases: [], pass: {} };
  const initial = (await req(ctx, '/api/settings')).body;
  result.settingsProbe.push({ label: 'initial', quickPlayServer: initial.quickPlayServer ?? null, javaPath: initial.javaPath, memoryMb: initial.memoryMb });
  const setDefault = await put(ctx, { quickPlayServer: 'default.example.net' });
  result.settingsProbe.push({ label: 'set-default', quickPlayServer: setDefault.quickPlayServer ?? null });
  const missing = await put(ctx, {});
  result.settingsProbe.push({ label: 'missing-patch-keeps', quickPlayServer: missing.quickPlayServer ?? null, javaPath: missing.javaPath, memoryMb: missing.memoryMb });
  const explicitNull = await put(ctx, { quickPlayServer: null });
  result.settingsProbe.push({ label: 'explicit-null-clears', quickPlayServer: explicitNull.quickPlayServer ?? null });
  const invalid = await put(ctx, { quickPlayServer: '--evil' });
  result.settingsProbe.push({ label: 'invalid-address-sanitized', quickPlayServer: invalid.quickPlayServer ?? null });
  const paths = ['/api/health', '/api/state', '/api/settings', '/api/jobs', '/api/accounts', '/api/versions/1.20.1', '/api/mods?versionId=1.20.1', '/api/logs/1.20.1', '/api/accounts/Steve/skin'];
  for (const p of paths) { const r = await req(ctx, p); result.readOnly.push({ path: p, status: r.status, ok: r.status === 200 }); }
  const sse = cp.spawnSync('curl', ['-sS', '-D', '-', '-o', '/dev/null', '--max-time', '1', ctx.base + '/api/events'], { encoding: 'utf8', timeout: 3000, env: process.env });
  const sseText = (sse.stdout || '') + (sse.stderr || '');
  const ct = (sseText.match(/content-type:\s*([^\r\n]+)/i) || [])[1] || null;
  result.sse = { curlStatus: sse.status, contentType: ct, ok: !!ct && ct.toLowerCase().includes('text/event-stream') };
  await put(ctx, { quickPlayServer: 'default.example.net' });
  await launchCase(ctx, result, 'missing-server-uses-default', { versionId: '1.20.1', accountName: 'Steve' }, 'default.example.net');
  await launchCase(ctx, result, 'explicit-null-override-disables', { versionId: '1.20.1', accountName: 'Steve', server: null }, null);
  await launchCase(ctx, result, 'empty-override-disables', { versionId: '1.20.1', accountName: 'Steve', server: '' }, null);
  await launchCase(ctx, result, 'explicit-server-overrides-default', { versionId: '1.20.1', accountName: 'Steve', server: 'mc.hypixel.net' }, 'mc.hypixel.net');
  await launchCase(ctx, result, 'invalid-server-is-dropped', { versionId: '1.20.1', accountName: 'Steve', server: 'bad address' }, null);
  await launchCase(ctx, result, 'option-like-server-is-dropped', { versionId: '1.20.1', accountName: 'Steve', server: '--evil' }, null);
  await launchCase(ctx, result, 'fabric-inherits-quickplay-rule', { versionId: 'fabric-loader-0.20.1-1.20.1', accountName: 'Steve', server: 'fabric.example.net:25565' }, 'fabric.example.net:25565');
  await put(ctx, { quickPlayServer: null });
  const finalSettings = (await req(ctx, '/api/settings')).body;
  result.finalSettings = { quickPlayServer: finalSettings.quickPlayServer ?? null, javaPath: finalSettings.javaPath, memoryMb: finalSettings.memoryMb };
  const finalState = (await req(ctx, '/api/state')).body;
  result.finalRunningCount = finalState && Array.isArray(finalState.running) ? finalState.running.length : null;
  result.pass.settingsSemantics = result.settingsProbe[0].quickPlayServer === null && result.settingsProbe[1].quickPlayServer === 'default.example.net' && result.settingsProbe[2].quickPlayServer === 'default.example.net' && result.settingsProbe[3].quickPlayServer === null && result.settingsProbe[4].quickPlayServer === null && result.settingsProbe[2].javaPath === ctx.fakeJava && result.settingsProbe[2].memoryMb === 6144;
  result.pass.readOnly = result.readOnly.every((x) => x.ok);
  result.pass.sse = result.sse.ok;
  result.pass.launchCases = result.cases.every((c) => c.pass);
  result.pass.finalSettingsCleared = result.finalSettings.quickPlayServer === null;
  result.pass.finalRunningEmpty = result.finalRunningCount === 0;
  result.pass.all = Object.values(result.pass).every(Boolean);
  await fs.promises.writeFile(path.join(ctx.out, 'functional-result.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
const results = {};
const cleanup = {};
const beforeHashes = realDataHashes();
for (const [i, label] of ['baseline', 'optimized'].entries()) {
  const binary = label === 'baseline' ? BASELINE : OPTIMIZED;
  const ctx = prepare(label, binary, PORT_BASE + i * 2);
  let started = null;
  try {
    started = await startServer(ctx);
    const performance = await measurePerformance(started);
    const functional = await functionalTests(started);
    const finalHealth = await req(started, '/api/health');
    const r = {
      label,
      binary: { path: binary, bytes: fs.statSync(binary).size, sha256: sha(binary) },
      port: started.actualPort,
      health: started.health,
      performance,
      functional,
      finalHealth: { status: finalHealth.status, ok: finalHealth.status === 200 },
    };
    results[label] = r;
    await fs.promises.writeFile(path.join(ctx.out, 'result-' + label + '.json'), JSON.stringify(r, null, 2) + '\n');
  } catch (e) {
    results[label] = { label, error: String(e && e.stack || e) };
    await fs.promises.writeFile(path.join(ctx.out, 'result-' + label + '.json'), JSON.stringify(results[label], null, 2) + '\n');
    process.exitCode = 1;
  } finally {
    cleanup[label] = await stopServer(started || ctx);
    await fs.promises.writeFile(path.join(ctx.out, 'cleanup.json'), JSON.stringify(cleanup[label], null, 2) + '\n');
  }
}
const afterHashes = realDataHashes();
const ports = [PORT_BASE, PORT_BASE + 2];
const ss = cp.execFileSync('ss', ['-ltnp'], { encoding: 'utf8' });
const portsBusy = ss.split('\n').filter((l) => ports.some((p) => l.includes(':' + p + ' ')));
const b = results.baseline && results.baseline.performance;
const o = results.optimized && results.optimized.performance;
const comparison = b && o ? {
  stateP50BeforeMs: b.stateP50Ms,
  stateP50AfterMs: o.stateP50Ms,
  stateP50ImprovementPct: pct(b.stateP50Ms, o.stateP50Ms),
  stateP50SpeedupX: ratio(b.stateP50Ms, o.stateP50Ms),
  stateWorstBeforeMs: b.stateWorstMs,
  stateWorstAfterMs: o.stateWorstMs,
  stateWorstImprovementPct: pct(b.stateWorstMs, o.stateWorstMs),
  stateParallelBeforeMs: b.stateParallel.wallMs,
  stateParallelAfterMs: o.stateParallel.wallMs,
  stateParallelImprovementPct: pct(b.stateParallel.wallMs, o.stateParallel.wallMs),
  staticP50BeforeMs: b.staticSequential.p50Ms,
  staticP50AfterMs: o.staticSequential.p50Ms,
  staticP50ImprovementPct: pct(b.staticSequential.p50Ms, o.staticSequential.p50Ms),
  staticParallelThroughputBeforeMiB: b.staticParallel.throughputMiBPerSec,
  staticParallelThroughputAfterMiB: o.staticParallel.throughputMiBPerSec,
  staticParallelThroughputGainPct: b.staticParallel.throughputMiBPerSec > 0 ? r3((o.staticParallel.throughputMiBPerSec - b.staticParallel.throughputMiBPerSec) / b.staticParallel.throughputMiBPerSec * 100) : null,
  rssBeforeBytes: b.rssAfterBytes,
  rssAfterBytes: o.rssAfterBytes,
} : null;
const combined = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  realData: REAL,
  baseline: BASELINE,
  optimized: OPTIMIZED,
  slowJavaSeconds: SLOW_SECONDS,
  results,
  cleanup,
  realDataUnchanged: JSON.stringify(beforeHashes) === JSON.stringify(afterHashes),
  realDataHashesBefore: beforeHashes,
  realDataHashesAfter: afterHashes,
  ports,
  portsBusy,
  comparison,
  pass: !!b && !!o && results.baseline.functional.pass.all && results.optimized.functional.pass.all && results.baseline.finalHealth.ok && results.optimized.finalHealth.ok && results.baseline.performance.healthAfterLoad.ok && results.optimized.performance.healthAfterLoad.ok && JSON.stringify(beforeHashes) === JSON.stringify(afterHashes) && portsBusy.length === 0 && Object.values(cleanup).every((x) => !x.serverAlive && x.stray.length === 0),
};
await fs.promises.writeFile(path.join(PERF, 'compare-result.json'), JSON.stringify(combined, null, 2) + '\n');
await fs.promises.writeFile(path.join(PERF, 'cleanup.json'), JSON.stringify({ cleanup, realDataUnchanged: combined.realDataUnchanged, portsBusy, beforeHashes, afterHashes }, null, 2) + '\n');
console.log('COMPARE_PASS ' + JSON.stringify({ pass: combined.pass, comparison, functional: { baseline: results.baseline.functional.pass, optimized: results.optimized.functional.pass } }));
if (!combined.pass) process.exitCode = 1;
