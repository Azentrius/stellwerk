// The failing monitors in a real Edge at the display's 1920×720: with more than fit, the list scrolls by
// mouse wheel, finger and keyboard down to the last one, which can then be read in full; the title, the
// number up and the line of the last answer stay in place; the position holds over the display's regular
// renders; long names wrap instead of running out of the column; with few or no failures nothing scrolls
// and nothing moves. An isolated hub with a made-up token and key; Uptime Kuma's answers are made up here,
// nothing goes online. Needs the display built (npm run build) and Edge.
//
// Usage: node tools/check-monitors.ts [folder for screenshots]
//
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { displayKey, displayStartPage, startHub } from '../src/hub/hub.ts';
import { check, openEdge, pause, until, type Edge } from './edge.ts';
import { countRenders, measure, openDisplay, press, screenshot, scrollWith, settled, swipe, wheel, type Box, type Entry, type Geometry, type ListSpec } from './lists.ts';

const ROOT = path.join(import.meta.dirname, '..');
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;

// ---------- Uptime Kuma, made up ----------
type Status = 'up' | 'down' | 'pending' | 'maintenance';
const VALUE: Record<Status, number> = { down: 0, up: 1, pending: 2, maintenance: 3 };
const pad = (n: number) => String(n).padStart(2, '0');
const LONG_DOWN = "Down 07 - the club's cloud with its calendars, contacts, file shares and the login over HTTPS";
const LONG_PENDING = 'Pending 06 https://a-monitoring-target-with-a-very-long-hostname.example.internal/healthz/deep/path/without/any/break';
// Down 01 to 03 go down only after the first answer, so the hub knows since when: their time changes with
// every render.
const LATE = new Set(['Down 01', 'Down 02', 'Down 03']);
const DOWN = Array.from({ length: 22 }, (_, i) => (i === 6 ? LONG_DOWN : `Down ${pad(i + 1)}`));
const PENDING = Array.from({ length: 6 }, (_, i) => (i === 5 ? LONG_PENDING : `Pending ${pad(i + 1)}`));
const UP = Array.from({ length: 30 }, (_, i) => `Up ${pad(i + 1)}`);

type Scenario = 'many' | 'few' | 'none';
let scenario: Scenario = 'many';
let rounds = 0;
function monitors(round: number): Array<[string, Status]> {
  const up = UP.map((name): [string, Status] => [name, 'up']);
  if (scenario === 'none') return [...up, ['Maintenance 01', 'maintenance']];
  if (scenario === 'few') return [...up, ['Down 01', 'down'], ['Down 02', 'down'], ['Pending 01', 'pending']];
  return [
    ...up,
    ['Maintenance 01', 'maintenance'],
    ...DOWN.map((name): [string, Status] => [name, round === 0 && LATE.has(name) ? 'up' : 'down']),
    ...PENDING.map((name): [string, Status] => [name, 'pending']),
  ];
}
const kumaFetch = (async () => {
  const lines = monitors(rounds++).map(
    ([name, status], i) =>
      `monitor_status{monitor_id="${i + 1}",monitor_name="${name}",monitor_type="http",monitor_url="https://",monitor_hostname="null",monitor_port="null"} ${VALUE[status]}`,
  );
  return new Response(`# TYPE monitor_status gauge\n${lines.join('\n')}\n`, { status: 200 });
}) as typeof fetch;

// ---------- what the display shows ----------
const MONITORS: ListSpec = {
  list: '#monitors-failing',
  entries: '.monitor',
  parts: ['.entry__name', '.az-label'],
  name: '.entry__name',
  fade: 'monitors__failing--more',
  fixed: { title: 'monitors-title', ok: 'monitors-ok', state: 'monitors-state' },
};
const statusOf = (e: Entry) => (e.classes.includes('monitor--down') ? 'down' : 'pending');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-monitors-'));
const token = randomBytes(32).toString('hex');
const hub = await startHub({
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
  uptimeKuma: { url: 'http://192.0.2.10:3001', key: `uk1_${'check'.repeat(8)}`, intervalMs: 500, fetch: kumaFetch },
});
if (hub.missingBuild) throw new Error('The display is not built. Run "npm run build" first.');
const startFile = path.join(dir, 'display.html');
fs.writeFileSync(startFile, displayStartPage(hub.port, displayKey(token)));

