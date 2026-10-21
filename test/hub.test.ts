// The hub end to end: hook requests over HTTP as Claude Code sends them, a display over the WebSocket,
// holding, the hold time, cancelling, and the security checks.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { WebSocket } from 'ws';
import type { ServerMessage, StateMessage } from '../src/shared/protocol.js';
import { CODEX_HOOK_PATH, HOOK_PATH } from '../src/config.ts';
import { appSettingsXml } from '../src/hub/hardware.ts';
import {
  DENY_MESSAGE,
  DISPLAY_LOGIN_PATH,
  displayKey,
  displayStartPage,
  MAX_OPEN_PERMISSIONS,
  REJECTION_HINT_MS,
  REJECTION_LOG_INTERVAL_MS,
  startHub,
  type Hub,
  type HubOptions,
} from '../src/hub/hub.ts';

const ROOT = path.join(import.meta.dirname, '..');
const TOKEN = 'a'.repeat(64);
const hubs: Hub[] = [];
after(async () => {
  await Promise.all(hubs.map((hub) => hub.close()));
});

async function startTestHub(overrides: Partial<HubOptions> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-hub-'));
  const auditFile = path.join(dir, 'audit.jsonl');
  const hub = await startHub({
    port: 0,
    token: TOKEN,
    holdMs: 10_000,
    scale: 1,
    version: '0.0.0',
    sound: false,
    auditFile,
    uiRoot: path.join(ROOT, 'ui'),
    webRoot: path.join(dir, 'not-built'),
    log: () => {},
    ...overrides,
  });
  hubs.push(hub);
  return { hub, port: hub.port, auditFile };
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(
  port: number,
  options: { method?: string; path?: string; host?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): { reply: Promise<Reply>; abort: () => void } {
  const payload =
    options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  const req = http.request({
    host: '127.0.0.1',
    port,
    method: options.method ?? 'POST',
    path: options.path ?? HOOK_PATH,
    agent: false,
    headers: {
      Host: options.host ?? `127.0.0.1:${port}`,
      ...(payload === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(payload)) }),
      ...options.headers,
    },
  });
  const reply = new Promise<Reply>((resolve, reject) => {
    req.on('response', (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
  if (options.timeoutMs) req.setTimeout(options.timeoutMs, () => req.destroy(new Error('timeout')));
  if (payload !== undefined) req.write(payload);
  req.end();
  return { reply, abort: () => req.destroy() };
}

const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
/** The display's sign-in as its start file sends it; the answer is the page with the page token. */
function signIn(port: number, headers: Record<string, string> = {}) {
  return call(port, {
    method: 'POST',
    path: DISPLAY_LOGIN_PATH,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'null', ...headers },
    body: `key=${displayKey(TOKEN)}`,
  }).reply;
}

function hook(port: number, body: Record<string, unknown>, extra: { timeoutMs?: number } = {}) {
  return call(port, { headers: AUTH, body: { session_id: 'session-1', cwd: 'C:\\Projekte\\shop-api', ...body }, ...extra });
}

function permissionRequest(port: number, command = 'git push origin main', extra: { timeoutMs?: number } = {}) {
  return hook(port, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command } }, extra);
}

async function pageToken(port: number): Promise<string> {
  const { body } = await signIn(port);
  return /name="stellwerk-session" content="([0-9a-f]{64})"/.exec(body)![1]!;
}

/** A display connected over the WebSocket, with helpers to wait for what the hub sends. */
async function display(port: number) {
  const token = await pageToken(port);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ['stellwerk.v1', `stellwerk.session.${token}`], {
    origin: `http://127.0.0.1:${port}`,
  });
  const messages: ServerMessage[] = [];
  const listeners = new Set<() => void>();
  ws.on('message', (data) => {
    messages.push(JSON.parse(String(data)) as ServerMessage);
    for (const listener of listeners) listener();
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  function waitFor(test: (message: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = messages.findLast(test);
        if (!found) return;
        listeners.delete(check);
        clearTimeout(timer);
        resolve(found);
      };
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error('the hub did not send the expected message'));
      }, timeoutMs);
      listeners.add(check);
      check();
    });
  }

  return {
    ws,
    state: (test: (state: StateMessage) => boolean) =>
      waitFor((m) => m.type === 'state' && test(m)) as Promise<StateMessage>,
    decide: (id: string, decision: 'allow' | 'deny' | 'app') => ws.send(JSON.stringify({ type: 'decide', id, decision })),
    result: (id: string) => waitFor((m) => m.type === 'decision-result' && m.id === id),
    close: () => ws.close(),
  };
}

type Display = Awaited<ReturnType<typeof display>>;

async function openRequestId(screen: Display, tool = 'Bash'): Promise<string> {
  const state = await screen.state((s) => s.permissions.some((p) => p.outcome === null && p.tool === tool));
  return state.permissions.find((p) => p.outcome === null && p.tool === tool)!.id;
}

function auditLines(file: string): Array<Record<string, unknown>> {
  return fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
}

async function eventually(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('the display page', () => {
  test('is served with a strict content security policy and its page token', async () => {
    const { port } = await startTestHub();
    const page = await signIn(port);
    assert.equal(page.status, 200);
    const csp = String(page.headers['content-security-policy']);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, new RegExp(`connect-src ws://127\\.0\\.0\\.1:${port} ws://localhost:${port};`));
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.match(page.body, /name="stellwerk-session" content="[0-9a-f]{64}"/);
    assert.doesNotMatch(page.body, new RegExp(TOKEN));
    // Nothing inline: every script tag (any case, any attributes) loads a file, and there is no style
    // element or style attribute.
    const scripts = page.body.match(/<script\b[^>]*>/gi) ?? [];
    assert.ok(scripts.length > 0, 'the page loads its script');
    for (const tag of scripts) assert.match(tag, /\ssrc\s*=/i, `inline script: ${tag}`);
    assert.doesNotMatch(page.body, /<style\b/i);
    assert.doesNotMatch(page.body, /\sstyle\s*=/i);
  });

  test('only the listed files are served', async () => {
    const { port } = await startTestHub();
    assert.equal((await call(port, { method: 'GET', path: '/app.css' }).reply).status, 200);
    assert.equal((await call(port, { method: 'GET', path: '/static/fonts/RedHatMono/RedHatMonoVF.woff2' }).reply).status, 200);
    for (const p of ['/package.json', '/../package.json', '/ui/app.css', '/%2e%2e/package.json', '/index.html/x']) {
      assert.equal((await call(port, { method: 'GET', path: p }).reply).status, 404, p);
    }
  });

  test('carries the build it was served with, the same the hub names in every state', async () => {
    const { port } = await startTestHub();
    const { body } = await signIn(port);
    const pageBuild = /name="stellwerk-build" content="([0-9a-f]{16})"/.exec(body)?.[1];
    assert.ok(pageBuild, 'the page names its build');
    const screen = await display(port);
    assert.equal((await screen.state(() => true)).hub.build, pageBuild);
    screen.close();
  });

  test('a changed display file gives another build', async () => {
    const uiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-ui-'));
    fs.cpSync(path.join(ROOT, 'ui'), uiRoot, { recursive: true });
    const build = async () => {
      const { port } = await startTestHub({ uiRoot });
      const screen = await display(port);
      const value = (await screen.state(() => true)).hub.build;
      screen.close();
      return value;
    };
    const before = await build();
    assert.equal(await build(), before, 'the same files, the same build');
    fs.appendFileSync(path.join(uiRoot, 'app.css'), '\n.changed { color: red; }\n');
    assert.notEqual(await build(), before);
  });

  test('names the version in its signature, and a new version gives another build', async () => {
    const page = async (version: string) => {
      const { port } = await startTestHub({ version });
      const { body } = await signIn(port);
      return { body, build: /name="stellwerk-build" content="([0-9a-f]{16})"/.exec(body)?.[1] };
    };
    const first = await page('1.2.3');
    assert.match(first.body, /<span class="az-signature__mark">Azentrius<\/span>/);
    assert.match(first.body, /<span>Stellwerk 1\.2\.3<\/span>/);
    assert.doesNotMatch(first.body, /\{\{\w+\}\}/, 'every placeholder is filled');
    assert.notEqual((await page('1.2.4')).build, first.build);
  });
});

