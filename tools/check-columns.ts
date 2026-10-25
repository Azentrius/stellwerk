// The agents and the waiting column in a real Edge at the display's 1920×720: with more than fit, each
// scrolls by mouse wheel, finger and keyboard to its last entry, which can then be read in full, and keeps
// its place while the display updates; the column titles and GitHub's line stay in place; the Allow of a
// card far down can be reached and pressed by finger and by keyboard; the line of the sessions at rest keeps
// the focus while the column is drawn anew, and Enter, Space and a press held over a render open and close
// it once each; below two alerts in the status
// column, the hardware values and the plans' usage scroll the same way, the clock and the alerts staying in
// place; with only a few nothing scrolls and nothing moves; the decisions of the last day wait folded at the
// foot of the waiting column, a click or Enter opens and closes them, open they lie over the requests without
// moving them, and a new request folds them; a press held over a render on the button in a session's
// details, on a session waiting for an answer and on a pull request has the hub open it, once (the hubs
// here only write down what they would open). Isolated hubs with made-up tokens;
// sessions, requests and the plans' usage come as hook events, earlier decisions from the audit log, the
// answers of GitHub and LibreHardwareMonitor are made up here, nothing goes online. Needs the display built
// (npm run build) and Edge.
//
// Usage: node tools/check-columns.ts [folder for screenshots]
//
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { displayKey, displayStartPage, startHub, type Hub } from '../src/hub/hub.ts';
import { check, openEdge, pause, until, type Edge } from './edge.ts';
import { answerOf, behaviorOf, hook } from './hooks.ts';
import { countRenders, measure, openDisplay, press, screenshot, scrollWith, settled, swipe, tap, wheel, type Box, type Geometry, type ListSpec } from './lists.ts';

const ROOT = path.join(import.meta.dirname, '..');
/** The links a tap on the display had the hubs open. */
const opened: string[] = [];
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
const pad = (n: number) => String(n).padStart(2, '0');

const AGENTS: ListSpec = {
  list: '#agents',
  entries: '.agent',
  parts: ['.entry__name', '.az-label'],
  name: '.entry__name',
  fixed: { title: 'agents-title' },
};
/** Below the hub's state in the status column: its hints, then hardware and the plans' usage. */
const STATUS: ListSpec = {
  list: '#status-details',
  entries: '.log-state:not([hidden]), .gauge',
  parts: ['.gauge__label', '.gauge__load'],
  fade: 'status-details--more',
  fixed: { clock: 'clock', hub: 'hub-state', lastEvent: 'last-event' },
};
const WAITING: ListSpec = {
  list: '#waiting-list',
  entries: '.card, .entry',
  fade: 'waiting--more',
  fixed: { title: 'waiting-title', github: 'github-state' },
};

// ---------- GitHub, made up ----------
function gitHub(pulls: number): typeof fetch {
  const repos = ['shop-api', 'customer-portal'];
  const answers: Record<string, unknown> = { '/orgs/example/repos': repos.map((name) => ({ name })) };
  for (const [r, repo] of repos.entries()) {
    answers[`/repos/example/${repo}/pulls`] = Array.from({ length: Math.ceil(pulls / 2) - r * (pulls % 2) }, (_, i) => ({
      number: 100 + r * 50 + i,
      title: `Pull request ${pad(r * 10 + i + 1)} of ${repo}`,
      updated_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
      user: { login: 'dev' },
      head: { sha: String(r * 10 + i).padStart(40, '0') },
    }));
  }
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const body = url.pathname.endsWith('/actions/runs') ? { workflow_runs: [{ status: 'completed', conclusion: 'success' }] } : answers[url.pathname];
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
  }) as typeof fetch;
}

// ---------- LibreHardwareMonitor, made up ----------
const sensor = (id: string, name: string, type: string, value: string) => ({ Text: name, SensorId: id, Type: type, RawValue: value, Children: [] });
const hardwareFetch = (async () =>
  new Response(
    JSON.stringify({
      Text: 'Sensor',
      Children: [
        {
          Text: 'CHECK-PC',
          Children: [
            sensor('/intelcpu/0/load/0', 'CPU Total', 'Load', '23.0 %'),
            sensor('/intelcpu/0/temperature/13', 'CPU Package', 'Temperature', '61.0 °C'),
            sensor('/gpu-nvidia/0/load/0', 'GPU Core', 'Load', '8.0 %'),
            sensor('/gpu-nvidia/0/temperature/0', 'GPU Core', 'Temperature', '48.0 °C'),
            sensor('/ram/load/0', 'Memory', 'Load', '45.2 %'),
            sensor('/ram/data/0', 'Memory Used', 'Data', '14.3 GB'),
            sensor('/ram/data/1', 'Memory Available', 'Data', '17.4 GB'),
          ],
        },
      ],
    }),
    { status: 200 },
  )) as typeof fetch;

/** The plans' usage as the desktop app's get_usage answers it, carried by a PostToolUse hook. */
function usage(port: number, token: string): Promise<string> {
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const windows = [
    { label: '5-hour limit', percentUsed: 28, resetsAt: inHours(1.4) },
    { label: 'Weekly · all models', percentUsed: 57, resetsAt: inHours(69) },
    { label: 'Weekly · Fable', percentUsed: 86, resetsAt: inHours(69) },
  ];
  return hook(port, token, 'usage-01', {
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__ccd_session_mgmt__get_usage',
    tool_input: {},
    tool_response: [{ type: 'text', text: JSON.stringify({ plan: { status: 'ok', windows } }) }],
  });
}