let edge: Edge | null = null;
try {
  edge = await openEdge(path.join(dir, 'profile'));
  const browser = edge;
  const geometry = () => measure(browser, MONITORS);
  const count = () => browser.evaluate<string>("document.getElementById('monitors-count').textContent");
  const fixedShown = (g: Geometry) => Object.values(g.fixed).every((f) => f.shown);
  const lastReadable = (g: Geometry) => g.entries.at(-1)?.readable === true && !g.more && g.mask === 'none';

  await openDisplay(browser, startFile);

  // ---------- more failures than fit ----------
  const failing = DOWN.length + PENDING.length;
  let g = await until('the display shows the failing monitors, Down 01 to 03 with their time', async () => {
    const now = await geometry();
    return now.entries.length === failing && now.entries.slice(0, 3).every((e) => LATE.has(e.text)) ? now : null;
  });
  await screenshot(browser, shots, 'many-top');
  check(g.max > 200 && g.more, `${failing} failing monitors are more than fit (${Math.round(g.max)} px more), the bottom fades out`);
  check((await count()) === `(${failing})`, `the title counts all ${failing}`);
  check(fixedShown(g), 'title, number up and the line of the last answer are shown, outside the list');
  const statuses = g.entries.map(statusOf).join(' ');
  check(statuses === [...DOWN.map(() => 'down'), ...PENDING.map(() => 'pending')].join(' '), 'down before pending');
  check(
    g.entries.every((e, i) => i === 0 || e.box.top >= g.entries[i - 1]!.box.bottom - 0.5),
    'the entries stand one below the other in that order',
  );

  // 1. Mouse wheel, down to the last one; every entry could be read on the way.
  const byWheel = await scrollWith(browser, MONITORS, wheel(browser, 120), 'end');
  g = byWheel.g;
  await screenshot(browser, shots, 'many-bottom');
  check(g.scrollTop >= g.max - 1 && g.scrollTop > 0, `the mouse wheel scrolls the list to its end (${Math.round(g.scrollTop)} of ${Math.round(g.max)} px)`);
  check(lastReadable(g), 'then the last monitor, its name and its state, can be read in full: no fade over it');
  check(byWheel.read.size === failing, `on the way every one of the ${failing} could be read (${byWheel.read.size})`);
  check(g.entries.slice(DOWN.length).every((e) => e.readable), 'all pending monitors after the down ones are in view at the end');
  check(fixedShown(g), 'title, number up and the line of the last answer are still shown');
  const shown = new Set(g.entries.map((e) => e.text));
  check([...DOWN, ...PENDING].every((name) => shown.has(name)), 'every failing monitor is in the list with its whole name');
  check(g.entries.every((e) => !e.clipped), 'no name is cut off: long names wrap');
  check(g.overflowX <= 0, 'nothing runs out of the column to the side');

  // 2. The display's regular renders (each second, and with each answer of Uptime Kuma) keep the place.
  const renders = await countRenders(browser, MONITORS.list);
  await pause(2500);
  const after = await geometry();
  const changes = await renders();
  check(changes > 0, `the list was drawn again in between (${changes} changes)`);
  check(after.scrollTop === g.scrollTop, `the position holds over the renders (${Math.round(after.scrollTop)} px)`);
  check(lastReadable(after), 'the last monitor stays readable');

  // 3. Keyboard: Tab reaches the list, with the focus ring; Home, then Page Down to the end.
  await browser.evaluate('document.activeElement?.blur()');
  let focused = false;
  for (let i = 0; i < 10 && !focused; i++) {
    await press(browser, 'Tab', 9);
    focused = await browser.evaluate<boolean>("document.activeElement?.id === 'monitors-failing'");
  }
  check(focused, 'Tab reaches the list');
  const ring = await browser.evaluate<{ visible: boolean; style: string; width: string }>(`(() => {
    const list = document.querySelector('#monitors-failing');
    const style = getComputedStyle(list);
    return { visible: list.matches(':focus-visible'), style: style.outlineStyle, width: style.outlineWidth };
  })()`);
  check(ring.visible && ring.style === 'solid' && parseFloat(ring.width) >= 2, `the focused list shows the focus ring (${ring.style} ${ring.width})`);
  await screenshot(browser, shots, 'many-focus');
  await press(browser, 'Home', 36);
  g = await settled(browser, MONITORS);
  check(g.scrollTop === 0, 'Home goes back to the first');
  const byKeys = await scrollWith(browser, MONITORS, () => press(browser, 'PageDown', 34), 'end');
  g = byKeys.g;
  check(g.scrollTop >= g.max - 1, 'Page Down scrolls to the end');
  check(lastReadable(g), 'the last monitor can be read in full');

  // 4. Touch: a finger up to the first, then down to the last.
  await browser.evaluate('document.activeElement?.blur()');
  const up = await scrollWith(browser, MONITORS, swipe(browser, -300), 'start');
  check(up.g.scrollTop === 0, 'a finger moves the list back to the first');
  const byTouch = await scrollWith(browser, MONITORS, swipe(browser, 300), 'end');
  g = byTouch.g;
  check(g.scrollTop >= g.max - 1, 'a finger moves the list to its end');
  check(lastReadable(g), 'the last monitor can be read in full');
  check(fixedShown(g), 'title, number up and the line of the last answer are still shown');

  // ---------- few failures: they fit, nothing scrolls, nothing moves ----------
  scenario = 'few';
  g = await until('the display shows three failing monitors', async () => {
    const now = await geometry();
    return now.entries.length === 3 ? now : null;
  });
  await screenshot(browser, shots, 'few');
  check(g.max <= 0 && !g.more && g.mask === 'none', 'three fit: nothing to scroll, no fade');
  check(g.scrollbar === 0, 'no scroll bar takes room');
  check(!g.focusable, 'the list is no stop for Tab when there is nothing to scroll');
  const few = g.view!;
  check(Math.abs(few.bottom - few.top - g.content) <= 1, 'the list is as high as what it holds');
  check(g.fixed.ok!.box.top - few.bottom <= 8.5, 'the number up follows right below');
  check(g.entries.every((e) => e.readable) && fixedShown(g), 'all three and the lines around them are shown');
  await pause(2500);
  const later = await geometry();
  const same = (a: Box, b: Box) => Math.abs(a.top - b.top) < 0.5 && Math.abs(a.bottom - b.bottom) < 0.5;
  check(
    same(later.view!, few) && Object.keys(g.fixed).every((key) => same(later.fixed[key]!.box, g.fixed[key]!.box)),
    'over the renders nothing moves',
  );

  // ---------- none failing ----------
  scenario = 'none';
  g = await until('the display shows no failing monitor', async () => {
    const now = await geometry();
    return now.entries.length === 0 && now.view === null ? now : null;
  });
  await screenshot(browser, shots, 'none');
  check((await count()) === '' && !g.focusable, 'no count, no list, nothing to reach');
  check(g.fixed.ok!.box.top - g.fixed.title!.box.bottom <= 12.5 && fixedShown(g), 'the number up stands right below the title');
  const column = await browser.evaluate<number>("(() => { const n = document.querySelector('#monitors'); return n.scrollHeight - n.clientHeight; })()");
  check(column <= 0, 'the column has nothing to scroll');
} finally {
  await edge?.close();
  await hub.close();
  await pause(500);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log('Monitor check passed.');