describe('security checks', () => {
  test('a foreign Host header is turned away (DNS rebinding)', async () => {
    const { port } = await startTestHub();
    assert.equal((await call(port, { method: 'GET', path: '/', host: `evil.example:${port}` }).reply).status, 403);
    assert.equal((await call(port, { method: 'GET', path: '/', host: `127.0.0.1:${port + 1}` }).reply).status, 403);
    assert.equal((await call(port, { headers: AUTH, host: 'evil.example', body: { hook_event_name: 'Stop', session_id: 'x' } }).reply).status, 403);
    assert.equal((await call(port, { method: 'GET', path: '/', host: `localhost:${port}` }).reply).status, 200);
  });

  test('hook requests need the token (401) and JSON (415)', async () => {
    const { port, hub } = await startTestHub();
    const body = { hook_event_name: 'Stop', session_id: 'x' };
    assert.equal((await call(port, { headers: { 'Content-Type': 'application/json' }, body }).reply).status, 401);
    assert.equal((await call(port, { headers: { ...AUTH, Authorization: `Bearer ${'b'.repeat(64)}` }, body }).reply).status, 401);
    assert.equal((await call(port, { headers: { ...AUTH, Authorization: TOKEN }, body }).reply).status, 401);
    assert.equal((await call(port, { headers: { ...AUTH, 'Content-Type': 'text/plain' }, body }).reply).status, 415);
    assert.equal((await call(port, { headers: { Authorization: AUTH.Authorization }, body }).reply).status, 415);
    assert.equal(hub.board.sessions.size, 0);
  });

  test('wrong method, bad JSON, invalid data and oversized bodies are rejected', async () => {
    const { port } = await startTestHub();
    assert.equal((await call(port, { method: 'GET' }).reply).status, 405);
    assert.equal((await call(port, { headers: AUTH, body: '{"hook_event_name":' }).reply).status, 400);
    assert.equal((await call(port, { headers: AUTH, body: { hook_event_name: 'Stop' } }).reply).status, 400);
    const big = JSON.stringify({ hook_event_name: 'Stop', session_id: 'x', pad: 'x'.repeat(1024 * 1024) });
    assert.equal((await call(port, { headers: AUTH, body: big }).reply).status, 413);
  });

  test('a CORS preflight gets no answer that would let a web page through', async () => {
    const { port } = await startTestHub();
    const reply = await call(port, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    }).reply;
    assert.equal(reply.status, 405);
    assert.equal(reply.headers['access-control-allow-origin'], undefined);
  });

  test('the WebSocket needs our origin, the page token and the right path', async () => {
    const { port } = await startTestHub();
    const token = await pageToken(port);
    const attempt = (url: string, protocols: string[], origin: string) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(url, protocols, { origin });
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        ws.on('open', () => {
          ws.close();
          resolve(101);
        });
        ws.on('error', () => {});
      });
    const url = `ws://127.0.0.1:${port}/ws`;
    const own = `http://127.0.0.1:${port}`;
    assert.equal(await attempt(url, ['stellwerk.v1', `stellwerk.session.${token}`], own), 101);
    assert.equal(await attempt(url, ['stellwerk.v1', `stellwerk.session.${token}`], 'https://evil.example'), 403);
    assert.equal(await attempt(url, ['stellwerk.v1', `stellwerk.session.${'0'.repeat(64)}`], own), 403);
    assert.equal(await attempt(url, ['stellwerk.v1'], own), 403);
    assert.equal(await attempt(`ws://127.0.0.1:${port}/other`, ['stellwerk.v1', `stellwerk.session.${token}`], own), 404);
  });
});

describe('the display sign-in', () => {
  const token = (body: string) => /name="stellwerk-session" content="([0-9a-f]{64})"/.exec(body)?.[1] ?? null;

  test('the address alone gets the display without its page token, and no cookie at all', async () => {
    const { port } = await startTestHub();
    const page = await call(port, { method: 'GET', path: '/' }).reply;
    assert.equal(page.status, 200);
    assert.match(page.body, /name="stellwerk-session" content=""/);
    assert.equal(token(page.body), null);
    assert.equal(page.headers['set-cookie'], undefined);
  });

  test('only the start file gets the page token, in the answer itself; the key is in no address and no log', async () => {
    const lines: string[] = [];
    const { port } = await startTestHub({ log: (line) => lines.push(line) });
    const key = displayKey(TOKEN);
    const start = displayStartPage(port, key);
    assert.match(start, new RegExp(`action="http://127\\.0\\.0\\.1:${port}${DISPLAY_LOGIN_PATH}"`));
    assert.doesNotMatch(start.match(/action="[^"]*"/)![0], new RegExp(key), 'the key is in the body, not the address');
    assert.ok(!start.includes(TOKEN), 'the start file does not reveal the hook token');

    const reply = await signIn(port);
    assert.equal(reply.status, 200);
    assert.notEqual(token(reply.body), null);
    assert.equal(reply.headers['set-cookie'], undefined, 'nothing the browser would send to other ports');
    assert.match(String(reply.headers['content-security-policy']), /default-src 'none'/);
    assert.equal(reply.headers['cache-control'], 'no-store');

    const login = (body: string, headers: Record<string, string> = {}) =>
      call(port, {
        method: 'POST',
        path: DISPLAY_LOGIN_PATH,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'null', ...headers },
        body,
      }).reply;
    assert.equal((await login(`key=${'0'.repeat(64)}`)).status, 403, 'a wrong key');
    assert.equal((await login('key=')).status, 403, 'no key');
    assert.equal((await login(`key=${key}`, { Origin: 'https://evil.example' })).status, 403, 'a foreign page');
    assert.equal((await login(`key=${key}`, { Host: `evil.example:${port}` })).status, 403, 'a foreign host');
    assert.equal((await login(`key=${key}`, { 'Content-Type': 'application/json' })).status, 415);
    assert.equal((await login(`key=${key}&pad=${'x'.repeat(2000)}`)).status, 413);
    assert.equal((await call(port, { method: 'GET', path: DISPLAY_LOGIN_PATH }).reply).status, 405);
    assert.ok(lines.some((line) => line.includes('wrong key')));
    assert.doesNotMatch(lines.join('\n'), new RegExp(key));
  });

  test('without the page token a client is turned away; with it the display decides', async () => {
    const { port } = await startTestHub();
    const refused = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ['stellwerk.v1'], { origin: `http://127.0.0.1:${port}` });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
      ws.on('error', () => {});
    });
    assert.equal(refused, 403);
    const screen = await display(port);
    const pending = permissionRequest(port);
    screen.decide(await openRequestId(screen), 'allow');
    assert.equal(JSON.parse((await pending.reply).body).hookSpecificOutput.decision.behavior, 'allow');
    screen.close();
  });

  test('a signed-in display reconnects to a restarted hub with the same token', async () => {
    const first = await startTestHub();
    const pageToken = token((await signIn(first.port)).body)!;
    await first.hub.close();
    const second = await startTestHub();
    const ws = new WebSocket(`ws://127.0.0.1:${second.port}/ws`, ['stellwerk.v1', `stellwerk.session.${pageToken}`], {
      origin: `http://127.0.0.1:${second.port}`,
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.close();
  });
});

describe('the hub keeps running', () => {
  /** Sends a raw request and returns the status line of the answer. */
  function raw(port: number, request: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => socket.write(request));
      let data = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => (data += chunk));
      socket.on('close', () => resolve(data.split('\r\n')[0] ?? ''));
      socket.on('error', reject);
      socket.setTimeout(3000, () => socket.destroy(new Error('timeout')));
    });
  }
  const upgrade = (target: string, host: string) =>
    `GET ${target} HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
    'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n';

  test('after an upgrade with an unreadable target, with our host or a foreign one', async () => {
    const { port } = await startTestHub();
    assert.match(await raw(port, upgrade('http://[', `127.0.0.1:${port}`)), /^HTTP\/1\.1 400/);
    assert.match(await raw(port, upgrade('http://[', 'evil.example')), /^HTTP\/1\.1 403/);
    assert.match(await raw(port, `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 400/);
    // Still there: a display connects and a request is decided.
    const screen = await display(port);
    const pending = permissionRequest(port);
    screen.decide(await openRequestId(screen), 'allow');
    assert.equal(JSON.parse((await pending.reply).body).hookSpecificOutput.decision.behavior, 'allow');
    screen.close();
  });

  test('after a display message over the limit: only that connection closes', async () => {
    const { port } = await startTestHub();
    const noisy = await display(port);
    const closed = new Promise<number>((resolve) => noisy.ws.once('close', (code) => resolve(code)));
    noisy.ws.on('error', () => {});
    noisy.ws.send('x'.repeat(4097));
    assert.equal(await closed, 1009, 'message too big');
    const screen = await display(port);
    const pending = permissionRequest(port);
    screen.decide(await openRequestId(screen), 'deny');
    assert.equal(JSON.parse((await pending.reply).body).hookSpecificOutput.decision.behavior, 'deny');
    screen.close();
  });
});

