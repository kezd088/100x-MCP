import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateEndpoint, readConnection, request, saveConnection, DPAPI_SCRIPTS, encodeCodeUnits, decodeCodeUnits } from '../plugins/100x/scripts/connection.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const plugin = resolve(root, 'plugins/100x');
await mkdir(resolve(root, 'work/tests'), { recursive: true });
const folder = await mkdtemp(resolve(root, 'work/tests/中文 路径-'));
const token = randomBytes(24).toString('hex');
function start(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/mcp' }));
  });
}
function run(file, args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: folder, env: { ...process.env, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {}); child.stdin.end(input || '');
  });
}

test('only 100x HTTPS or explicit loopback MCP addresses are accepted', () => {
  assert.equal(validateEndpoint('https://100xspeed.app/mcp'), 'https://100xspeed.app/mcp');
  assert.equal(validateEndpoint('https://mcp.100xspeed.app/mcp'), 'https://mcp.100xspeed.app/mcp');
  assert.equal(validateEndpoint('http://[::1]:4196/mcp'), 'http://[::1]:4196/mcp');
  for (const url of ['http://100xspeed.app/mcp', 'https://100xspeed.app.attacker.test/mcp', 'https://attacker.test/mcp', 'https://u:p@100xspeed.app/mcp', 'https://100xspeed.app/mcp?token=x', 'https://100xspeed.app/mcp#x', 'https://100xspeed.app/other', 'file:///mcp']) {
    assert.throws(() => validateEndpoint(url), { code: '100X_INVALID_URL' });
  }
});

test('fresh stdio starts without credentials and exposes actionable connection status', async () => {
  const child = spawn(process.execPath, [resolve(plugin, 'scripts/bridge.mjs')], { cwd: folder, env: { ...process.env, HUNDREDX_TOKEN: '', HUNDREDX_CONFIG_PATH: resolve(folder, 'missing.json') }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let id = 0; let errorOutput = '';
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { const m = JSON.parse(line); pending.get(m.id)?.(m); });
  child.stderr.on('data', b => errorOutput += b);
  function call(method, params = {}) {
    return new Promise((res, rej) => {
      const n = ++id, timer = setTimeout(() => rej(new Error('stdio timeout')), 5000);
      pending.set(n, r => { clearTimeout(timer); pending.delete(n); res(r); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  }
  try {
    const init = await call('initialize', { protocolVersion: '2025-03-26' });
    assert.equal(init.result.serverInfo.name, '100x');
    const skill = await readFile(resolve(plugin, 'skills/100x-creative/SKILL.md'), 'utf8');
    assert.ok(init.result.instructions.includes('100x_connection_status') && skill.includes(init.result.instructions), 'hosts without skills, like Claude Desktop, get the skill body as server instructions');
    const listed = (await call('tools/list')).result.tools;
    assert.equal(listed.length, 11);
    assert.ok(listed.some(tool => tool.name === '100x_push_storyboard'), 'the storyboard push tool is exposed');
    assert.ok(listed.some(tool => tool.name === '100x_report_production'), 'the production report tool is exposed');
    assert.equal(listed.find(tool => tool.name === '100x_generate_video').inputSchema.required.includes('max_credits'), false, 'Omni, MiniMax and Seedance videos need no credit cap');
    const status = await call('tools/call', { name: '100x_connection_status', arguments: {} });
    assert.equal(status.result.structuredContent.error.code, '100X_NOT_CONNECTED');
    assert.equal((await call('tools/call', { name: 'arbitrary_request' })).error.code, -32602);
    assert.equal(errorOutput, '');
  } finally { child.kill(); }
});

test('HTTP proxy forwards budget and idempotency exactly once', async () => {
  const calls = [];
  const { server, url } = await start(async (req, res) => {
    let text = ''; for await (const c of req) text += c;
    calls.push({ auth: req.headers.authorization, body: JSON.parse(text) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: calls[0].body.id, result: { content: [{ type: 'text', text: 'accepted' }] } }));
  });
  try {
    const body = { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: '100x_generate_image', arguments: { quote_id: '100x_quote_' + 'a'.repeat(32), max_credits: 0.5, idempotency_key: 'same-request-1234' } } };
    await request({ url, token }, body);
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].body, body); assert.equal(calls[0].auth, 'Bearer ' + token);
  } finally { server.closeAllConnections(); server.close(); }
});

test('auth failures do not disclose response text', async () => {
  const { server, url } = await start((req, res) => { res.writeHead(401); res.end('private details ' + token); });
  try { await assert.rejects(request({ url, token }, { id: 1 }), e => e.code === '100X_AUTH_FAILED' && !e.message.includes(token)); }
  finally { server.closeAllConnections(); server.close(); }
});

test('timed out generation is not automatically retried', async () => {
  let calls = 0;
  const { server, url } = await start(() => { calls++; });
  try {
    await assert.rejects(request({ url, token }, { id: 1 }, { timeoutMs: 80 }), { code: '100X_CONNECTION_FAILED' });
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); server.close(); }
});

