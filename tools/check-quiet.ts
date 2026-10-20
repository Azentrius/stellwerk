// The display at rest in a real Edge: after the time with nothing new it dims, the clock still readable,
// and stays so while nothing changes; a tap wakes it without pressing what lies below; an open request
// wakes it and keeps it awake; a new answer due in the app, a monitor going down, a new pull request and
// failed checks wake it, and so does the hub going away. An isolated hub with a made-up token and a rest
// time of 1.5 s; GitHub's and Uptime Kuma's answers are made up here, nothing goes online. Needs the display
// built (npm run build) and Edge.
//
// Usage: node tools/check-quiet.ts [folder for screenshots]
//
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { displayKey, displayStartPage, startHub } from '../src/hub/hub.ts';
import { check, openEdge, pause, until, type Edge } from './edge.ts';
import { answerOf, behaviorOf, hook } from './hooks.ts';
import { openDisplay, screenshot, tap, type Box } from './lists.ts';

const ROOT = path.join(import.meta.dirname, '..');
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
const QUIET_MS = 1500;

// ---------- GitHub and Uptime Kuma, made up and changed by the check ----------
const pulls: Array<{ number: number; failing: boolean }> = [{ number: 1, failing: false }];
const down: string[] = [];
const sha = (n: number) => String(n).padStart(40, '0');
const gitHubFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  let body: unknown = null;
  if (url.pathname === '/orgs/example/repos') body = [{ name: 'shop-api' }];
  else if (url.pathname === '/repos/example/shop-api/pulls') {
    body = pulls.map((p) => ({ number: p.number, title: `Pull request ${p.number}`, updated_at: new Date().toISOString(), user: { login: 'dev' }, head: { sha: sha(p.number) } }));
  } else if (url.pathname.endsWith('/actions/runs')) {
    const pull = pulls.find((p) => sha(p.number) === url.searchParams.get('head_sha'));
    body = { workflow_runs: [{ status: 'completed', conclusion: pull?.failing ? 'failure' : 'success' }] };
  }
  return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
}) as typeof fetch;
const kumaFetch = (async () => {
  const monitors: Array<[string, number]> = [['Up 1', 1], ['Up 2', 1], ...down.map((name): [string, number] => [name, 0])];
  const lines = monitors.map(([name, value], i) => `monitor_status{monitor_id="${i + 1}",monitor_name="${name}",monitor_type="http"} ${value}`);
  return new Response(`# TYPE monitor_status gauge\n${lines.join('\n')}\n`, { status: 200 });
}) as typeof fetch;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-quiet-'));
const token = randomBytes(32).toString('hex');
const hub = await startHub({
  port: 0,
  token,
  holdMs: 60_000,
  scale: 1,
  version: 'check',
  sound: false,
  quietAfterMs: QUIET_MS,
  auditFile: path.join(dir, 'audit.jsonl'),
  uiRoot: path.join(ROOT, 'ui'),
  webRoot: path.join(ROOT, 'dist', 'ui'),
  log: () => {},
  github: { owner: 'example', token: `github_pat_${'check'.repeat(8)}`, intervalMs: 300, fetch: gitHubFetch },
  uptimeKuma: { url: 'http://192.0.2.10:3001', key: `uk1_${'check'.repeat(8)}`, intervalMs: 300, fetch: kumaFetch },
});
if (hub.missingBuild) throw new Error('The display is not built. Run "npm run build" first.');
const startFile = path.join(dir, 'display.html');
fs.writeFileSync(startFile, displayStartPage(hub.port, displayKey(token)));
let hubClosed = false;