/** Ten sessions of the last run, idle for two hours: they come back as unknown, at rest. */
const RESTING = 10;
function restingSessions(dir: string): string {
  const file = path.join(dir, 'sessions.json');
  const lastActivity = Date.now() - 2 * 3_600_000;
  const saved = Array.from({ length: RESTING }, (_, i) => ({
    id: `rest-${pad(i + 1)}`,
    provider: 'claude',
    cwd: 'C:\\Projects\\rest',
    title: `Ruht ${pad(i + 1)}`,
    project: null,
    context: null,
    lastActivity,
  }));
  fs.writeFileSync(file, JSON.stringify(saved));
  return file;
}

/** Decisions of an earlier run in the audit log, one a minute, the newest last: step 01 to step NN. */
function earlierDecisions(file: string, count: number): void {
  const outcomes = ['allowed', 'denied', 'decided-in-app', 'timed-out'];
  // The first four are two days old, the rest a minute apart up to now.
  const lines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      ts: new Date(Date.now() - (count - i) * 60_000 - (i < 4 ? 2 * 24 * 3_600_000 : 0)).toISOString(),
      request: `earlier-${pad(i + 1)}`,
      project: 'shop-api',
      title: 'Deploy the shop',
      provider: 'claude',
      tool: 'Bash',
      input: { command: `npm run step-${pad(i + 1)}` },
      result: outcomes[i % outcomes.length],
    }),
  );
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

/**
 * A hub of its own with its start file, as `serve` writes it; with `alerts`, the raw log is on and a
 * request with a wrong token is turned away, so the status column shows two alerts above its gauges;
 * with `decisions`, that many decisions of an earlier run are in its audit log; with `remindAfterMs`, an open
 * request reminds after that long.
 */
async function testHub(dir: string, pulls: number, alerts = false, decisions = 0, remindAfterMs = 0): Promise<{ hub: Hub; token: string; startFile: string }> {
  fs.mkdirSync(dir, { recursive: true });
  if (decisions > 0) earlierDecisions(path.join(dir, 'audit.jsonl'), decisions);
  const token = randomBytes(32).toString('hex');
  const hub = await startHub({
    // What a tap would open, written down here; the check opens nothing on this machine.
    open: (link) => opened.push(link),
    port: 0,
    token,
    holdMs: 5 * 60_000,
    scale: 1,
    version: 'check',
    sound: false,
    auditFile: path.join(dir, 'audit.jsonl'),
    uiRoot: path.join(ROOT, 'ui'),
    webRoot: path.join(ROOT, 'dist', 'ui'),
    log: () => {},
    github: { owner: 'example', token: `github_pat_${'check'.repeat(8)}`, intervalMs: 3_600_000, fetch: gitHub(pulls) },
    hardware: { settingsFile: path.join(dir, 'LibreHardwareMonitor.config'), intervalMs: 500, fetch: hardwareFetch },
    rawLogFile: alerts ? path.join(dir, 'debug-raw.jsonl') : null,
    sessionsFile: alerts ? restingSessions(dir) : null,
    remindAfterMs,
  });
  if (hub.missingBuild) throw new Error('The display is not built. Run "npm run build" first.');
  const startFile = path.join(dir, 'display.html');
  fs.writeFileSync(startFile, displayStartPage(hub.port, displayKey(token)));
  await usage(hub.port, token);
  if (alerts) await hook(hub.port, 'not-the-token', 'stranger-01', { hook_event_name: 'Stop' });
  return { hub, token, startFile };
}

/** Sessions at work, sessions waiting for an answer in the app, and held requests; returns the requests' answers. */
async function fill(hub: Hub, token: string, counts: { working: number; answers: number; cards: number }): Promise<Array<Promise<string>>> {
  for (let i = 1; i <= counts.working; i++) {
    const title = i === 13 ? `Session ${pad(i)} with a title long enough to run past the width of its column` : `Session ${pad(i)}`;
    await hook(hub.port, token, `agent-${pad(i)}`, { hook_event_name: 'UserPromptSubmit', session_title: title, prompt: 'x' });
  }
  for (let i = 1; i <= counts.answers; i++) {
    await hook(hub.port, token, `asking-${pad(i)}`, { hook_event_name: 'UserPromptSubmit', session_title: `Asking ${pad(i)}`, prompt: 'x' });
    await hook(hub.port, token, `asking-${pad(i)}`, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'x' });
  }
  const replies: Array<Promise<string>> = [];
  for (let i = 1; i <= counts.cards; i++) {
    replies.push(
      hook(hub.port, token, `card-${pad(i)}`, {
        hook_event_name: 'PermissionRequest',
        session_title: `Request ${pad(i)}`,
        tool_name: 'Bash',
        tool_input: { command: `npm run deploy -- --target staging-${i} --verbose`, description: `Deploy number ${i}` },
      }),
    );
    await until(`request ${i} is held`, async () => hub.board.pendingCount() === i);
  }
  return replies;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-columns-'));