describe('rejections on the console', () => {
  const STOP = { hook_event_name: 'Stop', session_id: 'x' };
  const WRONG = 'b'.repeat(64);

  test('the display hears how many were turned away, when and why the last, never what they carried', async () => {
    let clock = 1_000_000;
    const { port } = await startTestHub({ now: () => clock });
    const screen = await display(port);
    assert.equal((await screen.state(() => true)).hub.rejected, null);
    await call(port, { headers: { ...AUTH, Authorization: `Bearer ${WRONG}` }, body: STOP }).reply;
    clock += 1000;
    await call(port, { headers: AUTH, body: STOP, host: `evil.example:${port}` }).reply;
    const state = await screen.state((s) => s.hub.rejected?.count === 2);
    assert.deepEqual(state.hub.rejected, { count: 2, lastAt: 1_001_000, until: 1_001_000 + REJECTION_HINT_MS, reason: 'foreign' });
    assert.doesNotMatch(JSON.stringify(state), new RegExp(`${WRONG}|${TOKEN}|evil`));
    // Within the hour they add up; after a quiet hour the next one counts from one.
    clock += 60_000;
    await call(port, { headers: AUTH, body: '{"hook_event_name":' }).reply;
    assert.equal((await screen.state((s) => s.hub.rejected?.lastAt === clock)).hub.rejected?.count, 3);
    clock += REJECTION_HINT_MS;
    await call(port, { headers: { ...AUTH, Authorization: `Bearer ${WRONG}` }, body: STOP }).reply;
    const again = await screen.state((s) => s.hub.rejected?.lastAt === clock);
    assert.deepEqual([again.hub.rejected?.count, again.hub.rejected?.reason], [1, 'token']);
    screen.close();
  });

  test('the display knows whether the raw hook log is on', async () => {
    const off = await startTestHub();
    const offScreen = await display(off.port);
    assert.equal((await offScreen.state(() => true)).hub.rawLog, false);
    offScreen.close();
    const rawLogFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-raw-')), 'debug-raw.jsonl');
    const on = await startTestHub({ rawLogFile });
    const onScreen = await display(on.port);
    assert.equal((await onScreen.state(() => true)).hub.rawLog, true);
    assert.doesNotMatch(JSON.stringify(await onScreen.state(() => true)), /debug-raw/, 'not where it is');
    onScreen.close();
  });

  test('say why a request was turned away, and never show a token', async () => {
    const lines: string[] = [];
    const { port } = await startTestHub({ log: (line) => lines.push(line) });
    await call(port, { headers: { 'Content-Type': 'application/json' }, body: STOP }).reply;
    await call(port, { headers: { ...AUTH, Authorization: `Bearer ${WRONG}` }, body: STOP }).reply;
    await call(port, { headers: { ...AUTH, 'Content-Type': 'text/plain' }, body: STOP }).reply;
    await call(port, { headers: AUTH, body: STOP, host: `evil.example:${port}` }).reply;
    await call(port, { headers: AUTH, body: '{"hook_event_name":' }).reply;
    await call(port, { headers: AUTH, body: { hook_event_name: 'Stop' } }).reply;
    await call(port, { method: 'GET' }).reply;

    const expected = [
      /Rejected hook request without a token \(401\)\. Run "stellwerk hooks install"/,
      /Rejected hook request with a wrong token \(401\)/,
      /Rejected hook request with the content type "text\/plain" \(415\)/,
      /Rejected request with the Host header "evil\.example:\d+" \(403\)/,
      /Rejected hook request that is not valid JSON \(400\)/,
      /Rejected hook data without the expected fields \(400\): .*session_id/,
      /Rejected "GET" request to the hook endpoint \(405\)/,
    ];
    assert.equal(lines.length, expected.length, lines.join('\n'));
    expected.forEach((pattern, i) => assert.match(lines[i]!, pattern));
    for (const line of lines) {
      assert.doesNotMatch(line, new RegExp(TOKEN));
      assert.doesNotMatch(line, new RegExp(WRONG));
      assert.match(line, /^\d\d:\d\d:\d\d {2}Rejected /);
    }
  });

  test('an empty "Bearer " (STELLWERK_TOKEN not set for Claude Code) counts as no token', async () => {
    const lines: string[] = [];
    const { port } = await startTestHub({ log: (line) => lines.push(line) });
    const reply = await call(port, { headers: { ...AUTH, Authorization: 'Bearer ' }, body: STOP }).reply;
    assert.equal(reply.status, 401);
    assert.match(lines[0] ?? '', /without a token/);
  });

  test('the same reason is reported at most once a minute, with the number of repeats', async () => {
    const lines: string[] = [];
    let clock = 1_000_000;
    const { port } = await startTestHub({ log: (line) => lines.push(line), now: () => clock });
    const noToken = () => call(port, { headers: { 'Content-Type': 'application/json' }, body: STOP }).reply;
    await noToken();
    await noToken();
    await noToken();
    assert.equal(lines.length, 1);
    clock += REJECTION_LOG_INTERVAL_MS;
    await noToken();
    assert.equal(lines.length, 2);
    assert.match(lines[1]!, /\(2 more since the last message\)$/);
  });

  test('rejected display connections are reported too', async () => {
    const lines: string[] = [];
    const { port } = await startTestHub({ log: (line) => lines.push(line) });
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ['stellwerk.v1'], { origin: 'https://evil.example' });
      ws.on('unexpected-response', () => resolve());
      ws.on('error', () => {});
    });
    assert.match(lines[0] ?? '', /Rejected display connection from the origin "https:\/\/evil\.example" \(403\)/);
  });
});

describe('open pull requests', () => {
  test('without a GitHub token the hub asks nobody and the state says so', async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    const state = await screen.state(() => true);
    assert.equal(state.github, null);
    assert.deepEqual(state.pullRequests, []);
    screen.close();
  });

  test('with a token the display gets the list and when it was brought up to date', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.href);
      const body: Record<string, unknown> = {
        '/orgs/acme/repos': [{ name: 'api' }],
        '/repos/acme/api/pulls': [
          { number: 7, title: 'Bump zod', updated_at: '2026-10-15T10:00:00Z', user: { login: 'dependabot[bot]' }, head: { sha: 'a'.repeat(40) } },
        ],
        '/repos/acme/api/actions/runs': { workflow_runs: [{ status: 'completed', conclusion: 'failure' }] },
      };
      return new Response(JSON.stringify(body[url.pathname]), { status: 200 });
    }) as typeof fetch;
    const { port } = await startTestHub({ github: { owner: 'acme', token: `github_pat_${'t'.repeat(30)}`, intervalMs: 60_000, fetch: fakeFetch } });
    const screen = await display(port);
    const state = await screen.state((s) => s.pullRequests.length === 1);
    assert.deepEqual(state.pullRequests[0], {
      repo: 'api', number: 7, title: 'Bump zod', author: 'dependabot[bot]', draft: false, updatedAt: Date.parse('2026-10-15T10:00:00Z'), checks: 'failing',
    });
    assert.equal(state.github?.owner, 'acme');
    assert.equal(state.github?.problem, null);
    assert.ok(state.github?.syncedAt);
    assert.doesNotMatch(JSON.stringify(state), /github_pat_/, 'the token never reaches the display');
    assert.ok(calls.every((u) => u.startsWith('https://api.github.com/')));
    screen.close();
  });

  test("with a token the display hears of a newer release of Stellwerk, not of the one it runs", async () => {
    let latest = 'v0.6.0';
    const fakeFetch = (async (input: string | URL | Request) => {
      const { pathname } = new URL(String(input));
      if (pathname === '/repos/Azentrius/stellwerk/releases/latest') return new Response(JSON.stringify({ tag_name: latest }), { status: 200 });
      return new Response(JSON.stringify(pathname === '/orgs/acme/repos' ? [] : {}), { status: 200 });
    }) as typeof fetch;
    const github = { owner: 'acme', token: `github_pat_${'t'.repeat(30)}`, intervalMs: 60_000, fetch: fakeFetch };
    const newer = await startTestHub({ version: '0.5.4', github });
    const screen = await display(newer.port);
    assert.equal((await screen.state((s) => s.hub.newRelease !== null)).hub.newRelease, '0.6.0');
    screen.close();
    latest = 'v0.5.4';
    const same = await startTestHub({ version: '0.5.4', github });
    const other = await display(same.port);
    assert.equal((await other.state((s) => s.github?.syncedAt !== null)).hub.newRelease, null);
    other.close();
    const without = await startTestHub({ version: '0.5.4' });
    const plain = await display(without.port);
    assert.equal((await plain.state(() => true)).hub.newRelease, null, 'without a token nobody is asked');
    plain.close();
  });
});