test('redirects are never followed with credentials', async () => {
  let destinationCalls = 0;
  const target = await start((req, res) => { destinationCalls++; res.end('bad'); });
  const redirect = await start((req, res) => { res.writeHead(307, { location: target.url }); res.end(); });
  try {
    await assert.rejects(request({ url: redirect.url, token }, { id: 1 }), { code: '100X_CONNECTION_FAILED' });
    assert.equal(destinationCalls, 0);
  } finally { for (const s of [target.server, redirect.server]) { s.closeAllConnections(); s.close(); } }
});

test('Windows protected storage roundtrips without token in output or file', { skip: process.platform !== 'win32' }, async () => {
  const configPath = resolve(folder, 'connection.json');
  const url = 'http://127.0.0.1:4196/mcp';
  const connect = () => run(process.execPath, [resolve(plugin, 'scripts/connect-manual.mjs'), '--from-stdin'], { HUNDREDX_CONFIG_PATH: configPath, HUNDREDX_TOKEN: '' }, JSON.stringify({ url, token }));
  const result = await connect();
  assert.equal(result.code, 0, result.stderr);
  assert.equal((result.stdout + result.stderr).includes(token), false);
  const text = await readFile(configPath, 'utf8'); assert.equal(text.includes(token), false);
  assert.deepEqual(await readConnection({ HUNDREDX_CONFIG_PATH: configPath }), { url, token });
  assert.equal((await connect()).code, 0, 'Reconnecting must replace the locked-down file');
});

// 受限语言模式（AppLocker、WDAC）下起的 PowerShell 只放行 cmdlet 和核心类型。Windows 用 powershell.exe 实跑；
// 别的系统装了 pwsh 也跑一遍（那里 SecureString 不加密，只验受限模式放不放行和码元往返）。
const powershell = process.platform === 'win32' ? 'powershell.exe' : (() => {
  try { execFileSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' }); return 'pwsh'; } catch { return null; }
})();
const constrained = "$ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage'; ";
const lastLine = text => text.trim().split(/\r?\n/).pop().trim();
const ps = (script, input, env) => run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], env, input);
const DPAPI_HEADER = '01000000d08c9ddf0115d1118c7a00c04fc297eb';

test('text crosses the PowerShell pipe as UTF-16 code units', () => {
  for (const value of ['', token, '中文 é 😀', '\u0000,']) assert.equal(decodeCodeUnits(encodeCodeUnits(value)), value);
  for (const bad of ['a', '1,,2', '65536', '1, 2', 'WARNING: x']) assert.throws(() => decodeCodeUnits(bad));
});