const many = await testHub(path.join(dir, 'many'), 8, true);
let few: Awaited<ReturnType<typeof testHub>> | null = null;
let edge: Edge | null = null;
try {
  const COUNTS = { working: 26, answers: 4, cards: 5 };
  const replies = await fill(many.hub, many.token, COUNTS);
  // The session that reported the plans' usage counts too.
  const sessions = COUNTS.working + COUNTS.answers + COUNTS.cards + 1;

  edge = await openEdge(path.join(dir, 'profile'));
  const browser = edge;
  const shown = (g: Geometry) => Object.values(g.fixed).every((f) => f.shown);
  const lastReadable = (g: Geometry) => g.entries.at(-1)?.readable === true && !g.more && g.mask === 'none';
  /** The rectangle of a card's button, and whether it is in the list's view, outside the fade and uncovered. */
  const button = (card: number, decision: string) =>
    browser.call<{ box: Box; inView: boolean; disabled: boolean } | null>(
      `(card, decision) => {
      const list = document.querySelector('#waiting-list');
      const buttons = document.querySelectorAll('.card')[card]?.querySelectorAll('[data-decision]') ?? [];
      const node = [...buttons].find((b) => b.dataset.decision === decision);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const v = list.getBoundingClientRect();
      const fade = getComputedStyle(list).maskImage !== 'none' ? 3 * parseFloat(getComputedStyle(document.documentElement).fontSize) : 0;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        inView: r.top >= v.top && r.bottom <= Math.min(innerHeight, v.top + list.clientHeight - fade) && hit !== null && node.contains(hit),
        disabled: node.disabled,
      };
    }`,
      card,
      decision,
    );

  await openDisplay(browser, many.startFile);
  await until('the display shows all sessions, requests, answers and pull requests', async () => {
    const [agents, waiting] = await Promise.all([measure(browser, AGENTS), measure(browser, WAITING)]);
    return agents.entries.length === sessions && waiting.entries.length === COUNTS.cards + COUNTS.answers + 8;
  });
  await screenshot(browser, shots, 'columns-top');

  // ---------- the agents column ----------
  let g = await settled(browser, AGENTS);
  check(g.max > 200, `${sessions} sessions are more than fit (${Math.round(g.max)} px more)`);
  check(shown(g), 'the title of the agents column is shown, outside the list');
  check(g.overflowX <= 0, 'nothing runs out of the agents column to the side');

  const agentsByWheel = await scrollWith(browser, AGENTS, wheel(browser, 120), 'end');
  g = agentsByWheel.g;
  check(g.scrollTop >= g.max - 1, `the mouse wheel scrolls the agents to the end (${Math.round(g.scrollTop)} of ${Math.round(g.max)} px)`);
  check(lastReadable(g), 'then the last session, its name and its state, can be read in full');
  check(agentsByWheel.read.size === sessions, `on the way every one of the ${sessions} could be read (${agentsByWheel.read.size})`);
  check(shown(g), 'the title is still shown');

  let renders = await countRenders(browser, AGENTS.list);
  await pause(2500);
  let after = await measure(browser, AGENTS);
  check((await renders()) > 0, 'the agents were drawn again in between');
  check(after.scrollTop === g.scrollTop && lastReadable(after), 'the agents keep their place over the renders');

  await browser.evaluate('document.activeElement?.blur()');
  let focused = false;
  for (let i = 0; i < 3 && !focused; i++) {
    await press(browser, 'Tab', 9);
    focused = await browser.evaluate<boolean>("document.activeElement?.id === 'agents'");
  }
  check(focused, 'Tab reaches the agents list');
  await press(browser, 'Home', 36);
  g = await settled(browser, AGENTS);
  check(g.scrollTop === 0, 'Home goes back to the first session');
  g = (await scrollWith(browser, AGENTS, () => press(browser, 'PageDown', 34), 'end')).g;
  check(g.scrollTop >= g.max - 1 && lastReadable(g), 'Page Down scrolls to the last session, which can be read');

  await browser.evaluate('document.activeElement?.blur()');
  g = (await scrollWith(browser, AGENTS, swipe(browser, -300), 'start')).g;
  check(g.scrollTop === 0, 'a finger moves the agents back to the first');
  g = (await scrollWith(browser, AGENTS, swipe(browser, 300), 'end')).g;
  check(g.scrollTop >= g.max - 1 && lastReadable(g), 'a finger moves them to the last, which can be read');

  // Sessions at rest: behind one line at the foot, which a tap opens and the next closes.
  const line = () =>
    browser.call<{ text: string; inView: boolean; box: Box } | null>(
      `() => {
      const node = document.querySelector('.resting__toggle');
      if (!node || node.closest('[hidden]')) return null;
      const r = node.getBoundingClientRect();
      const list = document.querySelector('#agents').getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { text: node.textContent, inView: r.top >= list.top && r.bottom <= list.bottom && hit !== null && node.contains(hit), box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } };
    }`,
    );
  let rest = await line();
  check(rest?.inView === true && /^10 (more at rest|weitere ruhen)$/.test(rest.text), `the ten sessions at rest wait behind one line at the foot ("${rest?.text}")`);
  check(g.entries.every((e) => !/Ruht \d/.test(e.text)), 'none of them stands on its own');
  await tap(browser, (rest!.box.left + rest!.box.right) / 2, (rest!.box.top + rest!.box.bottom) / 2);
  g = await until('a tap opens the line', async () => {
    const now = await measure(browser, AGENTS);
    return now.entries.length === sessions + RESTING ? now : null;
  });
  check(g.entries.slice(-RESTING).every((e) => /Ruht \d/.test(e.text)), 'a tap opens it: the ten show below it');
  rest = await line();
  check(/^(Hide the 10 at rest|10 ruhende ausblenden)$/.test(rest?.text ?? ''), `its word says how to close it ("${rest?.text}")`);
  g = (await scrollWith(browser, AGENTS, swipe(browser, 300), 'end')).g;
  check(lastReadable(g), 'a finger reaches the last one at rest');
  g = (await scrollWith(browser, AGENTS, swipe(browser, -300), 'start')).g;
  rest = await line();
  for (let i = 0; i < 20 && rest && !rest.inView; i++) {
    const view = g.view!;
    await swipe(browser, 200)({ x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 });
    g = await settled(browser, AGENTS);
    rest = await line();
  }
  await tap(browser, (rest!.box.left + rest!.box.right) / 2, (rest!.box.top + rest!.box.bottom) / 2);
  await until('the next tap closes it', async () => (await measure(browser, AGENTS)).entries.length === sessions);
  check(true, 'the next tap closes it');

  // The keyboard and the mouse, while the display draws the column anew every second: the line keeps the
  // focus and its place, and a key or a press held over a render opens or closes it, once.
  const resting = () =>
    browser.call<{ focused: boolean; expanded: string | null; text: string; shown: number; scrollTop: number; clicks: number }>(
      `() => {
      const node = document.querySelector('.resting__toggle');
      const names = [...document.querySelectorAll('#agents .agent .entry__name')].filter((n) => n.getClientRects().length > 0);
      return {
        focused: document.activeElement === node,
        expanded: node.getAttribute('aria-expanded'),
        text: node.textContent,
        shown: names.filter((n) => n.textContent.startsWith('Ruht ')).length,
        scrollTop: document.querySelector('#agents').scrollTop,
        clicks: window.__restingClicks,
      };
    }`,
    );
  const isOpen = (s: Awaited<ReturnType<typeof resting>>) => s.expanded === 'true' && s.shown === RESTING && /^(Hide the 10 at rest|10 ruhende ausblenden)$/.test(s.text);
  const isClosed = (s: Awaited<ReturnType<typeof resting>>) => s.expanded === 'false' && s.shown === 0 && /^10 (more at rest|weitere ruhen)$/.test(s.text);
  /** Waits until the line is open or closed, then a little longer, so a second activation would show. */
  const becomes = async (want: (s: Awaited<ReturnType<typeof resting>>) => boolean, what: string) => {
    await until(what, async () => want(await resting()));
    await pause(400);
    return resting();
  };
  /** Renders counted over `ms`, and how the line stands afterwards. */
  const overRenders = async (ms: number) => {
    const count = await countRenders(browser, AGENTS.list);
    await pause(ms);
    return { renders: await count(), s: await resting() };
  };
  const SPACE = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 };
  await browser.evaluate("window.__restingClicks = 0; document.querySelector('.resting__toggle').addEventListener('click', () => window.__restingClicks++)");

  // Every session is a tab stop of its own (a tap or a key opens its details), so the way is long.
  await browser.evaluate("document.activeElement?.blur(); document.querySelector('#agents').focus()");
  let s = await resting();
  for (let i = 0; i < 60 && !s.focused; i++) {
    await press(browser, 'Tab', 9);
    s = await resting();
  }
  check(s.focused && isClosed(s), 'Tab reaches the line of the sessions at rest, closed (aria-expanded false)');
  let held = await overRenders(3200);
  check(held.renders >= 3, `the column was drawn again ${held.renders} times`);
  check(held.s.focused && held.s.scrollTop === s.scrollTop && isClosed(held.s), 'over these renders the line keeps the focus, the column its place');

  await press(browser, 'Enter', 13, '\r');
  s = await becomes(isOpen, 'Enter opens the line');
  check(s.clicks === 1 && s.focused, 'after the renders Enter opens it, once: aria-expanded true, the ten show, its word says how to close it');
  held = await overRenders(2500);
  check(held.renders >= 2 && held.s.focused && isOpen(held.s), `open, it keeps the focus over ${held.renders} renders`);
  await press(browser, 'Enter', 13, '\r');
  s = await becomes(isClosed, 'Enter closes the line');
  check(s.clicks === 2 && s.focused, 'after the renders Enter closes it again, once');

  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', ...SPACE, text: ' ', unmodifiedText: ' ' });
  let during = await countRenders(browser, AGENTS.list);
  await until('a render while Space is held', async () => (await during()) >= 1);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...SPACE });
  s = await becomes(isOpen, 'Space opens the line');
  check(s.clicks === 3 && s.focused, 'Space held over a render opens it, once');
  held = await overRenders(2500);
  check(held.renders >= 2 && held.s.focused && isOpen(held.s), `it stays open and focused over ${held.renders} renders`);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', ...SPACE, text: ' ', unmodifiedText: ' ' });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...SPACE });
  s = await becomes(isClosed, 'Space closes the line');
  check(s.clicks === 4 && s.focused, 'after the renders Space closes it again, once');

  for (const [want, word] of [
    [isOpen, 'opens'],
    [isClosed, 'closes'],
  ] as const) {
    const at = (await line())!;
    check(at.inView, `the line is in view for the mouse (${word})`);
    const x = (at.box.left + at.box.right) / 2;
    const y = (at.box.top + at.box.bottom) / 2;
    const clicks = (await resting()).clicks;
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    during = await countRenders(browser, AGENTS.list);
    await until('a render while the mouse button is down', async () => (await during()) >= 1);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    s = await becomes(want, `the press ${word} the line`);
    check(s.clicks === clicks + 1, `a press held over a render ${word} it: one click (${s.clicks - clicks})`);
  }

  // A session at rest that reports again: the count follows, it stands on its own, the focus stays.
  await browser.evaluate("document.querySelector('.resting__toggle').focus()");
  await hook(many.hub.port, many.token, 'rest-05', { hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  s = await until('the session that reported leaves the line', async () => {
    const now = await resting();
    return /^9 (more at rest|weitere ruhen)$/.test(now.text) ? now : null;
  });
  const order = await browser.call<{ woken: number; line: number }>(
    `() => {
      const items = [...document.querySelector('#agents').children];
      return { woken: items.findIndex((n) => n.querySelector('.entry__name')?.textContent === 'Ruht 05'), line: items.indexOf(document.querySelector('.resting')) };
    }`,
  );
  check(s.focused && s.expanded === 'false' && order.woken >= 0 && order.woken < order.line, 'a session at rest that reports again leaves the line, which counts 9 and keeps the focus');

  // A session's details: a tap opens them below it and the next closes them; so do Enter and Space.
  // The topmost session, once the list is back at its start.
  let NAME = '';
  const session = () =>
    browser.call<{ box: Box; inView: boolean; expanded: string | null; terms: string[]; folder: string; focused: boolean } | null>(
      `(name) => {
      const item = [...document.querySelectorAll('#agents .agent')].find((n) => n.querySelector('.entry__name')?.textContent === name);
      if (!item) return null;
      const r = item.getBoundingClientRect();
      const list = document.querySelector('#agents').getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20));
      const details = item.querySelector('.agent__details');
      return {
        box: { top: r.top, bottom: r.top + Math.min(r.height, 40), left: r.left, right: r.right },
        inView: r.top >= list.top && r.top + 40 <= list.bottom && hit !== null && item.contains(hit),
        expanded: item.getAttribute('aria-expanded'),
        terms: details && details.getClientRects().length > 0 ? [...details.querySelectorAll('dt')].map((n) => n.textContent) : [],
        folder: details?.querySelector('dd')?.textContent ?? '',
        focused: document.activeElement === item,
      };
    }`,
      NAME,
    );
  g = (await scrollWith(browser, AGENTS, swipe(browser, -300), 'start')).g;
  NAME = await browser.evaluate<string>("document.querySelector('#agents .agent .entry__name').textContent");
  let one = await session();
  check(one?.inView === true && one.expanded === 'false' && one.terms.length === 0, `"${NAME}" is in view, its details closed`);
  await tap(browser, (one!.box.left + one!.box.right) / 2, (one!.box.top + one!.box.bottom) / 2);
  one = await until('a tap opens the details', async () => {
    const now = await session();
    return now?.expanded === 'true' && now.terms.length > 0 ? now : null;
  });
  check(
    one.terms.length === 6 && /^(Folder|Ordner)$/.test(one.terms[0]!) && one.folder.startsWith('C:\\Projects\\'),
    `a tap opens its details below it: ${one.terms.join(', ')}; folder ${one.folder}`,
  );
  await tap(browser, (one.box.left + one.box.right) / 2, (one.box.top + one.box.bottom) / 2);
  await until('the next tap closes them', async () => (await session())?.terms.length === 0);
  check(true, 'the next tap closes them');

  one = (await session())!;
  const sx = (one.box.left + one.box.right) / 2;
  const sy = (one.box.top + one.box.bottom) / 2;
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: sy });
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', buttons: 1, clickCount: 1 });
  const drawn = await countRenders(browser, AGENTS.list);
  await until('a render while the mouse button is down on the session', async () => (await drawn()) >= 1);
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', buttons: 0, clickCount: 1 });
  one = await until('the press opens the details', async () => {
    const now = await session();
    return now?.expanded === 'true' && now.terms.length > 0 ? now : null;
  });
  await pause(400);
  one = (await session())!;
  check(one.expanded === 'true' && one.terms.length === 6, 'a press held over a render opens them, once');
  const kept = await overRenders(2500);
  one = (await session())!;
  check(kept.renders >= 2 && one.expanded === 'true' && one.focused, `open, they stay open over ${kept.renders} renders, the session keeps the focus`);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', ...SPACE, text: ' ', unmodifiedText: ' ' });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...SPACE });
  one = await until('Space closes the details', async () => {
    const now = await session();
    return now?.expanded === 'false' && now.terms.length === 0 ? now : null;
  });
  check(one.focused, 'Space closes them, the focus stays');
  await press(browser, 'Enter', 13, '\r');
  await until('Enter opens them again', async () => (await session())?.terms.length === 6);
  await press(browser, 'Enter', 13, '\r');
  await until('and Enter closes them', async () => (await session())?.terms.length === 0);
  check(true, 'Enter opens and closes them as well');

  // ---------- the waiting column: cards, answers in the app, pull requests ----------
  g = await settled(browser, WAITING);
  check(g.max > 200 && g.more, `${g.entries.length} cards and entries are more than fit (${Math.round(g.max)} px more), the bottom fades out`);
  check(shown(g), "the column's title and GitHub's line are shown, outside the list");
  check(g.overflowX <= 0, 'nothing runs out of the waiting column to the side');

  const waitingByWheel = await scrollWith(browser, WAITING, wheel(browser, 120), 'end');
  g = waitingByWheel.g;
  await screenshot(browser, shots, 'columns-bottom');
  check(g.scrollTop >= g.max - 1, `the mouse wheel scrolls the waiting column to the end (${Math.round(g.scrollTop)} of ${Math.round(g.max)} px)`);
  check(lastReadable(g), 'then the last pull request can be read in full: no fade over it');
  check(waitingByWheel.read.size === g.entries.length, `on the way every card and entry could be read (${waitingByWheel.read.size} of ${g.entries.length})`);
  check(shown(g), "the title and GitHub's line are still shown");

  renders = await countRenders(browser, WAITING.list);
  await pause(2500);
  after = await measure(browser, WAITING);
  check((await renders()) > 0, 'the waiting column was drawn again in between');
  check(after.scrollTop === g.scrollTop && lastReadable(after), 'it keeps its place over the renders');

  // A finger: back to the top, then down until the last card's Allow is in view, and tap it.
  g = (await scrollWith(browser, WAITING, swipe(browser, -300), 'start')).g;
  check(g.scrollTop === 0, 'a finger moves the waiting column back to the top');
  const last = COUNTS.cards - 1;
  let allow = await button(last, 'allow');
  for (let i = 0; i < 20 && allow && !allow.inView; i++) {
    const view = g.view!;
    await swipe(browser, 120)({ x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 });
    g = await settled(browser, WAITING);
    allow = await button(last, 'allow');
  }
  check(allow?.inView === true && !allow.disabled, 'a finger brings the Allow of the last card into view');
  await tap(browser, (allow!.box.left + allow!.box.right) / 2, (allow!.box.top + allow!.box.bottom) / 2);
  check(behaviorOf(await answerOf(replies[last]!, 'the tap')) === 'allow', 'tapped, it allows that request');
  g = (await scrollWith(browser, WAITING, swipe(browser, 300), 'end')).g;
  check(g.scrollTop >= g.max - 1 && lastReadable(g), 'a finger moves the column to its end, which can be read');

  // Keyboard: Tab to the Allow of the card before it, which comes into view; End to the foot; Enter allows.
  const before = last - 1;
  // Tab from the top of the page: from the card tapped last it would go on past the page's last element
  // and leave the page for the browser's own controls, after which this headless Edge no longer scrolls by
  // keys.
  await browser.evaluate("document.querySelector('#agents').focus()");
  focused = false;
  for (let i = 0; i < 120 && !focused; i++) {
    await press(browser, 'Tab', 9);
    focused = await browser.call<boolean>(`(card) => document.activeElement === document.querySelectorAll('.card')[card]?.querySelector('[data-decision="allow"]')`, before);
  }
  check(focused, 'Tab reaches the Allow of a card further down');
  allow = await button(before, 'allow');
  check(allow?.inView === true, 'focused, it is scrolled into view');
  await press(browser, 'End', 35);
  g = await settled(browser, WAITING);
  check(
    g.scrollTop >= g.max - 1 && lastReadable(g),
    `End scrolls the column to its foot, which can be read (${Math.round(g.scrollTop)} of ${Math.round(g.max)} px, fade ${g.more}, last ${g.entries.at(-1)?.readable}, focus ${await browser.evaluate<string>('document.activeElement?.id || document.activeElement?.className')})`,
  );
  await press(browser, 'Enter', 13, '\r');
  check(behaviorOf(await answerOf(replies[before]!, 'Enter')) === 'allow', 'Enter allows that request');

  // ---------- the status column: hardware and the plans' usage below two alerts ----------
  await browser.evaluate('document.activeElement?.blur()');
  g = await until('the status column shows the hardware and the plans', async () => {
    const now = await measure(browser, STATUS);
    return now.entries.length >= 8 ? now : null;
  });
  check(g.max > 20 && g.more, `two alerts and the gauges are more than fit (${Math.round(g.max)} px more), the bottom fades out`);
  await screenshot(browser, shots, 'status-top');
  check(
    g.entries[0]!.classes.includes('log-state') && g.entries[1]!.classes.includes('log-state') && g.entries[0]!.readable,
    'the alerts come first, the first one in view in full',
  );
  check(shown(g), 'the clock, the hub and its last event are shown, outside');
  const statusByWheel = await scrollWith(browser, STATUS, wheel(browser, 120), 'end');
  g = statusByWheel.g;
  await screenshot(browser, shots, 'status-bottom');
  check(g.scrollTop >= g.max - 1, `the mouse wheel scrolls the gauges to the end (${Math.round(g.scrollTop)} of ${Math.round(g.max)} px)`);
  check(lastReadable(g), 'then the last limit of the plans can be read in full: no fade over it');
  const room = await browser.call<number>(`(selector, parts) => { const list = document.querySelector(selector); const right = list.getBoundingClientRect().left + list.clientLeft + list.clientWidth; return Math.min(...[...list.querySelectorAll(parts)].map((n) => right - n.getBoundingClientRect().right)); }`, STATUS.list, '.gauge__percent, .gauge__extra');
  check(room >= 7.5, `the values keep room to the scroll bar (${Math.round(room)} px)`);
  check(statusByWheel.read.size === g.entries.length, `on the way both alerts and every gauge could be read (${statusByWheel.read.size} of ${g.entries.length})`);
  check(shown(g), 'the clock, the hub and its last event are still shown');
  renders = await countRenders(browser, STATUS.list);
  await pause(2500);
  after = await measure(browser, STATUS);
  check((await renders()) > 0 && after.scrollTop === g.scrollTop && lastReadable(after), 'the gauges keep their place over the renders');
  focused = false;
  for (let i = 0; i < 60 && !focused; i++) {
    await press(browser, 'Tab', 9);
    focused = await browser.evaluate<boolean>("document.activeElement?.id === 'status-details'");
  }
  check(focused, 'Tab reaches the hints and gauges');
  await press(browser, 'Home', 36);
  g = await settled(browser, STATUS);
  check(g.scrollTop === 0, 'Home goes back to the first alert');
  g = (await scrollWith(browser, STATUS, () => press(browser, 'PageDown', 34), 'end')).g;
  check(g.scrollTop >= g.max - 1 && lastReadable(g), 'Page Down scrolls to the last, which can be read');
  await browser.evaluate('document.activeElement?.blur()');
  g = (await scrollWith(browser, STATUS, swipe(browser, -200), 'start')).g;
  check(g.scrollTop === 0, 'a finger moves them back to the first alert');
  g = (await scrollWith(browser, STATUS, swipe(browser, 200), 'end')).g;
  check(g.scrollTop >= g.max - 1 && lastReadable(g), 'a finger moves them to the last, which can be read');

  // ---------- only a few: they fit, nothing scrolls, nothing moves ----------
  few = await testHub(path.join(dir, 'few'), 1, false, 12, 1500);
  await fill(few.hub, few.token, { working: 2, answers: 1, cards: 1 });
  await openDisplay(browser, few.startFile);
  await until('the display shows the few', async () => {
    const [agents, waiting, status] = await Promise.all([measure(browser, AGENTS), measure(browser, WAITING), measure(browser, STATUS)]);
    return agents.entries.length === 5 && waiting.entries.length === 3 && status.entries.length >= 6;
  });
  await screenshot(browser, shots, 'columns-few');
  const quiet: Array<[string, ListSpec]> = [
    ['agents', AGENTS],
    ['waiting', WAITING],
    ['status', STATUS],
  ];
  const flush = await browser.call<number>(`(selector, parts) => { const list = document.querySelector(selector); const right = list.getBoundingClientRect().left + list.clientLeft + list.clientWidth; return Math.min(...[...list.querySelectorAll(parts)].map((n) => right - n.getBoundingClientRect().right)); }`, STATUS.list, '.gauge__percent, .gauge__extra');
  check(Math.abs(flush) <= 0.5, `without a scroll bar the values stand at the edge as before (${Math.round(flush)} px)`);
  for (const [name, spec] of quiet) {
    g = await settled(browser, spec);
    check(g.max <= 0 && !g.more && g.mask === 'none' && g.scrollbar === 0, `the ${name} column: nothing to scroll, no fade, no scroll bar`);
    check(g.entries.every((e) => e.readable) && shown(g), `the ${name} column: all of it is shown`);
    await pause(1500);
    const later = await measure(browser, spec);
    check(
      later.entries.every((e, i) => Math.abs(e.box.top - g.entries[i]!.box.top) < 0.5) && later.scrollTop === 0,
      `the ${name} column: over the renders nothing moves`,
    );
  }

  // ---------- the last decisions: folded at the foot of the waiting column, only those of the last day; open, they lie over the cards ----------
  const decisions = () =>
    browser.call<{
      hidden: boolean;
      expanded: string | null;
      text: string;
      names: string[];
      labels: string[];
      box: Box;
      inView: boolean;
      aboveGitHub: boolean;
      focused: boolean;
      first: boolean;
      overCards: boolean;
      onTop: boolean;
      cards: number[];
      where: string;
    }>(
      `() => {
      const section = document.querySelector('#decisions');
      const button = document.querySelector('#decisions-toggle');
      const list = document.querySelector('#decisions-list');
      const shown = [...list.querySelectorAll('.decision')].filter((n) => n.getClientRects().length > 0);
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const column = document.querySelector('.col--waiting').getBoundingClientRect();
      const area = document.querySelector('#waiting-list').getBoundingClientRect();
      const github = document.querySelector('#github-state');
      const l = list.getBoundingClientRect();
      const middle = shown.length > 0 ? document.elementFromPoint(l.left + l.width / 2, l.top + l.height / 2) : null;
      return {
        hidden: section.hidden,
        expanded: button.getAttribute('aria-expanded'),
        text: button.textContent,
        names: shown.map((n) => n.querySelector('.entry__name').textContent),
        labels: shown.map((n) => n.querySelector('.az-label')?.textContent ?? ''),
        box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        inView: r.top >= column.top && r.bottom <= column.bottom && hit !== null && button.contains(hit),
        aboveGitHub: github.hidden || r.bottom <= github.getBoundingClientRect().top + 0.5,
        focused: document.activeElement === button,
        first: (() => { const b = shown[0]?.getBoundingClientRect(); return b !== undefined && b.top >= l.top - 0.5 && b.bottom <= l.bottom + 0.5; })(),
        overCards: shown.length > 0 && l.top >= area.top - 0.5 && l.bottom <= r.top + 0.5 && l.left >= column.left && l.right <= column.right,
        onTop: middle !== null && list.contains(middle),
        cards: [...document.querySelectorAll('#waiting-list .card, #waiting-list .entry')].map((n) => n.getBoundingClientRect().top),
        where: 'list ' + Math.round(l.top) + '-' + Math.round(l.bottom) + ' x ' + Math.round(l.left) + '-' + Math.round(l.right) + ', requests from ' + Math.round(area.top) + ', line at ' + Math.round(r.top) + ', column ' + Math.round(column.left) + '-' + Math.round(column.right) + ', middle: ' + (middle ? middle.className || middle.tagName : 'none'),
      };
    }`,
    );
  const click = async (box: Box) => {
    const x = (box.left + box.right) / 2;
    const y = (box.top + box.bottom) / 2;
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  };
  // Of the ten the hub read back, the two oldest are two days old: eight are of the last day.
  const TITLE = /^(The last 8 decisions|Die letzten 8 Entscheidungen)$/;
  let folded = await decisions();
  check(
    !folded.hidden && folded.inView && folded.aboveGitHub && folded.expanded === 'false' && folded.names.length === 0 && TITLE.test(folded.text),
    `the decisions of the last day wait folded in one line at the foot of the waiting column, above GitHub's line ("${folded.text}")`,
  );
  const cardsBefore = folded.cards;
  await click(folded.box);
  folded = await until('a click opens the decisions', async () => {
    const now = await decisions();
    return now.expanded === 'true' && now.names.length === 8 ? now : null;
  });
  check(folded.names[0] === 'npm run step-12' && folded.names[7] === 'npm run step-05', `a click opens them: the eight of the last day, the newest first (${folded.names[0]} … ${folded.names[7]})`);
  check(folded.first && folded.labels.every((l) => l !== ''), 'each with how it ended, the newest in view');
  check(folded.overCards && folded.onTop, `open, they lie over the requests, from the line upwards, inside the column (${folded.where})`);
  check(folded.cards.length === cardsBefore.length && folded.cards.every((top, i) => Math.abs(top - cardsBefore[i]!) < 0.5), 'the requests below them keep their place');
  check(shown(await measure(browser, STATUS)), 'the clock, the hub and its last event stay shown');
  const redrawn = await countRenders(browser, '#decisions-list');
  await pause(2500);
  folded = await decisions();
  check((await redrawn()) >= 2 && folded.expanded === 'true' && folded.names.length === 8 && folded.focused, 'open, they stay open over the renders, the line keeps the focus');
  await press(browser, 'Enter', 13, '\r');
  folded = await until('Enter closes the decisions', async () => {
    const now = await decisions();
    return now.expanded === 'false' && now.names.length === 0 ? now : null;
  });
  check(folded.focused && TITLE.test(folded.text), 'Enter folds them again; the line keeps the focus');
  await click(folded.box);
  await until('another click opens them', async () => (await decisions()).names.length === 8);
  await click((await decisions()).box);
  folded = await until('the next click closes them', async () => {
    const now = await decisions();
    return now.expanded === 'false' && now.names.length === 0 ? now : null;
  });
  check(true, 'the next click opens them again, and the one after that folds them');

  // ---------- a request that waits long reminds: its card pulses until it is decided ----------
  const card = () =>
    browser.call<{ remind: boolean; animation: string; shadow: string; allow: Box | null }>(
      `() => {
      const node = document.querySelector('.card');
      const allow = node.querySelector('[data-decision="allow"]');
      const r = allow ? allow.getBoundingClientRect() : null;
      return {
        remind: node.classList.contains('card--remind'),
        animation: getComputedStyle(node).animationName,
        shadow: getComputedStyle(node).boxShadow,
        allow: r && r.width > 0 ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null,
      };
    }`,
    );
  // Motion as the system would allow it; this machine's Windows may have turned animations off.
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  let waited = await until('the card reminds', async () => {
    const now = await card();
    return now.remind ? now : null;
  });
  check(waited.animation === 'remind', `a request that waited longer than its reminder time pulses (${waited.animation}, ${waited.shadow})`);
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  waited = await card();
  check(waited.remind && waited.animation === 'none' && waited.shadow !== 'none', 'without motion it keeps a frame instead');
  await browser.send('Emulation.setEmulatedMedia', { features: [] });
  await tap(browser, (waited.allow!.left + waited.allow!.right) / 2, (waited.allow!.top + waited.allow!.bottom) / 2);
  waited = await until('the decided card stops reminding', async () => {
    const now = await card();
    return !now.remind && now.allow === null ? now : null;
  });
  check(waited.animation === 'none', 'once decided it stops');

  // ---------- open decisions close when a new request comes, so it is not hidden behind them ----------
  await click((await decisions()).box);
  await until('the decisions open once more', async () => (await decisions()).expanded === 'true');
  const late = hook(few.hub.port, few.token, 'card-late', {
    hook_event_name: 'PermissionRequest',
    session_title: 'A late request',
    tool_name: 'Bash',
    tool_input: { command: 'npm run late', description: 'Late' },
  }).catch(() => '');
  folded = await until('a new request closes the decisions', async () => {
    const now = await decisions();
    return now.expanded === 'false' && now.names.length === 0 ? now : null;
  });
  const seen = await browser.call<boolean>(
    `() => [...document.querySelectorAll('.card')].some((c) => c.textContent.includes('A late request') && c.getClientRects().length > 0)`,
  );
  check(seen, 'a new request folds the open decisions, and its card shows');
  void late;

  // ---------- a tap opens: a session from its details, one waiting for an answer, a pull request ----------
  // The desktop app's hooks send its id of the session along: these two can be opened in it.
  await hook(few.hub.port, few.token, 'agent-01', { hook_event_name: 'UserPromptSubmit', prompt: 'x' }, { 'X-Stellwerk-App-Session': 'local_check-agent-01' });
  await hook(few.hub.port, few.token, 'asking-01', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'x' }, { 'X-Stellwerk-App-Session': 'local_check-asking-01' });
  /** Where an element is, scrolled into view in its list first. */
  const boxOf = (selector: string) =>
    browser.call<Box | null>(
      `(selector) => { const n = document.querySelector(selector); if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null; }`,
      selector,
    );
  /** A mouse press on the middle of `box`, held until the list below has been drawn again, then let go. */
  const pressOverRender = async (box: Box, list: string) => {
    const x = (box.left + box.right) / 2;
    const y = (box.top + box.bottom) / 2;
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    const renders = await countRenders(browser, list);
    await until(`a render of ${list} while the button is down`, async () => (await renders()) >= 1);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const agent = (id: string) => `#agents [data-session="${id}"]`;
  // A session without the app's id: its details hold no button.
  await click((await until('the second session is in view', () => boxOf(agent('agent-02'))))!);
  await until('its details open', async () => (await browser.call<string | null>(`(s) => document.querySelector(s)?.getAttribute('aria-expanded') ?? null`, agent('agent-02'))) === 'true');
  check((await boxOf(`${agent('agent-02')} .agent__open`)) === null, 'a session the app gave no id to has no button to open it');
  await click((await boxOf(agent('agent-02')))!);
  // One of the app: its details end with the button, which a press held over a render still presses.
  await click((await until('the first session is in view', () => boxOf(agent('agent-01'))))!);
  const openButton = await until('its details show the button', () => boxOf(`${agent('agent-01')} .agent__open`));
  const label = await browser.call<string>(`(s) => document.querySelector(s).textContent`, `${agent('agent-01')} .agent__open`);
  check(/^(Open in Claude|In Claude öffnen)$/.test(label), `the details of a session of the app end with "${label}"`);
  await pressOverRender(openButton, AGENTS.list);
  await until('the session is opened', async () => opened.length === 1);
  const still = await browser.call<string | null>(`(s) => document.querySelector(s)?.getAttribute('aria-expanded') ?? null`, agent('agent-01'));
  check(opened[0] === 'claude://claude.ai/epitaxy/local_check-agent-01' && still === 'true', `a press held over a render opens it in the app (${opened[0]}); the details stay open`);
  // A session waiting for an answer in the app, and a pull request: each a tap, a second apart.
  await pause(1100);
  const answer = await until('the answer is in view', () => boxOf('#answers .entry--tappable'));
  await pressOverRender(answer, '#answers');
  await until('the waiting session is opened', async () => opened.length === 2);
  check(opened[1] === 'claude://claude.ai/epitaxy/local_check-asking-01', `a press on one waiting for an answer opens it where the answer is given (${opened[1]})`);
  await pause(1100);
  const pull = await until('the pull request is in view', () => boxOf('#pulls .entry--tappable'));
  await pressOverRender(pull, '#pulls');
  await until('the pull request is opened', async () => opened.length === 3);
  check(/^https:\/\/github\.com\/example\/[a-z-]+\/pull\/\d+$/.test(opened[2]!), `a press on a pull request opens it in the browser (${opened[2]})`);
} finally {
  await edge?.close();
  await many.hub.close();
  await few?.hub.close();
  await pause(500);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log('Column check passed.');
