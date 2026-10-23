// A real Edge, a fresh profile, an isolated hub with a made-up token: the display signs in with its start
// file, then the same tab visits a second service on another local port. That service must get nothing a
// client could decide requests with; a client with only what it got is turned away; back at the hub, the
// display connects again and decides a request. Needs the display built (npm run build) and Edge.
//
// Usage: node tools/check-browser.ts
//
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { HOOK_PATH } from '../src/config.ts';
import { displayKey, displayStartPage, startHub } from '../src/hub/hub.ts';
import { check, openEdge, pause, until, type Edge } from './edge.ts';

const ROOT = path.join(import.meta.dirname, '..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-browser-'));
const token = randomBytes(32).toString('hex');
const hub = await startHub({
  // The checks open nothing on this machine.
  open: () => {},
  port: 0,
  token,
  holdMs: 30_000,
  scale: 1,
  version: 'check',
  sound: false,
  auditFile: path.join(dir, 'audit.jsonl'),
  uiRoot: path.join(ROOT, 'ui'),
  webRoot: path.join(ROOT, 'dist', 'ui'),
  log: () => {},
});
if (hub.missingBuild) throw new Error('The display is not built. Run "npm run build" first.');
const startFile = path.join(dir, 'display.html');
fs.writeFileSync(startFile, displayStartPage(hub.port, displayKey(token)));

// The second local service: it records everything the browser sends it.
const received: http.IncomingHttpHeaders[] = [];
const other = http.createServer((req, res) => {
  received.push(req.headers);
  res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>other</title><p>other service</p>');
});
await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
const otherPort = (other.address() as AddressInfo).port;

let edge: Edge | null = null;
try {
  edge = await openEdge(path.join(dir, 'profile'));
  const { send, evaluate } = edge;
  const hubState = () => evaluate("document.querySelector('#hub-state')?.textContent ?? ''") as Promise<string>;
  const connected = (text: string) => /Hub connected|Hub verbunden/.test(text);

  // 1. The regular sign-in with the start file.
  await send('Page.navigate', { url: pathToFileURL(startFile).href });
  await until('the display signs in and connects', async () => connected(await hubState()));
  check(true, 'signed in with the start file, connected');
  check((await evaluate('location.pathname')) === '/', 'the display lives at /, so a reload does not post again');

  // 2. The same tab visits another service on another local port.
  await send('Page.navigate', { url: `http://127.0.0.1:${otherPort}/` });
  await until('the other service is visited', async () => received.length > 0 && (await evaluate('document.title')) === 'other');
  const sent = JSON.stringify(received);
  check(received.every((headers) => headers.cookie === undefined), 'the other service gets no cookie');
  check(!/[0-9a-f]{64}/.test(sent), 'the other service gets no key and no page token');
  check((await evaluate("sessionStorage.getItem('stellwerk-session')")) === null, "the other origin cannot read the display's storage");

  // 3. A client with only what the other service got is turned away.
  const refused = await new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`, ['stellwerk.v1'], {
      origin: `http://127.0.0.1:${hub.port}`,
      headers: received[0]?.cookie ? { Cookie: received[0].cookie } : {},
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('open', () => resolve(101));
    ws.on('error', () => {});
  });
  check(refused === 403, 'a client with only that is turned away (403)');
  const anonymous = await (await fetch(`http://127.0.0.1:${hub.port}/`)).text();
  check(!/stellwerk-session" content="[0-9a-f]{64}"/.test(anonymous), 'the address alone gives no page token');

  // 4. Back at the hub's address: the display takes its token from its own storage and connects.
  await send('Page.navigate', { url: `http://127.0.0.1:${hub.port}/` });
  await until('the display connects again without the start file', async () => connected(await hubState()));
  check(true, 'back at the hub, the display connects again');

  // 5. The display decides a request.
  const answer = new Promise<string>((resolve, reject) => {
    const body = JSON.stringify({
      hook_event_name: 'PermissionRequest',
      session_id: 'browser-check',
      cwd: 'C:\\Projects\\check',
      tool_name: 'Bash',
      tool_input: { command: 'echo check' },
    });
    const req = http.request({
      host: '127.0.0.1',
      port: hub.port,
      method: 'POST',
      path: HOOK_PATH,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    });
    req.on('response', (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve(text));
    });
    req.on('error', reject);
    req.end(body);
  });
  await until('the card shows', async () =>
    evaluate("[...document.querySelectorAll('button')].some((b) => /^(Allow|Erlauben)$/.test(b.textContent.trim()))"),
  );
  await evaluate("[...document.querySelectorAll('button')].find((b) => /^(Allow|Erlauben)$/.test(b.textContent.trim())).click()");
  const decision = JSON.parse(await answer) as { hookSpecificOutput?: { decision?: { behavior?: string } } };
  check(decision.hookSpecificOutput?.decision?.behavior === 'allow', 'the signed-in display allows a request');
} finally {
  await edge?.close();
  other.close();
  await hub.close();
  await pause(500);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log('Browser check passed.');