describe('hardware values', () => {
  test('without the hardware monitor the state has none', async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    assert.equal((await screen.state(() => true)).hardware, null);
    screen.close();
  });

  test('with it the display gets the values picked from LibreHardwareMonitor, never its password', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-lhm-'));
    const settingsFile = path.join(dir, 'LibreHardwareMonitor.config');
    fs.writeFileSync(settingsFile, appSettingsXml(new Map([
      ['authenticationEnabled', 'true'],
      ['authenticationUserName', 'stellwerk'],
      ['authenticationPassword', 'secret-password-1'],
    ])));
    const calls: string[] = [];
    const leaf = (id: string, name: string, type: string, value: string) => ({ Text: name, SensorId: id, Type: type, RawValue: value, Children: [] });
    const fakeFetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        Text: 'Sensor',
        Children: [{ Text: 'PC', Children: [
          leaf('/intelcpu/0/load/0', 'CPU Total', 'Load', '12,0 %'),
          leaf('/intelcpu/0/temperature/1', 'CPU Package', 'Temperature', '55,0 °C'),
        ] }],
      }), { status: 200 });
    }) as typeof fetch;
    const { port } = await startTestHub({ hardware: { settingsFile, intervalMs: 60_000, fetch: fakeFetch } });
    const screen = await display(port);
    const state = await screen.state((s) => s.hardware?.values !== null && s.hardware?.values !== undefined);
    assert.deepEqual(state.hardware?.values, { cpu: { load: 12, temperature: 55 }, gpu: null, memory: null });
    assert.equal(state.hardware?.problem, null);
    assert.doesNotMatch(JSON.stringify(state), /secret-password/);
    assert.deepEqual(calls, ['http://127.0.0.1:8085/data.json']);
    screen.close();
  });
});

describe("Uptime Kuma's monitors", () => {
  test('without Uptime Kuma the state has none', async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    assert.equal((await screen.state(() => true)).uptimeKuma, null);
    screen.close();
  });

  test('with it the display gets what fails and how many work, never the API key', async () => {
    const key = `uk1_${'k3Y-_'.repeat(8)}`;
    const calls: Array<{ url: string; authorization: string | undefined }> = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), authorization: (init?.headers as Record<string, string>).Authorization });
      return new Response(
        '# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)\n# TYPE monitor_status gauge\n' +
          'monitor_status{monitor_id="1",monitor_name="Server - web",monitor_type="ping"} 1\n' +
          'monitor_status{monitor_id="2",monitor_name="Backup - web",monitor_type="push"} 0\n' +
          'monitor_status{monitor_id="3",monitor_name="Docs",monitor_type="http"} 3\n',
        { status: 200 },
      );
    }) as typeof fetch;
    const { port } = await startTestHub({ uptimeKuma: { url: 'http://192.0.2.10:3001', key, intervalMs: 60_000, fetch: fakeFetch } });
    const screen = await display(port);
    const state = await screen.state((s) => s.uptimeKuma?.monitors !== null && s.uptimeKuma?.monitors !== undefined);
    assert.deepEqual(state.uptimeKuma?.monitors, { failing: [{ name: 'Backup - web', status: 'down', since: null }], up: 1, maintenance: 1 });
    assert.equal(state.uptimeKuma?.problem, null);
    assert.doesNotMatch(JSON.stringify(state), new RegExp(key));
    assert.deepEqual(calls.map((c) => c.url), ['http://192.0.2.10:3001/metrics']);
    assert.equal(calls[0]!.authorization, `Basic ${Buffer.from(`stellwerk:${key}`).toString('base64')}`);
    screen.close();
  });

  test('since when a monitor fails is there again after a restart of the hub', async () => {
    const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-hub-')), 'stellwerk', 'uptime-kuma.json');
    let rounds = 0;
    // Up at the first answer, down from the second on: the hub sees it go down.
    const fakeFetch = (async () =>
      new Response(
        `# TYPE monitor_status gauge\nmonitor_status{monitor_id="1",monitor_name="Server - web",monitor_type="ping"} ${rounds++ === 0 ? 1 : 0}\n`,
        { status: 200 },
      )) as typeof fetch;
    const kuma = { url: 'http://192.0.2.10:3001', key: `uk1_${'k3Y-_'.repeat(8)}`, intervalMs: 30, stateFile, fetch: fakeFetch };
    const first = await startTestHub({ uptimeKuma: kuma });
    const screen = await display(first.port);
    const down = await screen.state((s) => typeof s.uptimeKuma?.monitors?.failing[0]?.since === 'number');
    const since = down.uptimeKuma!.monitors!.failing[0]!.since;
    screen.close();
    await first.hub.close();

    const second = await startTestHub({ uptimeKuma: { ...kuma, intervalMs: 60_000 } });
    const again = await display(second.port);
    const state = await again.state((s) => (s.uptimeKuma?.monitors?.failing.length ?? 0) > 0);
    assert.deepEqual(state.uptimeKuma?.monitors?.failing, [{ name: 'Server - web', status: 'down', since }], 'the time of the last run');
    again.close();
  });
});