let edge: Edge | null = null;
try {
  edge = await openEdge(path.join(dir, 'profile'));
  const browser = edge;
  const resting = () => browser.evaluate<boolean>("document.body.classList.contains('quiet')");
  const untilResting = async (why: string) => {
    await until(`the display rests ${why}`, resting, 4 * QUIET_MS + 3000);
    check(true, `the display rests ${why}`);
  };
  const untilAwake = async (why: string) => {
    await until(`${why} wakes the display`, async () => !(await resting()), 5000);
    check(true, `${why} wakes the display`);
  };
  const rect = (selector: string) =>
    browser.call<Box | null>(
      '(selector) => { const n = document.querySelector(selector); if (!n) return null; const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }',
      selector,
    );
  const center = (b: Box) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

  await openDisplay(browser, startFile);
  await until('the display shows the pull request', async () => (await rect('.pull')) !== null);
  check(!(await resting()), 'at first the display is awake');

  // Nothing new: it rests, dimmed, the status column with the clock a little less.
  await untilResting('after the time with nothing new');
  await pause(2500);
  const dim = await browser.evaluate<{ agents: string; waiting: string; status: string; clock: boolean }>(`(() => {
    const filter = (selector) => getComputedStyle(document.querySelector(selector)).filter;
    const clock = document.querySelector('#clock').getBoundingClientRect();
    return { agents: filter('.col--agents'), waiting: filter('.col--waiting'), status: filter('.col--status'), clock: clock.height > 0 && clock.bottom <= innerHeight };
  })()`);
  await screenshot(browser, shots, 'quiet');
  check(dim.agents === 'brightness(0.25)' && dim.waiting === 'brightness(0.25)', `at rest the columns are dimmed to a quarter (${dim.agents})`);
  check(dim.status === 'brightness(0.4)' && dim.clock, `the clock's column a little less, the clock in view (${dim.status})`);
  check(await resting(), 'while nothing changes it stays at rest (GitHub and Uptime Kuma asked again in between)');

  // A tap wakes it and presses nothing; the next tap is an ordinary one.
  await browser.evaluate("window.__clicks = 0; document.addEventListener('click', () => window.__clicks++)");
  const pull = center((await rect('.pull'))!);
  await tap(browser, pull.x, pull.y);
  await untilAwake('a tap');
  await pause(300);
  check((await browser.evaluate<number>('window.__clicks')) === 0, 'the waking tap goes nowhere');
  await tap(browser, pull.x, pull.y);
  await pause(300);
  check((await browser.evaluate<number>('window.__clicks')) === 1, 'the next tap is an ordinary click');
  await untilResting('after the tap');

  // A request wakes it and keeps it awake while open; decided, it rests again.
  const reply = hook(hub.port, token, 'card-1', {
    hook_event_name: 'PermissionRequest',
    session_title: 'Deploy',
    tool_name: 'Bash',
    tool_input: { command: 'npm run deploy' },
  });
  await untilAwake('a new request');
  await pause(3 * QUIET_MS);
  check(!(await resting()), 'an open request keeps it awake');
  await screenshot(browser, shots, 'awake-request');
  const allow = await rect('.card [data-decision="allow"]');
  await tap(browser, center(allow!).x, center(allow!).y);
  check(behaviorOf(await answerOf(reply, 'the tap on Allow')) === 'allow', 'awake, a tap on Allow allows');
  await untilResting('once the request is decided');

  // What else wakes it.
  await hook(hub.port, token, 'asking-1', { hook_event_name: 'UserPromptSubmit', session_title: 'Asking', prompt: 'x' });
  await hook(hub.port, token, 'asking-1', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'x' });
  await untilAwake('a new answer due in the app');
  await untilResting('while that answer is still due');
  down.push('Server');
  await untilAwake('a monitor going down');
  await untilResting('while it stays down');
  pulls.push({ number: 2, failing: false });
  await untilAwake('a new pull request');
  await untilResting('with the pull request still open');
  pulls[0]!.failing = true;
  await untilAwake('failed checks');
  await untilResting('with the checks still failed');

  // The hub going away wakes it: the status column says so.
  await hub.close();
  hubClosed = true;
  await untilAwake('the hub going away');
} finally {
  await edge?.close();
  if (!hubClosed) await hub.close();
  await pause(500);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log('Rest check passed.');