test('Windows PowerShell paths avoid what ConstrainedLanguage blocks', async () => {
  const blocked = /\[(?:System\.)?(?:Console|Runtime\.|IO\.|Text\.|Security\.|Convert)\b|::new\(|Add-Type/;
  for (const script of Object.values(DPAPI_SCRIPTS)) assert.doesNotMatch(script, blocked);
  const installer = await readFile(resolve(root, 'install.ps1'), 'utf8');
  for (const line of installer.split(/\r?\n/)) if (blocked.test(line)) assert.match(line, /LanguageMode -eq 'FullLanguage'/, line);
});

test('DPAPI scripts roundtrip under ConstrainedLanguage', { skip: !powershell && '需要 PowerShell' }, async () => {
  assert.equal(lastLine((await ps(constrained + '$ExecutionContext.SessionState.LanguageMode', '')).stdout), 'ConstrainedLanguage');
  const secret = token + '-中文é😀';
  const sealed = await ps(constrained + DPAPI_SCRIPTS.protect, encodeCodeUnits(secret));
  assert.equal(sealed.code, 0, sealed.stderr);
  const cipher = lastLine(sealed.stdout);
  assert.match(cipher, /^[0-9a-f]+$/i);
  if (process.platform === 'win32') assert.ok(cipher.toLowerCase().startsWith(DPAPI_HEADER), 'current-user DPAPI blob');
  const opened = await ps(constrained + DPAPI_SCRIPTS.unprotect, encodeCodeUnits(cipher));
  assert.equal(opened.code, 0, opened.stderr);
  assert.equal(decodeCodeUnits(lastLine(opened.stdout)), secret);
  assert.equal((sealed.stdout + sealed.stderr + opened.stderr).includes(token), false);
});

// 系统策略把整台机器锁在受限模式时，0.3.3 的原脚本自己就跑不起来，那项跳过。
const systemMode = process.platform === 'win32' ? lastLine((await ps('$ExecutionContext.SessionState.LanguageMode', '')).stdout) : '';

test('connections saved by 0.3.3 still open, also under ConstrainedLanguage', { skip: process.platform !== 'win32' ? true : systemMode !== 'FullLanguage' && '系统处在受限模式，造不出 0.3.3 的密文' }, async () => {
  // 0.3.3 的加密脚本原样：普通模式下产出的密文，新版不用重连就能读。
  const legacy = "$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1'); [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); $v=[Console]::In.ReadToEnd(); $s=ConvertTo-SecureString $v -AsPlainText -Force; [Console]::Write((ConvertFrom-SecureString $s))";
  const sealed = await ps(legacy, token);
  assert.equal(sealed.code, 0, sealed.stderr);
  const cipher = sealed.stdout.trim();
  const opened = await ps(constrained + DPAPI_SCRIPTS.unprotect, encodeCodeUnits(cipher));
  assert.equal(decodeCodeUnits(lastLine(opened.stdout)), token);
  const configPath = resolve(folder, 'legacy', 'connection.json');
  await mkdir(resolve(folder, 'legacy'), { recursive: true });
  const url = 'http://127.0.0.1:4196/mcp';
  await writeFile(configPath, JSON.stringify({ version: 1, url, protection: 'windows-dpapi', token: cipher }));
  assert.deepEqual(await readConnection({ HUNDREDX_CONFIG_PATH: configPath }), { url, token });
});

test('Windows saved connection is DPAPI-sealed and only the current user and SYSTEM can open it', { skip: process.platform !== 'win32' }, async () => {
  const configPath = resolve(folder, 'acl', 'connection.json');
  await saveConnection({ url: 'http://127.0.0.1:4196/mcp', token }, { HUNDREDX_CONFIG_PATH: configPath });
  const record = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(record.protection, 'windows-dpapi');
  assert.ok(record.token.toLowerCase().startsWith(DPAPI_HEADER));
  assert.equal(JSON.stringify(record).includes(token), false);
  // 读 SDDL 字符串，受限模式下也放行：D:P 是不继承，每条 ACE 是「允许;无继承标记;FA 全部权限;;;SID」。
  const sddl = lastLine((await ps('(Get-Acl -LiteralPath $env:ACL_PATH).Sddl', '', { ACL_PATH: configPath })).stdout);
  const dacl = /D:([A-Z]*)((?:\([^)]*\))*)/.exec(sddl);
  assert.ok(dacl && dacl[1].includes('P'), 'inheritance removed: ' + sddl);
  const me = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).match(/S-1-\d+(?:-\d+)+/g).pop();
  assert.deepEqual(dacl[2].match(/\([^)]*\)/g).sort(), ['(A;;FA;;;' + me + ')', '(A;;FA;;;SY)'].sort());
});

test('media download from current 100x endpoint cannot overwrite files', async () => {
  const { server, url } = await start((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from('png-test')); });
  const saved = resolve(folder, 'already.png'); await writeFile(saved, 'keep');
  try {
    const result = await run(process.execPath, [resolve(plugin, 'scripts/media.mjs'), 'download', url.replace('/mcp', '/media/100x_asset_' + 'a'.repeat(32)), saved], { HUNDREDX_URL: url, HUNDREDX_TOKEN: token });
    assert.equal(result.code, 1); assert.equal(await readFile(saved, 'utf8'), 'keep'); assert.match(result.stderr, /已存在/);
  } finally { server.closeAllConnections(); server.close(); }
});

test('stdio bridge reports the host app to 100x on every forwarded tool call', async () => {
  const seen = [];
  const { server, url } = await start(async (req, res) => {
    let text = ''; for await (const c of req) text += c;
    const body = JSON.parse(text); seen.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }] } }));
  });
  const child = spawn(process.execPath, [resolve(plugin, 'scripts/bridge.mjs')], { cwd: folder, env: { ...process.env, HUNDREDX_URL: url, HUNDREDX_TOKEN: token }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => { const m = JSON.parse(line); pending.get(m.id)?.(m); });
  const call = (id, method, params) => new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('stdio timeout')), 5000);
    pending.set(id, r => { clearTimeout(timer); res(r); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    await call(1, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code', title: 'Claude Code', version: '2.1.328' } });
    const reply = await call(2, 'tools/call', { name: '100x_get_balance', arguments: {} });
    assert.equal(reply.result.content[0].text, 'ok');
    assert.deepEqual(seen[0].params._meta, { 'io.modelcontextprotocol/clientInfo': { name: 'claude-code', version: '2.1.328' } });
    assert.deepEqual(seen[0].params.arguments, {});
  } finally { child.kill(); server.close(); }
});