describe('Codex', () => {
  const RECORDED_AT = '2026-10-18T01:00:05.000Z';
  /** A Codex transcript folder with one rollout whose last turn has the given approval reviewer. */
  function codexRollout(reviewer: string, tokens = 182_031, rateLimits: Record<string, unknown> | null = null): { codexRoot: string; transcript: string } {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-codex-'));
    const codexRoot = path.join(home, 'sessions');
    const day = path.join(codexRoot, '2026', '10', '18');
    fs.mkdirSync(day, { recursive: true });
    const transcript = path.join(day, 'rollout-2026-10-18T01-00-00-abc.jsonl');
    fs.writeFileSync(
      transcript,
      `${JSON.stringify({ type: 'turn_context', payload: { approval_policy: 'on-request', approvals_reviewer: reviewer, cwd: 'C:\\x' } })}\n` +
        `${JSON.stringify({
          timestamp: RECORDED_AT,
          type: 'event_msg',
          payload: { type: 'token_count', info: { last_token_usage: { total_tokens: tokens }, model_context_window: 258_400 }, rate_limits: rateLimits },
        })}\n`,
    );
    return { codexRoot, transcript };
  }
  const codexHook = (port: number, body: Record<string, unknown>, extra: { timeoutMs?: number } = {}) =>
    call(port, {
      path: CODEX_HOOK_PATH,
      headers: AUTH,
      body: { session_id: 'codex-1', cwd: 'C:\\Projekte\\OpenAuto AI', model: 'gpt-6-astra', permission_mode: 'default', ...body },
      ...extra,
    });

  test('a request is held on the display and the decision goes back in the shape Codex reads', async () => {
    const { codexRoot, transcript } = codexRollout('user');
    const { port } = await startTestHub({ codexHoldMs: 30_000, context: { root: path.join(codexRoot, 'none'), codexRoot, intervalMs: 20 } });
    const screen = await display(port);
    // The Codex app names transcripts with the long-path prefix.
    const pending = codexHook(port, {
      hook_event_name: 'PermissionRequest',
      transcript_path: `\\\\?\\${transcript}`,
      turn_id: 't1',
      tool_name: 'Bash',
      tool_input: { command: 'git fetch', description: 'Fetch the latest state' },
    });
    const state = await screen.state((s) => s.permissions.some((p) => p.outcome === null));
    const card = state.permissions[0]!;
    assert.equal(card.provider, 'codex');
    assert.equal(state.sessions[0]?.provider, 'codex');
    assert.deepEqual(card.input, { command: 'git fetch', description: 'Fetch the latest state' });
    screen.decide(card.id, 'allow');
    const reply = await pending.reply;
    assert.deepEqual(JSON.parse(reply.body), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    // Not just "not null": a state without the session would pass that too.
    const ring = await screen.state((s) => s.sessions[0]?.context != null);
    assert.deepEqual(ring.sessions[0]?.context, { used: 182_031, size: 258_400 }, 'the window comes from the transcript');
    screen.close();
  });

  test("a session of Codex' command line is marked as such, also on its card", async () => {
    const { codexRoot, transcript } = codexRollout('user');
    const meta = { timestamp: RECORDED_AT, type: 'session_meta', payload: { id: 'codex-1', originator: 'codex-tui', cli_version: '0.163.0' } };
    fs.writeFileSync(transcript, `${JSON.stringify(meta)}\n${fs.readFileSync(transcript, 'utf8')}`);
    const { port, hub } = await startTestHub({ context: { root: codexRoot, codexRoot, intervalMs: 20 } });
    const screen = await display(port);
    await codexHook(port, { hook_event_name: 'UserPromptSubmit', transcript_path: transcript, prompt: 'a secret prompt' }).reply;
    const state = await screen.state((s) => s.sessions[0]?.terminal === true);
    assert.equal(state.sessions[0]?.provider, 'codex');
    const pending = codexHook(port, { hook_event_name: 'PermissionRequest', transcript_path: transcript, tool_name: 'Bash', tool_input: { command: 'curl https://example.com' } });
    assert.equal((await screen.state((s) => s.permissions.length === 1)).permissions[0]?.terminal, true);
    assert.doesNotMatch(JSON.stringify(state), /secret/);
    screen.close();
    await hub.close();
    assert.equal((await pending.reply).body, '', 'stopping, the hub gives it back to the terminal');
  });

  test('after its own hold time the request goes back empty, so the Codex app shows its card', async () => {
    const { codexRoot, transcript } = codexRollout('user');
    const { port } = await startTestHub({ codexHoldMs: 150, context: { root: codexRoot, codexRoot } });
    const started = Date.now();
    const reply = await codexHook(port, { hook_event_name: 'PermissionRequest', transcript_path: transcript, tool_name: 'Bash', tool_input: { command: 'ls' } }).reply;
    assert.equal(reply.body, '');
    assert.ok(Date.now() - started < 5_000, 'the short hold, not the hold of 10 s for the other agents');
  });

  test('with "approve for me" Codex decides itself: no card, no waiting', async () => {
    const { codexRoot, transcript } = codexRollout('auto_review');
    const { port, hub } = await startTestHub({ codexHoldMs: 30_000, context: { root: codexRoot, codexRoot } });
    const reply = await codexHook(port, { hook_event_name: 'PermissionRequest', transcript_path: transcript, tool_name: 'Bash', tool_input: { command: 'ls' } }, { timeoutMs: 3000 }).reply;
    assert.equal(reply.status, 200);
    assert.equal(reply.body, '');
    assert.equal(hub.board.pendingCount(), 0);
  });

  test("the app's helper sessions (no transcript) are no agents; a question waits until the answer", async () => {
    const { codexRoot, transcript } = codexRollout('user');
    const { port, hub } = await startTestHub({ context: { root: codexRoot, codexRoot } });
    for (const name of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
      assert.equal((await codexHook(port, { session_id: 'helper', hook_event_name: name, transcript_path: null, source: 'fork' }).reply).status, 200);
    }
    assert.equal(hub.board.sessions.has('helper'), false);

    await codexHook(port, { hook_event_name: 'UserPromptSubmit', transcript_path: transcript, prompt: 'a secret prompt' }).reply;
    await codexHook(port, {
      hook_event_name: 'PostToolUse',
      transcript_path: transcript,
      tool_name: 'request_user_input_async',
      tool_input: { questions: [{ title: 'Fetch the latest state?', options: ['Yes', 'No'] }] },
    }).reply;
    const waiting = hub.board.view().sessions[0];
    assert.deepEqual([waiting?.status, waiting?.waitingFor, waiting?.question], ['waiting', 'question', 'Fetch the latest state?']);
    // An interrupt ends the turn like Stop; the question asked is still open until the answer comes.
    await codexHook(port, { hook_event_name: 'Interrupt', transcript_path: transcript }).reply;
    assert.equal(hub.board.view().sessions[0]?.waitingFor, 'question', 'the turn ended, the question did not');
    await codexHook(port, { hook_event_name: 'UserPromptSubmit', transcript_path: transcript, prompt: 'Yes' }).reply;
    await codexHook(port, { hook_event_name: 'Stop', transcript_path: transcript }).reply;
    assert.equal(hub.board.view().sessions[0]?.status, 'done', 'answered, and the turn over');
    assert.doesNotMatch(JSON.stringify(hub.board.view()), /secret/);
  });

  test("a session is named as in Codex' session index, the project stays below", async () => {
    const { codexRoot, transcript } = codexRollout('user');
    const codexIndex = path.join(path.dirname(codexRoot), 'session_index.jsonl');
    fs.writeFileSync(codexIndex, `${JSON.stringify({ id: 'codex-1', thread_name: 'Planning & Concept', updated_at: RECORDED_AT })}\n`);
    const { port } = await startTestHub({ context: { root: codexRoot, codexRoot, codexIndex, intervalMs: 20 } });
    const screen = await display(port);
    await codexHook(port, { hook_event_name: 'UserPromptSubmit', transcript_path: transcript, prompt: 'x' }).reply;
    const state = await screen.state((s) => s.sessions[0]?.title !== null && s.sessions[0]?.title !== undefined);
    assert.deepEqual([state.sessions[0]?.title, state.sessions[0]?.project], ['Planning & Concept', 'OpenAuto AI']);
    screen.close();
  });

  test('the project is the one the Codex app files the chat under, not the folder', async () => {
    const { codexRoot, transcript } = codexRollout('user');
    const codexStateFile = path.join(path.dirname(codexRoot), '.codex-global-state.json');
    fs.writeFileSync(
      codexStateFile,
      JSON.stringify({
        'local-projects': { p1: { name: 'Lautwerk - Codex', rootPaths: ['C:\\Projekte\\OpenAuto AI'] } },
        'thread-project-assignments': { 'codex-1': { projectKind: 'local', projectId: 'p1' } },
      }),
    );
    const { port } = await startTestHub({ codexHoldMs: 30_000, codexStateFile, context: { root: codexRoot, codexRoot } });
    const screen = await display(port);
    const pending = codexHook(port, { hook_event_name: 'PermissionRequest', transcript_path: transcript, tool_name: 'Bash', tool_input: { command: 'ls' } });
    const state = await screen.state((s) => s.sessions[0]?.project === 'Lautwerk - Codex' && s.permissions.length > 0);
    assert.equal(state.permissions[0]?.project, 'Lautwerk - Codex', 'the card too');
    assert.equal(state.sessions[0]?.cwd, 'C:\\Projekte\\OpenAuto AI');
    screen.decide(state.permissions[0]!.id, 'app');
    await pending.reply;
    screen.close();
  });

  test("the usage of the plan's limits comes from the transcript and is there again after a restart", async () => {
    const resetsAt = Math.round(Date.now() / 1000) + 3600;
    const { codexRoot, transcript } = codexRollout('user', 182_031, {
      limit_id: 'codex',
      primary: { used_percent: 74, window_minutes: 10_080, resets_at: resetsAt },
      secondary: null,
      plan_type: 'prolite',
    });
    const plansFile = path.join(path.dirname(codexRoot), 'stellwerk', 'plans.json');
    const first = await startTestHub({ plansFile, context: { root: codexRoot, codexRoot, intervalMs: 20 } });
    const screen = await display(first.port);
    assert.deepEqual((await screen.state(() => true)).plans, [], 'nothing before the first Codex event');
    await codexHook(first.port, { hook_event_name: 'UserPromptSubmit', transcript_path: transcript, prompt: 'x' }).reply;
    const expected = [{ provider: 'codex', limits: [{ used: 74, windowMinutes: 10_080, resetsAt: resetsAt * 1000 }], recordedAt: Date.parse(RECORDED_AT) }];
    assert.deepEqual((await screen.state((s) => s.plans.length > 0)).plans, expected);
    screen.close();
    await first.hub.close();

    const second = await startTestHub({ plansFile });
    const again = await display(second.port);
    assert.deepEqual((await again.state(() => true)).plans, expected, 'remembered, before any Codex event');
    again.close();
  });

  test('the Codex endpoint has the same checks: token, content type, host', async () => {
    const { port } = await startTestHub();
    const body = { session_id: 'c', hook_event_name: 'Stop', transcript_path: 'C:\\x.jsonl' };
    assert.equal((await call(port, { path: CODEX_HOOK_PATH, headers: { 'Content-Type': 'application/json' }, body }).reply).status, 401);
    assert.equal((await call(port, { path: CODEX_HOOK_PATH, headers: { ...AUTH, Authorization: 'Bearer wrong' }, body }).reply).status, 401);
    assert.equal((await call(port, { path: CODEX_HOOK_PATH, headers: { Authorization: AUTH.Authorization, 'Content-Type': 'text/plain' }, body }).reply).status, 415);
    assert.equal((await call(port, { path: CODEX_HOOK_PATH, host: 'evil.example:80', headers: AUTH, body }).reply).status, 403);
    assert.equal((await call(port, { path: CODEX_HOOK_PATH, headers: AUTH, body: { hook_event_name: 'Stop' } }).reply).status, 400);
  });
});

describe('context usage', () => {
  test('the display gets how full a session is from its transcript, never its content', async () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-hub-ctx-')), 'projects');
    fs.mkdirSync(path.join(root, 'C--Projekte-shop-api'), { recursive: true });
    const transcript = path.join(root, 'C--Projekte-shop-api', 'session-1.jsonl');
    fs.writeFileSync(
      transcript,
      `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'a secret prompt' } })}\n` +
        `${JSON.stringify({
          type: 'assistant',
          message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'a secret answer' }], usage: { input_tokens: 4, cache_read_input_tokens: 590_000, output_tokens: 1_496 } },
        })}\n`,
    );
    const { port } = await startTestHub({ context: { root, intervalMs: 20 } });
    const screen = await display(port);
    await hook(port, { hook_event_name: 'Stop', transcript_path: transcript }).reply;
    const state = await screen.state((s) => s.sessions[0]?.context !== null && s.sessions[0]?.context !== undefined);
    assert.deepEqual(state.sessions[0]?.context, { used: 591_500, size: 1_000_000, model: 'claude-opus-5-5' });
    assert.doesNotMatch(JSON.stringify(state), /secret|session-1\.jsonl/);
    screen.close();
  });

  test('a transcript outside the transcripts folder is not read', async () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-hub-ctx-')), 'projects');
    fs.mkdirSync(root, { recursive: true });
    const outside = path.join(path.dirname(root), 'other.jsonl');
    fs.writeFileSync(outside, `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 100 } } })}\n`);
    const { port, hub } = await startTestHub({ context: { root, intervalMs: 20 } });
    await hook(port, { hook_event_name: 'Stop', transcript_path: outside }).reply;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(hub.board.view().sessions[0]?.context, null);
  });
});

