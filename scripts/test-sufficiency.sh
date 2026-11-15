#!/usr/bin/env bash
set -euo pipefail
# lycomc 发布包充分性回归：隔离数据目录、API 契约、并发、30s 长跑、慢 JAVA 故障注入。
# 用法：LYCOMC_BIN=/path/to/lycomc bash scripts/test-sufficiency.sh
# 输出：JSON 摘要写 stdout；详细证据由调用方落盘。此脚本不打开浏览器、不触碰真实用户数据。
BIN=${LYCOMC_BIN:-}
if [ -z "$BIN" ]; then echo 'LYCOMC_BIN is required' >&2; exit 2; fi
OUT=${LYCOMC_SUFFICIENCY_OUT:-$(mktemp -d)}
PORT=${LYCOMC_SUFFICIENCY_PORT:-0}
rm -rf "$OUT/data" "$OUT/data-slow" "$OUT/slow-java"
mkdir -p "$OUT/data" "$OUT/data-slow" "$OUT/slow-java/bin"
echo '#!/bin/sh' > "$OUT/slow-java/bin/java"
echo 'exec sleep 5' >> "$OUT/slow-java/bin/java"
chmod 0755 "$OUT/slow-java/bin/java"
export LYCOMC_DATA_DIR="$OUT/data" LYCOMC_NO_OPEN=1 TMPDIR="${TMPDIR:-/tmp}"
PYTHON=$(command -v python3)
"$PYTHON" - "$BIN" "$OUT" "$PORT" <<'PY'
import hashlib, json, os, re, signal, socket, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
bin_path, out, requested_port = sys.argv[1], sys.argv[2], int(sys.argv[3])
port = requested_port
if port == 0:
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
base = 'http://127.0.0.1:' + str(port)
env = dict(os.environ)
env['LYCOMC_PORT'] = str(port)
env['LYCOMC_DATA_DIR'] = os.path.join(out, 'data')
env['LYCOMC_NO_OPEN'] = '1'
def lower_h(h):
    return {str(k).lower(): str(v) for k, v in h.items()}