test('Codex, Claude Code and Claude Desktop manifests ship the same version and the same stdio bridge', async () => {
  const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const versions = await Promise.all(['package.json', 'plugins/100x/plugin.json', 'plugins/100x/.codex-plugin/plugin.json', 'plugins/100x/.claude-plugin/plugin.json', 'plugins/100x/manifest.json'].map(async path => (await read(path)).version));
  assert.equal(new Set(versions).size, 1, versions.join(', '));
  const claude = (await read('plugins/100x/.claude-plugin/plugin.json')).mcpServers['100x'];
  const codex = (await read('plugins/100x/.mcp.json')).mcpServers['100x'];
  assert.deepEqual(claude.args, codex.args.map(arg => arg.replace('${PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}')));
  const desktop = (await read('plugins/100x/manifest.json')).server;
  assert.deepEqual(desktop.mcp_config.args, codex.args.map(arg => arg.replace('${PLUGIN_ROOT}', '${__dirname}')));
  assert.equal(desktop.mcp_config.args[0], '${__dirname}/' + desktop.entry_point);
  const marketplace = await read('.claude-plugin/marketplace.json');
  assert.equal(marketplace.name, (await read('.agents/plugins/marketplace.json')).name);
  assert.deepEqual(marketplace.plugins.map(item => [item.name, item.source]), [['100x', './plugins/100x']]);
});

test('connecting again while already connected keeps the saved credential instead of starting a new authorization', async () => {
  const { DeviceConnection } = await import('../plugins/100x/scripts/device-auth.mjs');
  const paths = [];
  const connection = new DeviceConnection({ HUNDREDX_URL: 'https://100xspeed.app/api/mcp', HUNDREDX_TOKEN: '100x_' + randomBytes(24).toString('hex'), HUNDREDX_CONFIG_PATH: resolve(folder, 'reconnect.json') }, {
    host: 'Claude Code',
    fetch: async endpoint => { paths.push(new URL(endpoint).pathname); return Response.json({ status: 'connected', device_id: 'mcp_cred_1' }); },
  });
  const state = await connection.connect();
  assert.equal(state.status, 'connected');
  assert.deepEqual(paths, ['/api/mcp/connection']);
});

test('a transient connection-check failure does not start a new authorization over the saved credential', async () => {
  const { DeviceConnection } = await import('../plugins/100x/scripts/device-auth.mjs');
  const paths = [];
  const connection = new DeviceConnection({ HUNDREDX_URL: 'https://100xspeed.app/api/mcp', HUNDREDX_TOKEN: '100x_' + randomBytes(24).toString('hex'), HUNDREDX_CONFIG_PATH: resolve(folder, 'transient.json') }, {
    host: 'Claude Code',
    fetch: async endpoint => { paths.push(new URL(endpoint).pathname); return Response.json({}, { status: 503 }); },
  });
  await assert.rejects(connection.connect(), { code: '100X_SERVICE_UNAVAILABLE' });
  assert.deepEqual(paths, ['/api/mcp/connection']);
});

test('device names keep the system suffix within the 64 UTF-16 unit server limit', async () => {
  const { DeviceConnection } = await import('../plugins/100x/scripts/device-auth.mjs');
  const connection = new DeviceConnection({}, { host: '🎬'.repeat(40), protection: { platform: 'win32' } });
  const name = connection.deviceName();
  assert.ok(name.length <= 64 && name.endsWith(' · Windows'), name);
  assert.equal(name.isWellFormed(), true);
});

test('after a denied or expired attempt, connecting again still reuses a credential another host saved meanwhile', async () => {
  const { DeviceConnection } = await import('../plugins/100x/scripts/device-auth.mjs');
  const paths = [];
  const connection = new DeviceConnection({ HUNDREDX_URL: 'https://100xspeed.app/api/mcp', HUNDREDX_TOKEN: '100x_' + randomBytes(24).toString('hex'), HUNDREDX_CONFIG_PATH: resolve(folder, 'stale.json') }, {
    host: 'Codex',
    fetch: async endpoint => { paths.push(new URL(endpoint).pathname); return Response.json({ status: 'connected' }); },
  });
  connection.loaded = true;
  for (const stale of [{ state: { status: 'denied' }, pending: null }, { state: null, pending: { url: 'https://100xspeed.app/api/mcp', deviceCode: 'a'.repeat(64), user_code: 'OLD1234567', expires_at: new Date(Date.now() - 1000).toISOString() } }]) {
    Object.assign(connection, stale);
    assert.equal((await connection.connect()).status, 'connected');
  }
  assert.deepEqual(paths, ['/api/mcp/connection', '/api/mcp/connection']);
});