describe("the plan's limits", () => {
  test("come from a session's call of the desktop app's usage tool, never its context", async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    const answer = {
      plan: { status: 'ok', windows: [{ label: '5-hour limit', percentUsed: 28, resetsAt: '2026-10-18T05:10:00.295Z' }] },
      context: { status: 'ok', tokensUsed: 328_671, categories: [{ name: 'secret category', tokens: 1 }] },
    };
    const reply = await hook(port, {
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__ccd_session_mgmt__get_usage',
      tool_input: {},
      tool_response: [{ type: 'text', text: JSON.stringify(answer) }],
    }).reply;
    assert.equal(reply.status, 200);
    const state = await screen.state((s) => s.plans.length > 0);
    assert.equal(state.plans[0]?.provider, 'claude');
    assert.deepEqual(state.plans[0]?.limits, [{ used: 28, windowMinutes: 300, resetsAt: Date.parse('2026-10-18T05:10:00.295Z') }]);
    assert.equal(state.sessions[0]?.status, 'working', 'the event counts as usual');
    assert.doesNotMatch(JSON.stringify(state), /secret|328671/);
    screen.close();
  });
});

describe('status hooks', () => {
  test('are answered at once with an empty body, and the display shows the session', async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    const reply = await hook(port, { hook_event_name: 'UserPromptSubmit', session_title: 'Login', prompt: 'secret' }).reply;
    assert.equal(reply.status, 200);
    assert.equal(reply.body, '');
    const state = await screen.state((s) => s.sessions.length === 1);
    assert.equal(state.sessions[0]?.project, 'shop-api');
    assert.equal(state.sessions[0]?.status, 'working');
    assert.equal(state.sessions[0]?.title, 'Login');
    assert.doesNotMatch(JSON.stringify(state), /secret/);
    screen.close();
  });

  test('with the simulated hang they are not answered (Claude Code gives up after its timeout)', async () => {
    const { port } = await startTestHub({ simulateHang: true });
    await assert.rejects(hook(port, { hook_event_name: 'Stop' }, { timeoutMs: 300 }).reply, /timeout/);
  });

  test("an MCP server's question (Elicitation) is answered at once and empty, so the app asks; the log names who asked, once", async () => {
    const lines: string[] = [];
    const { port, auditFile } = await startTestHub({ log: (line) => lines.push(line) });
    const screen = await display(port);
    await hook(port, { hook_event_name: 'UserPromptSubmit' }).reply;
    const elicitation = {
      hook_event_name: 'Elicitation',
      mcp_server_name: 'Claude_Browser',
      mode: 'form',
      message: 'Allow typing a secret word on example.com?',
      requested_schema: { type: 'object' },
    };
    const started = Date.now();
    const reply = await hook(port, elicitation).reply;
    assert.deepEqual([reply.status, reply.body], [200, ''], 'no decision: the app shows its own dialog');
    assert.ok(Date.now() - started < 1000, 'answered at once');
    await hook(port, elicitation).reply;
    await hook(port, { ...elicitation, mcp_server_name: 'evil\nRejected forged line' }).reply;
    const noted = lines.filter((line) => /asked the user/.test(line));
    assert.equal(noted.length, 2, 'once per server');
    assert.match(noted[0]!, /MCP server "Claude_Browser" asked the user \(elicitation, form\); the app shows its own dialog\./);
    assert.match(noted[1]!, /MCP server "evil\?Rejected forged line"/, 'no line breaks from hook data');
    assert.doesNotMatch(lines.join('\n'), /secret word/);
    // Nothing to decide on the display, and the session goes on working.
    const state = await screen.state((s) => s.sessions.length === 1);
    assert.deepEqual([state.permissions.length, state.sessions[0]?.status], [0, 'working']);
    assert.deepEqual(auditLines(auditFile), []);
    screen.close();
  });

  test('notification types the display does not use are named in the log once, the others not', async () => {
    const lines: string[] = [];
    const { port } = await startTestHub({ log: (line) => lines.push(line) });
    for (const type of ['elicitation_url_dialog', 'idle_prompt', 'elicitation_url_dialog', 'agent_completed', 'permission_prompt']) {
      assert.equal((await hook(port, { hook_event_name: 'Notification', notification_type: type, message: 'private text' }).reply).status, 200);
    }
    assert.deepEqual(
      lines.filter((line) => /Notification/.test(line)).map((line) => line.replace(/^\S+\s+/, '')),
      ['Notification "elicitation_url_dialog" (not shown on the display).', 'Notification "agent_completed" (not shown on the display).'],
    );
    assert.doesNotMatch(lines.join('\n'), /private text/);
  });
});

describe('the display at rest', () => {
  test('the display gets the time after which it rests; without one, never', async () => {
    const quiet = await startTestHub({ quietAfterMs: 600_000 });
    const screen = await display(quiet.port);
    assert.equal((await screen.state(() => true)).hub.quietAfterMs, 600_000);
    screen.close();
    const awake = await startTestHub();
    const other = await display(awake.port);
    assert.equal((await other.state(() => true)).hub.quietAfterMs, 0);
    other.close();
  });

  test('the display gets the time after which an open request reminds; without one, never', async () => {
    const reminding = await startTestHub({ remindAfterMs: 20_000 });
    const screen = await display(reminding.port);
    assert.equal((await screen.state(() => true)).hub.remindAfterMs, 20_000);
    screen.close();
    const silent = await startTestHub();
    const other = await display(silent.port);
    assert.equal((await other.state(() => true)).hub.remindAfterMs, 0);
    other.close();
  });
});