def call(method, path, data=None, timeout=12, base_url=None):
    body = None if data is None else (data if isinstance(data, bytes) else json.dumps(data).encode('utf8'))
    headers = {'Content-Type': 'application/json'} if body is not None else {}
    req = urllib.request.Request((base_url or base) + path, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, lower_h(dict(r.headers)), r.read()
    except urllib.error.HTTPError as e:
        return e.code, lower_h(dict(e.headers)), e.read()

def at_base(port, method, path, data=None, timeout=12):
    return call(method, path, data, timeout, 'http://127.0.0.1:' + str(port))
cases = []
def case(name, fn):
    t = time.monotonic()
    try:
        status, headers, body, ok, detail = fn()
    except Exception as e:
        status, headers, body, ok, detail = None, {}, b'', False, str(e)[:200]
    cases.append({'name': name, 'ms': round((time.monotonic() - t) * 1000, 3), 'status': status, 'contentType': headers.get('content-type'), 'bytes': len(body), 'pass': bool(ok), 'detail': str(detail)[:240]})
def raw(method, path, data=None, timeout=12, base_url=None):
    s, h, b = call(method, path, data, timeout, base_url)
    return {'status': s, 'headers': h, 'body': b}
def check(name, method, path, data, predicate, timeout=12):
    def fn():
        r = raw(method, path, data, timeout)
        ok, detail = predicate(r)
        return r['status'], r['headers'], r['body'], ok, detail
    case(name, fn)
def jget(r):
    try: return json.loads(r['body'])
    except Exception: return {}
p = subprocess.Popen([bin_path], cwd=out, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, text=True)
def ready():
    t0 = time.monotonic()
    for _ in range(100):
        if p.poll() is not None:
            return False, round((time.monotonic() - t0) * 1000, 3), None
        try:
            s, h, b = call('GET', '/api/health', timeout=2)
            if s == 200:
                return True, round((time.monotonic() - t0) * 1000, 3), json.loads(b)
        except Exception:
            pass
        time.sleep(0.2)
    return False, round((time.monotonic() - t0) * 1000, 3), None
ok, startup_ms, health = ready()
if not ok:
    print(json.dumps({'ready': False, 'startupMs': startup_ms, 'log': (p.stdout.read() if p.stdout else '')[-1500:]}, ensure_ascii=False))
    sys.exit(1)
check('GET /api/health 200 + version', 'GET', '/api/health', None, lambda r: (r['status'] == 200 and jget(r).get('version') and jget(r).get('webMode') == 'embedded', 'health ' + str(jget(r))[:120]))
check('GET / 200 HTML', 'GET', '/', None, lambda r: (r['status'] == 200 and b'<html' in r['body'].lower(), 'index'))
def asset_case():
    html = raw('GET', '/')['body'].decode('utf8', 'replace')
    m = re.search(r'src="(/assets/[^"]+\.js)"', html)
    if not m: return 0, {}, b'', False, 'asset reference missing'
    r = raw('GET', m.group(1))
    okv = r['status'] == 200 and 'javascript' in (r['headers'].get('content-type') or '')
    return r['status'], r['headers'], r['body'], okv, m.group(1)
case('GET embedded JS asset 200 + MIME', asset_case)
check('GET /api/settings 200', 'GET', '/api/settings', None, lambda r: (r['status'] == 200, 'settings'))
check('POST /api/settings -> 405', 'POST', '/api/settings', {'quickPlayServer': 'x'}, lambda r: (r['status'] == 405, 'method contract'))
def put_valid():
    r = raw('PUT', '/api/settings', {'quickPlayServer': 'mc.example.net:25565'})
    text = open(os.path.join(out, 'data', 'settings.json'), 'r', encoding='utf8').read()
    return r['status'], r['headers'], r['body'], r['status'] == 200 and 'mc.example.net:25565' in text, 'persisted ' + str(len(text.encode('utf8'))) + 'B'
case('PUT /api/settings valid -> 200 + persist', put_valid)
check('PUT /api/settings invalid JSON -> 4xx', 'PUT', '/api/settings', b'{not-json', lambda r: (400 <= r['status'] < 500, 'invalid JSON'))
check('PUT /api/settings empty body -> 4xx', 'PUT', '/api/settings', b'', lambda r: (400 <= r['status'] < 500, 'empty JSON'))
import string, random
# valid_name: 3-16 chars, ASCII alphanumeric or underscore only.
unique_name = 'S' + ''.join(random.choice(string.ascii_letters + string.digits + '_') for _ in range(14))
invalid_name = unique_name[:12] + '-bad'  # >16 chars and contains a dash, rejected by valid_name
def account_case(r):
    j = jget(r)
    text = r['body'].decode('utf8', 'replace').lower()
    return r['status'] == 200 and j.get('hasSession') is False and 'token' not in text, 'offline account keys=' + ','.join(sorted(j.keys()))
check('POST /api/accounts offline -> 200 no token', 'POST', '/api/accounts', {'name': unique_name}, account_case)
check('POST /api/accounts invalid name -> 4xx reject', 'POST', '/api/accounts', {'name': invalid_name}, lambda r: (400 <= r['status'] < 500 and 'error' in jget(r), 'rejected invalid username'))
def sse_case():
    req = urllib.request.Request(base + '/api/events', method='GET')
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            h = lower_h(dict(r.headers))
            return r.status, h, b'', r.status == 200 and 'text/event-stream' in (h.get('content-type') or ''), 'headers-only'
    except urllib.error.HTTPError as e:
        h = lower_h(dict(e.headers))
        return e.code, h, b'', False, 'HTTP error'
case('GET /api/events SSE headers', sse_case)
check('POST /api/launch/999999/kill -> 404', 'POST', '/api/launch/999999/kill', None, lambda r: (r['status'] == 404, 'missing pid'))
check('GET unknown API -> 404 JSON', 'GET', '/api/does-not-exist', None, lambda r: (r['status'] == 404 and b'error' in r['body'], 'unknown API'))
check('static traversal -> no leak', 'GET', '/assets/../../../../etc/passwd', None, lambda r: (r['status'] != 200 and b'root:' not in r['body'], 'traversal'))
check('GET /api/state 200', 'GET', '/api/state', None, lambda r: (r['status'] == 200, 'state'))

# C17: local mod enable/disable and local metadata.
mod_version_id = 'c17-suff-1.20.1'
mod_version_dir = os.path.join(out, 'data', 'versions', mod_version_id)
mod_dir = os.path.join(mod_version_dir, 'mods')
os.makedirs(mod_dir, exist_ok=True)
with open(os.path.join(mod_version_dir, mod_version_id + '.json'), 'w', encoding='utf8') as f:
    json.dump({'id': mod_version_id, 'type': 'release', 'javaVersion': {'majorVersion': 17}}, f)
with open(os.path.join(mod_dir, 'alpha.jar'), 'wb') as f:
    f.write(b'PK\x03\x04fake-jar')

def mod_toggle_case():
    r = raw('POST', '/api/mods/toggle', {'versionId': mod_version_id, 'file': 'alpha.jar', 'enabled': False})
    disabled = os.path.join(mod_dir, 'alpha.jar.disabled')
    okv = r['status'] == 200 and jget(r).get('enabled') is False and os.path.isfile(disabled) and not os.path.exists(os.path.join(mod_dir, 'alpha.jar'))
    if okv:
        state = jget(raw('GET', '/api/state'))
        found = [v for v in (state.get('versions') or []) if v.get('id') == mod_version_id]
        okv = bool(found)
    return r['status'], r['headers'], r['body'], bool(okv), 'disabled=' + str(os.path.isfile(disabled)) + ' state=' + str(okv)
case('POST /api/mods/toggle disable -> .jar.disabled', mod_toggle_case)

def mod_list_case():
    r = raw('GET', '/api/mods?versionId=' + mod_version_id)
    mods = jget(r).get('mods') or []
    okv = r['status'] == 200 and any(m.get('file') == 'alpha.jar.disabled' and m.get('enabled') is False and m.get('baseFile') == 'alpha.jar' for m in mods)
    return r['status'], r['headers'], r['body'], bool(okv), 'mods=' + str(mods)[:160]
case('GET /api/mods includes disabled mod', mod_list_case)

def mod_info_case():
    r = raw('GET', '/api/mods/info?versionId=' + mod_version_id + '&file=alpha.jar.disabled')
    j = jget(r)
    okv = r['status'] == 200 and j.get('enabled') is False and len(str(j.get('sha1') or '')) == 40
    return r['status'], r['headers'], r['body'], bool(okv), 'sha1=' + str(j.get('sha1'))[:12]
case('GET /api/mods/info -> sha1 + enabled=false', mod_info_case)

check('POST /api/mods/toggle invalid path -> 4xx', 'POST', '/api/mods/toggle', {'versionId': mod_version_id, 'file': '../alpha.jar', 'enabled': True}, lambda r: (400 <= r['status'] < 500 and 'error' in jget(r), 'traversal rejected'))

def mod_toggle_back_case():
    r = raw('POST', '/api/mods/toggle', {'versionId': mod_version_id, 'file': 'alpha.jar.disabled', 'enabled': True})
    okv = r['status'] == 200 and jget(r).get('enabled') is True and os.path.isfile(os.path.join(mod_dir, 'alpha.jar')) and not os.path.exists(os.path.join(mod_dir, 'alpha.jar.disabled'))
    return r['status'], r['headers'], r['body'], bool(okv), 'enabled=' + str(os.path.isfile(os.path.join(mod_dir, 'alpha.jar')))
case('POST /api/mods/toggle enable -> .jar', mod_toggle_back_case)

# H39: offline embedded help, about, license boundary, feedback/wiki links.
check('GET /api/about -> offline metadata without credentials', 'GET', '/api/about', None, lambda r: (
    r['status'] == 200 and jget(r).get('name') == 'LilyCraft Web' and jget(r).get('version') == '0.1.1'
    and jget(r).get('licenseStatus') == 'unspecified' and (jget(r).get('upstream') or {}).get('version') == 'v2.15.1'
    and len(jget(r).get('helpTopics') or []) >= 12 and 'accessToken' not in r['body'].decode('utf8', 'ignore')
    and 'refreshToken' not in r['body'].decode('utf8', 'ignore'), 'about metadata'))
check('POST /api/about -> 405 read-only', 'POST', '/api/about', {}, lambda r: (r['status'] == 405, 'read-only'))

def help_all_case():
    r = raw('GET', '/api/help/search')
    j = jget(r)
    items = j.get('items') or []
    ids = [x.get('id') for x in items]
    okv = (
        r['status'] == 200 and j.get('count') == len(items) and len(items) >= 12
        and len(ids) == len(set(ids)) and 'query' not in j
    )
    return r['status'], r['headers'], r['body'], okv, 'count=' + str(j.get('count'))
case('GET /api/help/search -> stable full index', help_all_case)

def help_query_case(q, minimum, needle):
    path = '/api/help/search?q=' + urllib.parse.quote(q, safe='')
    r = raw('GET', path)
    j = jget(r)
    items = j.get('items') or []
    okv = (
        r['status'] == 200 and j.get('count') == len(items) and len(items) >= minimum
        and all(needle in (str(x.get('id', '')) + str(x.get('title', '')) + str(x.get('category', '')) + str(x.get('summary', ''))).lower() for x in items)
        and 'query' not in j
    )
    return r['status'], r['headers'], r['body'], okv, 'q=' + q + ' count=' + str(j.get('count'))
case('GET /api/help/search?q=MOD -> case-insensitive matches', lambda: help_query_case('MOD', 2, 'mod'))
case('GET /api/help/search?q=备份 -> Chinese matches', lambda: help_query_case('备份', 2, '备份'))
case('GET /api/help/search unknown -> empty without echoed query', lambda: help_query_case('不存在的关键词xyz', 0, '不存在的关键词xyz'))
check('GET /api/help/search overlong q -> 400', 'GET', '/api/help/search?q=' + ('x' * 129), None, lambda r: (400 <= r['status'] < 500 and 'error' in jget(r), 'bounded query'))

# E22/E24: instance metadata and instance-scoped settings.
version_id = 'suff-1.20.1'
version_dir = os.path.join(out, 'data', 'versions', version_id)
os.makedirs(version_dir, exist_ok=True)
with open(os.path.join(version_dir, version_id + '.json'), 'w', encoding='utf8') as f:
    json.dump({'id': version_id, 'type': 'release', 'javaVersion': {'majorVersion': 17}}, f)

def patch_instance_metadata():
    body = {'displayName': '测试实例', 'icon': '🧊', 'isolated': False}
    r = raw('PATCH', '/api/versions/' + version_id, body)
    j = jget(r)
    m = j.get('metadata') or {}
    state = jget(raw('GET', '/api/state'))
    found = [v for v in (state.get('versions') or []) if v.get('id') == version_id]
    okv = (r['status'] == 200 and j.get('ok') is True and m.get('displayName') == '测试实例' and m.get('icon') == '🧊' and m.get('isolated') is False and bool(found) and found[0].get('hasInstanceSettings') is False)
    meta_path = os.path.join(version_dir, 'instance-meta.json')
    shared = os.path.join(out, 'data', 'shared-game')
    if okv and os.name == 'posix':
        okv = os.path.isfile(meta_path) and (os.stat(meta_path).st_mode & 0o777) == 0o600
    return r['status'], r['headers'], r['body'], bool(okv), 'metadata=' + str(m)[:100] + ' shared=' + str(os.path.isdir(shared))
case('PATCH /api/versions/:id metadata -> 200 + shared dir', patch_instance_metadata)

check('PATCH /api/versions/:id illegal id -> 4xx', 'PATCH', '/api/versions/a..b', {'displayName': 'x'}, lambda r: (400 <= r['status'] < 500 and 'error' in jget(r), 'illegal id rejected'))
check('PATCH /api/versions/:id missing -> 404', 'PATCH', '/api/versions/not-installed-123', {'displayName': 'x'}, lambda r: (r['status'] == 404 and 'error' in jget(r), 'missing version'))

def put_instance_settings():
    r = raw('PUT', '/api/versions/' + version_id + '/settings', {'memoryMb': 123, 'downloadSource': 'weird', 'gameLang': 'ZH_CN'})
    j = jget(r)
    effective = j.get('settings') or {}
    override_map = j.get('override') or {}
    got = raw('GET', '/api/versions/' + version_id + '/settings')
    gj = jget(got)
    state = jget(raw('GET', '/api/state'))
    found = [v for v in (state.get('versions') or []) if v.get('id') == version_id]
    okv = (r['status'] == 200 and got['status'] == 200 and effective.get('memoryMb') >= 256 and effective.get('downloadSource') == 'mojang' and effective.get('gameLang') == 'zh_cn' and override_map.get('memoryMb') == 123 and (gj.get('settings') or {}).get('memoryMb') == effective.get('memoryMb') and bool(found) and found[0].get('hasInstanceSettings') is True)
    return r['status'], r['headers'], r['body'], bool(okv), 'effective=' + str(effective)[:120]
case('PUT /api/versions/:id/settings sanitize + persist', put_instance_settings)

def put_instance_settings_null():
    r1 = raw('PUT', '/api/versions/' + version_id + '/settings', {'gameLang': None})
    j1 = jget(r1)
    r2 = raw('PUT', '/api/versions/' + version_id + '/settings', {})
    r3 = raw('PUT', '/api/versions/' + version_id + '/settings', {'notAllowed': 1})
    okv = (r1['status'] == 200 and 'gameLang' not in (j1.get('override') or {}) and 400 <= r2['status'] < 500 and 400 <= r3['status'] < 500)
    return r1['status'], r1['headers'], r1['body'], bool(okv), 'null cleared, empty+unknown rejected'
case('PUT /api/versions/:id/settings null/empty/unknown', put_instance_settings_null)

def delete_instance_settings():
    r = raw('DELETE', '/api/versions/' + version_id + '/settings')
    j = jget(r)
    global_settings = jget(raw('GET', '/api/settings'))
    okv = (r['status'] == 200 and j.get('ok') is True and j.get('override') == {} and (j.get('settings') or {}).get('memoryMb') == global_settings.get('memoryMb'))
    return r['status'], r['headers'], r['body'], bool(okv), 'reset override=' + str(j.get('override'))
case('DELETE /api/versions/:id/settings reset to global', delete_instance_settings)

# H35: settings export/import, backup/restore, cleanup boundary.
def export_no_secret(r):
    j = jget(r)
    text = r['body'].decode('utf8', 'replace').lower()
    keys = set(j.keys())
    expected = {'memoryMb','javaPath','extraJvmArgs','selectVersion','downloadSource','maxConcurrent','closeOnLaunch','gameLang','defaultAccount','quickPlayServer'}
    return r['status'] == 200 and expected.issubset(keys) and 'refreshtoken' not in text and 'accesstoken' not in text, 'export keys=' + str(len(keys))
check('GET /api/settings/export -> 200 no credentials', 'GET', '/api/settings/export', None, export_no_secret)

def import_valid_case():
    body = {'memoryMb': 10, 'downloadSource': 'weird', 'gameLang': 'ZH_CN'}
    r = raw('POST', '/api/settings/import', body)
    j = jget(r)
    text = open(os.path.join(out, 'data', 'settings.json'), 'r', encoding='utf8').read()
    persisted = json.loads(text)
    okv = (r['status'] == 200 and j.get('memoryMb') == 512 and j.get('downloadSource') == 'mojang' and j.get('gameLang') == 'zh_cn' and persisted.get('memoryMb') == 512 and persisted.get('quickPlayServer') == 'mc.example.net:25565')
    return r['status'], r['headers'], r['body'], okv, 'sanitized memoryMb=' + str(j.get('memoryMb')) + ' persisted=' + str(persisted.get('memoryMb'))
case('POST /api/settings/import sanitize + persist', import_valid_case)

check('POST /api/settings/import invalid -> 4xx', 'POST', '/api/settings/import', {'memoryMb': 'many'}, lambda r: (400 <= r['status'] < 500 and 'error' in jget(r), 'rejected invalid import'))

backup_id = None
def create_backup_case():
    global backup_id
    r = raw('POST', '/api/backup/create', None)
    j = jget(r)
    backup_id = j.get('id')
    okv = (r['status'] == 200 and isinstance(backup_id, str) and backup_id.startswith('backup-') and isinstance(j.get('fileName'), str) and j.get('bytes', 0) > 0 and isinstance(j.get('createdAt'), int) and 'token' not in r['body'].decode('utf8', 'replace').lower())
    if okv and os.name == 'posix':
        p = os.path.join(out, 'data', 'backups', j['fileName'])
        okv = os.path.isfile(p) and (os.stat(p).st_mode & 0o777) == 0o600
    return r['status'], r['headers'], r['body'], bool(okv), 'id=' + str(backup_id)[:40]
case('POST /api/backup/create -> 200 entry 0600', create_backup_case)

def list_backups_case():
    r = raw('GET', '/api/backup/list', None)
    j = jget(r)
    items = j.get('items') or []
    okv = r['status'] == 200 and j.get('count') == len(items) and len(items) >= 1 and any(x.get('id') == backup_id for x in items) and 'token' not in r['body'].decode('utf8', 'replace').lower()
    return r['status'], r['headers'], r['body'], bool(okv), 'count=' + str(j.get('count'))
case('GET /api/backup/list -> 200 no secrets', list_backups_case)

def restore_changed_case():
    raw('PUT', '/api/settings', {'memoryMb': 8192})
    before = raw('GET', '/api/settings')['body']
    r = raw('POST', '/api/backup/' + str(backup_id) + '/restore', None)
    j = jget(r)
    after = raw('GET', '/api/settings')['body']
    okv = r['status'] == 200 and j.get('ok') is True and j.get('settings', {}).get('memoryMb') == 512 and json.loads(after).get('memoryMb') == 512 and before != after
    return r['status'], r['headers'], r['body'], bool(okv), 'restored memoryMb=' + str(j.get('settings', {}).get('memoryMb'))
case('POST /api/backup/{id}/restore -> 200 state rollback', restore_changed_case)

check('POST /api/backup/{bad id}/restore -> 4xx', 'POST', '/api/backup/a.b/restore', None, lambda r: (400 <= r['status'] < 500 and 'error' in jget(r), 'invalid id rejected'))
check('POST /api/backup/{missing}/restore -> 404', 'POST', '/api/backup/missing-id/restore', None, lambda r: (r['status'] == 404 and 'error' in jget(r), 'missing backup'))

def cleanup_case():
    cache = os.path.join(out, 'data', 'cache', 'nested')
    os.makedirs(cache, exist_ok=True)
    with open(os.path.join(cache, 'blob.bin'), 'wb') as f:
        f.write(b'x' * 256)
    with open(os.path.join(out, 'data', 'cache', 'top.bin'), 'wb') as f:
        f.write(b'y' * 128)
    r = raw('POST', '/api/cleanup', None)
    j = jget(r)
    persist_ok = os.path.isfile(os.path.join(out, 'data', 'settings.json')) and os.path.isfile(os.path.join(out, 'data', 'accounts.json'))
    okv = r['status'] == 200 and j.get('ok') is True and j.get('freedBytes', 0) >= 384 and j.get('removedFiles', 0) >= 1 and j.get('removedDirs', 0) >= 1 and persist_ok and not os.path.exists(cache)
    return r['status'], r['headers'], r['body'], bool(okv), 'freed=' + str(j.get('freedBytes')) + ' persist=' + str(persist_ok)
case('POST /api/cleanup -> 200 cache only', cleanup_case)

from concurrent.futures import ThreadPoolExecutor
def parallel(n, fn):
    t = time.monotonic()
    with ThreadPoolExecutor(max_workers=n) as ex:
        vals = list(ex.map(lambda _: fn(), range(n)))
    return round((time.monotonic() - t) * 1000, 3), vals
conc_ms, conc = parallel(16, lambda: raw('GET', '/api/state')['status'])
def rss_bytes():
    try:
        for line in open('/proc/' + str(p.pid) + '/status'):
            if line.startswith('VmRSS:'): return int(line.split()[1]) * 1024
    except Exception: pass
    return None
rss0 = rss_bytes(); long = []
for i in range(10):
    t = time.monotonic(); a = raw('GET', '/api/health', timeout=3); b = raw('GET', '/api/state', timeout=3)
    long.append({'i': i, 'ms': round((time.monotonic() - t) * 1000, 3), 'health': a['status'], 'state': b['status']}); time.sleep(3)
rss1 = rss_bytes()
try: os.killpg(p.pid, signal.SIGTERM)
except Exception: pass
for _ in range(30):
    if p.poll() is not None: break
    time.sleep(0.1)
try: os.killpg(p.pid, signal.SIGKILL)
except Exception: pass
try: p.stdout.close()
except Exception: pass
# L6: 慢 JAVA_HOME 探针必须由 PROBE_TIMEOUT=2s 约束，不能挂满 5s。
slow_port = 0
_sock = socket.socket()
_sock.bind(('127.0.0.1', 0))
slow_port = _sock.getsockname()[1]
_sock.close()
slow_data = os.path.join(out, 'data-slow')
os.makedirs(slow_data, exist_ok=True)
slow_env = dict(env)
slow_env['LYCOMC_PORT'] = str(slow_port)
slow_env['LYCOMC_DATA_DIR'] = slow_data
slow_env['JAVA_HOME'] = os.path.join(out, 'slow-java')
slow_env['LYCOMC_NO_OPEN'] = '1'
p2 = subprocess.Popen([bin_path], cwd=out, env=slow_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, text=True)
slow_ready = False
slow_startup = None
_t0 = time.monotonic()
for _ in range(100):
    if p2.poll() is not None:
        break
    try:
        _s, _h, _b = at_base(slow_port, 'GET', '/api/health', timeout=2)
        if _s == 200:
            slow_ready = True
            slow_startup = round((time.monotonic() - _t0) * 1000, 3)
            break
    except Exception:
        pass
    time.sleep(0.2)
slow_times = []
slow_statuses = []
if slow_ready:
    _t = time.monotonic()
    _s, _h, _b = at_base(slow_port, 'GET', '/api/state', timeout=5)
    slow_times.append(round((time.monotonic() - _t) * 1000, 3))
    slow_statuses.append(_s)
    def _slow_state():
        _t = time.monotonic()
        _s, _h, _b = at_base(slow_port, 'GET', '/api/state', timeout=5)
        return _s, round((time.monotonic() - _t) * 1000, 3)
    with ThreadPoolExecutor(max_workers=8) as ex:
        _pairs = list(ex.map(lambda _: _slow_state(), range(8)))
    for _s, _ms in _pairs:
        slow_statuses.append(_s)
        slow_times.append(_ms)
slow_worst = max(slow_times) if slow_times else None
slow_all2xx = bool(slow_ready) and all(s == 200 for s in slow_statuses)
slow_bounded = bool(slow_ready) and slow_worst is not None and slow_worst < 2500
try:
    os.killpg(p2.pid, signal.SIGTERM)
except Exception:
    pass
for _ in range(30):
    if p2.poll() is not None:
        break
    time.sleep(0.1)
try:
    os.killpg(p2.pid, signal.SIGKILL)
except Exception:
    pass
try:
    p2.stdout.close()
except Exception:
    pass
slow_summary = {'ready': slow_ready, 'startupMs': slow_startup, 'probeMs': slow_times, 'worstMs': slow_worst, 'all2xx': slow_all2xx, 'bounded': slow_bounded, 'dataDir': slow_data}
summary = {'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'binarySha256': hashlib.sha256(open(bin_path, 'rb').read()).hexdigest(), 'startupMs': startup_ms, 'port': port, 'passed': sum(1 for c in cases if c['pass']), 'total': len(cases), 'failed': [c for c in cases if not c['pass']], 'concurrency': {'count': 16, 'ms': conc_ms, 'all2xx': all(v == 200 for v in conc)}, 'longRun': {'samples': len(long), 'all2xx': all(x['health'] == 200 and x['state'] == 200 for x in long), 'rssFirst': rss0, 'rssLast': rss1, 'rssGrowth': None if rss0 is None or rss1 is None else rss1 - rss0}, 'slowJava': slow_summary, 'cases': cases}
print(json.dumps(summary, ensure_ascii=False))
sys.exit(0 if summary['passed'] == summary['total'] and summary['concurrency']['all2xx'] and summary['longRun']['all2xx'] and summary['slowJava']['bounded'] and summary['slowJava']['all2xx'] else 1)
PY
