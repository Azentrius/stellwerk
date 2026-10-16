// The hub end to end: hook requests over HTTP as Claude Code sends them, a display over the WebSocket,
// holding, the hold time, cancelling, and the security checks.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { WebSocket } from 'ws';
import type { ServerMessage, StateMessage } from '../src/shared/protocol.js';
import { HOOK_PATH } from '../src/config.ts';
import { appSettingsXml } from '../src/hub/hardware.ts';
import {
  DENY_MESSAGE,
  MAX_OPEN_PERMISSIONS,
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

function hook(port: number, body: Record<string, unknown>, extra: { timeoutMs?: number } = {}) {
  return call(port, { headers: AUTH, body: { session_id: 'session-1', cwd: 'C:\\Projekte\\shop-api', ...body }, ...extra });
}

function permissionRequest(port: number, command = 'git push origin main', extra: { timeoutMs?: number } = {}) {
  return hook(port, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command } }, extra);
}

async function pageToken(port: number): Promise<string> {
  const { body } = await call(port, { method: 'GET', path: '/' }).reply;
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
    const page = await call(port, { method: 'GET', path: '/' }).reply;
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
    const { body } = await call(port, { method: 'GET', path: '/' }).reply;
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
      const { body } = await call(port, { method: 'GET', path: '/' }).reply;
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

describe('rejections on the console', () => {
  const STOP = { hook_event_name: 'Stop', session_id: 'x' };
  const WRONG = 'b'.repeat(64);

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
    await hook(port, { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: {} }).reply;
    await screen.state((s) => s.sessions[0]?.status === 'working');
    assert.deepEqual(auditLines(auditFile), []);
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