describe('sessions over a restart', () => {
  test('they are there again after a restart, as unknown until their next event; no request comes back', async () => {
    const sessionsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-hub-')), 'stellwerk', 'sessions.json');
    const first = await startTestHub({ sessionsFile });
    await hook(first.port, { hook_event_name: 'UserPromptSubmit', session_title: 'Login', prompt: 'secret prompt' }).reply;
    const held = permissionRequest(first.port, 'git push origin main');
    const screen = await display(first.port);
    await screen.state((s) => s.permissions.length === 1);
    screen.close();
    await first.hub.close();
    // Stopping, the hub gave the held request back to the app's own card.
    assert.equal((await held.reply).status, 200);
    assert.doesNotMatch(fs.readFileSync(sessionsFile, 'utf8'), /secret prompt|git push/);

    const lines: string[] = [];
    const second = await startTestHub({ sessionsFile, log: (line) => lines.push(line) });
    const again = await display(second.port);
    const state = await again.state((s) => s.sessions.length === 1);
    assert.deepEqual([state.sessions[0]?.status, state.sessions[0]?.title, state.sessions[0]?.project], ['unknown', 'Login', 'shop-api']);
    assert.deepEqual(state.permissions, [], 'no request comes back');
    assert.ok(lines.some((line) => /^Sessions of the last run: 1,/.test(line)));
    await hook(second.port, { hook_event_name: 'Stop' }).reply;
    assert.equal((await again.state((s) => s.sessions[0]?.status !== 'unknown')).sessions[0]?.status, 'done', 'its next event says what it does');
    again.close();
  });
});

describe('permission requests', () => {
  test('"Allow" on the display answers Claude Code with allow; a second decision is refused', async () => {
    const { port, auditFile } = await startTestHub();
    const screen = await display(port);
    const pending = permissionRequest(port);
    const id = await openRequestId(screen);
    const before = await screen.state((s) => s.sessions[0]?.status === 'permission');
    assert.deepEqual(before.permissions[0]?.input, { command: 'git push origin main' });

    screen.decide(id, 'allow');
    const reply = await pending.reply;
    assert.equal(reply.status, 200);
    assert.equal(reply.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(reply.body), {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    assert.deepEqual(await screen.result(id), { type: 'decision-result', id, ok: true });
    await screen.state((s) => s.permissions[0]?.outcome === 'allowed' && s.sessions[0]?.status === 'working');

    const second = await display(port);
    second.decide(id, 'deny');
    assert.deepEqual(await second.result(id), { type: 'decision-result', id, ok: false, reason: 'already-decided' });
    await eventually(() => auditLines(auditFile).length === 1);
    assert.equal(auditLines(auditFile)[0]?.result, 'allowed');
    screen.close();
    second.close();
  });

  test('the display gets the last decisions with what they were about, also those of before a restart', async () => {
    const { hub, port, auditFile } = await startTestHub();
    const screen = await display(port);
    const open = async (command: string) => {
      const state = await screen.state((s) => s.permissions.some((p) => p.outcome === null && p.input.command === command));
      return state.permissions.find((p) => p.outcome === null && p.input.command === command)!.id;
    };
    const first = permissionRequest(port, 'npm run deploy\necho done');
    screen.decide(await open('npm run deploy\necho done'), 'deny');
    await first.reply;
    const second = permissionRequest(port, 'git push origin main');
    screen.decide(await open('git push origin main'), 'allow');
    await second.reply;
    const state = await screen.state((s) => s.decisions.length === 2);
    assert.deepEqual(
      state.decisions.map((d) => [d.outcome, d.tool, d.what, d.provider]),
      [
        ['allowed', 'Bash', 'git push origin main', 'claude'],
        ['denied', 'Bash', 'npm run deploy', 'claude'],
      ],
      'newest first, the first line of each command',
    );
    assert.equal('input' in state.decisions[0]!, false, 'never the whole input');
    await eventually(() => auditLines(auditFile).length === 2);
    assert.equal(auditLines(auditFile)[0]?.provider, 'claude');
    screen.close();
    await hub.close();

    const again = await startTestHub({ auditFile });
    const later = await display(again.port);
    const restored = await later.state(() => true);
    assert.deepEqual(
      restored.decisions.map((d) => [d.outcome, d.what]),
      [
        ['allowed', 'git push origin main'],
        ['denied', 'npm run deploy'],
      ],
    );
    later.close();
  });

  test('"Deny" answers with deny and a message for Claude', async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    const pending = permissionRequest(port, 'rm -rf node_modules');
    screen.decide(await openRequestId(screen), 'deny');
    assert.deepEqual(JSON.parse((await pending.reply).body), {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: DENY_MESSAGE } },
    });
    screen.close();
  });

  test('"In the app" releases the request without a decision', async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    const pending = permissionRequest(port);
    screen.decide(await openRequestId(screen), 'app');
    const reply = await pending.reply;
    assert.equal(reply.status, 200);
    assert.equal(reply.body, '');
    await screen.state((s) => s.permissions[0]?.outcome === 'handed-to-app' && s.sessions[0]?.status === 'waiting');
    screen.close();
  });

  test('after the hold time the request goes back to the app with an empty answer', async () => {
    const { port, auditFile } = await startTestHub({ holdMs: 300 });
    const screen = await display(port);
    const started = Date.now();
    const reply = await permissionRequest(port).reply;
    assert.ok(Date.now() - started >= 250, 'held for the hold time');
    assert.equal(reply.body, '');
    await screen.state((s) => s.permissions[0]?.outcome === 'timed-out');
    await eventually(() => auditLines(auditFile)[0]?.result === 'timed-out');
    screen.close();
  });

  test('when Claude Code closes the request (answered in the app, or Esc) the card goes as decided in the app', async () => {
    const { port, auditFile } = await startTestHub();
    const screen = await display(port);
    const pending = permissionRequest(port);
    pending.reply.catch(() => {});
    await openRequestId(screen);
    pending.abort();
    await screen.state((s) => s.permissions[0]?.outcome === 'decided-in-app' && s.sessions[0]?.status === 'done');
    await eventually(() => auditLines(auditFile)[0]?.result === 'decided-in-app');
    screen.close();
  });

  test('a SessionEnd while a request is open cancels it', async () => {
    const { port, auditFile } = await startTestHub();
    const screen = await display(port);
    const pending = permissionRequest(port);
    await openRequestId(screen);
    await hook(port, { hook_event_name: 'SessionEnd', reason: 'other' }).reply;
    assert.equal((await pending.reply).body, '');
    await screen.state((s) => s.permissions[0]?.outcome === 'aborted' && s.sessions[0]?.status === 'ended');
    await eventually(() => auditLines(auditFile)[0]?.result === 'aborted');
    screen.close();
  });

  test("deciding a subagent's request on the display keeps the main agent's question", async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    await hook(port, { hook_event_name: 'UserPromptSubmit' }).reply;
    await hook(port, {
      hook_event_name: 'PermissionRequest',
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Which branch?', options: [{ label: 'main' }] }] },
    }).reply;
    const asked = await screen.state((s) => s.sessions[0]?.waitingFor === 'question');
    const since = asked.sessions[0]?.waitingSince;
    const pending = hook(port, { hook_event_name: 'PermissionRequest', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    const id = await openRequestId(screen);
    screen.decide(id, 'allow');
    assert.equal(JSON.parse((await pending.reply).body).hookSpecificOutput.decision.behavior, 'allow');
    const after = await screen.state((s) => s.permissions.some((p) => p.id === id && p.outcome === 'allowed'));
    assert.deepEqual([after.sessions[0]?.status, after.sessions[0]?.waitingFor, after.sessions[0]?.question, after.sessions[0]?.waitingSince], [
      'waiting',
      'question',
      'Which branch?',
      since,
    ]);
    screen.close();
  });

  test("two requests of a subagent at the app's card, one handed over, one timed out: each ends with its own tool", async () => {
    const { port } = await startTestHub({ holdMs: 600 });
    const screen = await display(port);
    await hook(port, { hook_event_name: 'UserPromptSubmit' }).reply;
    const bash = (command: string) => ({ agent_id: 'a1', tool_name: 'Bash', tool_input: { command } });
    const first = hook(port, { hook_event_name: 'PermissionRequest', ...bash('echo one') });
    const id = await openRequestId(screen);
    screen.decide(id, 'app');
    assert.equal((await first.reply).body, '', 'handed to the app');
    const second = hook(port, { hook_event_name: 'PermissionRequest', ...bash('echo two') });
    assert.equal((await second.reply).body, '', 'the real hold timer ran out');
    const waiting = await screen.state((s) => s.permissions.length === 2 && s.permissions.every((p) => p.outcome !== null));
    const since = waiting.sessions[0]?.waitingSince;
    assert.deepEqual([waiting.sessions[0]?.status, waiting.sessions[0]?.waitingFor], ['waiting', 'permission']);
    await hook(port, { hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'Read', tool_input: { file_path: 'a.ts' } }).reply;
    await hook(port, { hook_event_name: 'PostToolUse', ...bash('echo one') }).reply;
    // The second request's own time shows now: it started waiting later than the first.
    const after = await screen.state((s) => s.sessions[0]?.waitingFor === 'permission' && (s.sessions[0]?.waitingSince ?? 0) > since!);
    assert.equal(after.sessions[0]?.status, 'waiting', 'the second is still open in the app');
    await hook(port, { hook_event_name: 'PostToolUse', ...bash('echo two') }).reply;
    const done = await screen.state((s) => s.sessions[0]?.status === 'working');
    assert.equal(done.sessions[0]?.waitingFor, null);
    screen.close();
  });

  for (const { outcome, name, withInput } of [
    { outcome: 'handed-to-app', name: 'PostToolUse', withInput: true },
    { outcome: 'timed-out', name: 'PostToolUseFailure', withInput: false },
  ] as const) {
    test(`a subagent's request ${outcome}, one of the same tool held: one ${name} ${withInput ? 'with the same input' : 'without input'} leaves the held one to the display`, async () => {
      const { port, auditFile } = await startTestHub({ holdMs: 1500 });
      const screen = await display(port);
      await hook(port, { hook_event_name: 'UserPromptSubmit' }).reply;
      const bash = (command: string) => ({ agent_id: 'a1', tool_name: 'Bash', tool_input: { command } });
      const first = hook(port, { hook_event_name: 'PermissionRequest', ...bash('echo same') });
      const firstId = await openRequestId(screen);
      if (outcome === 'handed-to-app') screen.decide(firstId, 'app');
      assert.equal((await first.reply).body, '', outcome);
      const second = hook(port, { hook_event_name: 'PermissionRequest', ...bash(withInput ? 'echo same' : 'echo other') });
      const held = await screen.state((s) => s.permissions.some((p) => p.outcome === null && p.id !== firstId));
      const id = held.permissions.find((p) => p.outcome === null)!.id;
      const event = withInput ? bash('echo same') : { agent_id: 'a1', tool_name: 'Bash' };
      assert.equal((await hook(port, { hook_event_name: name, ...event }).reply).status, 200);
      // The held request is still the display's to decide: the decision reaches the agent.
      screen.decide(id, 'deny');
      const reply = await second.reply;
      assert.equal(reply.status, 200);
      assert.equal(JSON.parse(reply.body).hookSpecificOutput.decision.behavior, 'deny');
      await eventually(() => auditLines(auditFile).length === 2);
      assert.deepEqual(
        auditLines(auditFile).map((line) => line.result),
        [outcome, 'denied'],
        'nothing was decided in the app',
      );
      // Its tool ran (with the input) or the match was unsure (without): the one at the app's card is over,
      // or still waits there.
      const state = await screen.state((s) => s.permissions.some((p) => p.id === id && p.outcome === 'denied'));
      assert.deepEqual([state.sessions[0]?.status, state.sessions[0]?.waitingFor], withInput ? ['working', null] : ['waiting', 'permission']);
      screen.close();
    });
  }

  test('a question to the user (AskUserQuestion) goes straight back to the app: no card, no audit entry', async () => {
    const { port, auditFile } = await startTestHub();
    const screen = await display(port);
    const started = Date.now();
    const reply = await hook(port, {
      hook_event_name: 'PermissionRequest',
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }] },
    }).reply;
    assert.equal(reply.status, 200);
    assert.equal(reply.body, '');
    assert.ok(Date.now() - started < 1000, 'answered at once');
    const state = await screen.state((s) => s.sessions[0]?.status === 'waiting');
    assert.equal(state.permissions.length, 0);
    assert.equal(state.sessions[0]?.question, 'Which one?');
    await hook(port, { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: {} }).reply;
    await screen.state((s) => s.sessions[0]?.status === 'working');
    assert.deepEqual(auditLines(auditFile), []);
    screen.close();
  });

  test("a turn that ends with a question in the app's box waits for the answer, as the app sends it", async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    // As probed on 2026-10-16: PostToolUse of the box (mcp_server as an object), a Stop a few seconds later.
    const box = await hook(port, {
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__ccd_turn__wrap_up',
      mcp_server: { name: 'ccd_turn', source: 'sdk' },
      tool_use_id: 'toolu_1',
      tool_input: {
        recap: 'The first host is done.',
        ask: 'Set up the other two hosts the same way?',
        blocked: true,
        actions: [{ label: 'Yes, both', message: 'Yes, both' }, { label: 'Not now', message: 'Not now' }],
      },
      tool_response: [{ type: 'text', text: 'Shown in the next-step box.' }],
    }).reply;
    assert.equal(box.status, 200);
    await hook(port, { hook_event_name: 'Stop', stop_hook_active: false }).reply;
    const state = await screen.state((s) => s.sessions[0]?.status === 'waiting');
    assert.equal(state.sessions[0]?.waitingFor, 'question');
    assert.equal(state.sessions[0]?.question, 'Set up the other two hosts the same way?');
    assert.doesNotMatch(JSON.stringify(state), /first host is done/, 'the recap stays out of the state');
    await hook(port, { hook_event_name: 'UserPromptSubmit' }).reply;
    await screen.state((s) => s.sessions[0]?.status === 'working' && s.sessions[0]?.question === null);
    screen.close();
  });

  test('a Stop of the session releases its open request as decided in the app', async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    const pending = permissionRequest(port);
    await openRequestId(screen);
    await hook(port, { hook_event_name: 'Stop' }).reply;
    assert.equal((await pending.reply).body, '');
    await screen.state((s) => s.permissions[0]?.outcome === 'decided-in-app' && s.sessions[0]?.status === 'done');
    screen.close();
  });

  test('two sessions: every decision reaches the right one', async () => {
    const { port } = await startTestHub();
    const screen = await display(port);
    const first = hook(port, { session_id: 'one', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'one' } });
    const second = hook(port, { session_id: 'two', hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: 'b' } });
    const state = await screen.state((s) => s.permissions.filter((p) => p.outcome === null).length === 2);
    const idOf = (session: string) => state.permissions.find((p) => p.sessionId === session)!.id;
    screen.decide(idOf('two'), 'deny');
    screen.decide(idOf('one'), 'allow');
    assert.equal(JSON.parse((await first.reply).body).hookSpecificOutput.decision.behavior, 'allow');
    assert.equal(JSON.parse((await second.reply).body).hookSpecificOutput.decision.behavior, 'deny');
    screen.close();
  });

  test(`more than ${MAX_OPEN_PERMISSIONS} open requests: the next one goes to the app at once`, async () => {
    const { port, hub } = await startTestHub();
    const open = Array.from({ length: MAX_OPEN_PERMISSIONS }, (_, i) => permissionRequest(port, `cmd ${i}`));
    for (const r of open) r.reply.catch(() => {});
    await eventually(() => hub.board.pendingCount() === MAX_OPEN_PERMISSIONS);
    const started = Date.now();
    const reply = await permissionRequest(port, 'one too many').reply;
    assert.equal(reply.body, '');
    assert.ok(Date.now() - started < 1000);
    assert.equal(hub.board.pendingCount(), MAX_OPEN_PERMISSIONS);
  });

  test('the audit log has every settled request with its input, and never the token', async () => {
    const { port, auditFile } = await startTestHub({ holdMs: 200 });
    const screen = await display(port);
    const allowed = permissionRequest(port, 'npm test');
    screen.decide(await openRequestId(screen), 'allow');
    await allowed.reply;
    await permissionRequest(port, 'npm run build').reply; // times out
    await eventually(() => auditLines(auditFile).length === 2);
    const lines = auditLines(auditFile);
    assert.deepEqual(lines.map((l) => [l.result, (l.input as { command: string }).command]), [
      ['allowed', 'npm test'],
      ['timed-out', 'npm run build'],
    ]);
    assert.equal(lines[0]?.project, 'shop-api');
    assert.equal(lines[0]?.tool, 'Bash');
    assert.doesNotMatch(fs.readFileSync(auditFile, 'utf8'), new RegExp(TOKEN));
    screen.close();
  });

  test('stopping the hub hands every held request back to the app', async () => {
    const { port, hub } = await startTestHub();
    const pending = permissionRequest(port);
    await eventually(() => hub.board.pendingCount() === 1);
    await hub.close();
    assert.equal((await pending.reply).body, '');
  });
});
