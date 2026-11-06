// The pages in a real Edge at the display's 1920×720: a finger drawn sideways goes from the agents to the
// calendar page and back, and the page snaps in place; the arrow keys do the same; a swipe up or down
// still scrolls a list and turns no page; a page out of view takes no taps; a tap on an issue opens it in
// the browser. A new request takes the display back to the first page at once, and while one waits, the
// first page's dot on the calendar page says so. Going to rest takes it back too, and a swipe that wakes
// it turns no page. Without a calendar and without the issues there is one page: no dots, nothing to
// swipe. Isolated hubs with made-up tokens; the calendars and GitHub are made up here, nothing goes
// online. Needs the display built (npm run build) and Edge.
//
// Usage: node tools/check-screens.ts [folder for screenshots]
//
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { displayKey, displayStartPage, startHub, type HubOptions } from '../src/hub/hub.ts';
import { check, openEdge, pause, until, type Edge } from './edge.ts';
import { answerOf, behaviorOf, hook } from './hooks.ts';
import { openDisplay, press, screenshot, swipe, tap, type Box } from './lists.ts';

const ROOT = path.join(import.meta.dirname, '..');
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-screens-'));
/** The links a tap on the display had the hub open. */
const opened: string[] = [];

// ---------- a calendar and GitHub, made up ----------
/** A time here today (and on later days), as iCalendar writes it in UTC. */
const at = (days: number, hours: number, minutes = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hours, minutes).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};
// Enough events that the agenda scrolls: every half hour today and tomorrow.
const events = [0, 1].flatMap((day) =>
  Array.from({ length: 48 }, (_, i) => ['BEGIN:VEVENT', `SUMMARY:Event ${day}-${i}`, `DTSTART:${at(day, 0, i * 30)}`, `DTEND:${at(day, 0, i * 30 + 25)}`, 'END:VEVENT']),
);
const calendarText = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flat(), 'BEGIN:VTODO', 'SUMMARY:Pay the invoice', 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n');
const fakeFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname === 'calendar.example') return new Response(calendarText, { status: 200 });
  const answers: Record<string, unknown> = {
    '/orgs/example/repos': [],
    '/issues': [{ number: 57, title: 'Retry webhooks', updated_at: new Date().toISOString(), repository: { name: 'shop-api', owner: { login: 'example' } } }],
  };
  const body = answers[url.pathname];
  return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
}) as typeof fetch;

/** A hub of its own with a start file; with the calendar and the issues unless told otherwise. */
async function testHub(name: string, extra: Partial<HubOptions> = {}, pages = true) {
  const token = randomBytes(32).toString('hex');
  const hub = await startHub({
    open: (link) => opened.push(link),
    port: 0,
    token,
    holdMs: 60_000,
    scale: 1,
    version: 'check',
    sound: false,
    auditFile: path.join(dir, `${name}-audit.jsonl`),
    uiRoot: path.join(ROOT, 'ui'),
    webRoot: path.join(ROOT, 'dist', 'ui'),
    log: () => {},
    ...(pages
      ? {
          github: { owner: 'example', token: `github_pat_${'check'.repeat(8)}`, intervalMs: 3_600_000, issues: true, fetch: fakeFetch },
          calendar: { sources: [{ name: 'Work', url: 'https://calendar.example/work.ics' }], intervalMs: 3_600_000, fetch: fakeFetch },
        }
      : {}),
    ...extra,
  });
  if (hub.missingBuild) throw new Error('The display is not built. Run "npm run build" first.');
  const startFile = path.join(dir, `${name}-display.html`);
  fs.writeFileSync(startFile, displayStartPage(hub.port, displayKey(token)));
  return { hub, token, startFile };
}

const main = await testHub('main');
// Long enough that a swipe after the waking one, and its snapping, end before it rests again: the display
// looks once a second, so it rests between 4 and 5 s after the last news or the waking touch.
const resting = await testHub('resting', { quietAfterMs: 4000 });
const single = await testHub('single', {}, false);

let edge: Edge | null = null;
try {
  edge = await openEdge(path.join(dir, 'profile'));
  const browser = edge;
  const pages = () =>
    browser.evaluate<{ page: string; left: number; width: number; scrollWidth: number; agentsInert: boolean; calendarInert: boolean; dots: number; dotsShown: boolean; badge: string }>(`(() => {
      const p = document.getElementById('pages');
      return {
        page: p.dataset.page ?? '', left: p.scrollLeft, width: p.clientWidth, scrollWidth: p.scrollWidth,
        agentsInert: document.getElementById('page-agents').inert, calendarInert: document.getElementById('page-calendar').inert,
        dots: document.querySelectorAll('.page-dots__dot').length, dotsShown: !document.getElementById('page-dots').hidden,
        badge: document.querySelector('.page-dots__badge')?.textContent ?? '',
      };
    })()`);
  const rect = (selector: string) =>
    browser.call<Box | null>(
      '(selector) => { const n = document.querySelector(selector); if (!n) return null; const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }',
      selector,
    );
  /**
   * A finger drawn sideways from one x to another at a height: right to left goes to the next page. Always
   * more than half a page (768 px): the pages snap to the nearest one when the browser sees no fling at the
   * lift, which a short drag of a finger that stops should do, and which a lift a few milliseconds late
   * (Edge busy drawing) turned into: 700 px snapped back now and then.
   */
  const sideways = async (fromX: number, toX: number, y: number) => {
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] });
    for (let step = 1; step <= 10; step++) {
      await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + ((toX - fromX) * step) / 10, y }] });
      await pause(16);
    }
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  /** Waits like until(); one that times out says what it saw last, and where the pages stood on the way. */
  const seeing = async <T>(why: string, probe: () => Promise<T | null | undefined | false>): Promise<T> => {
    let seen: unknown = null;
    const trail: string[] = [];
    try {
      return await until(why, async () => {
        const value = await probe();
        const now = await pages();
        const where = `${now.page || '-'}@${now.left}`;
        if (trail.at(-1) !== where && trail.length < 20) trail.push(where);
        seen = {
          ...now,
          events: await browser.evaluate<number>("document.querySelectorAll('#agenda .event').length"),
          hub: await browser.evaluate<string>("document.getElementById('hub-state')?.textContent ?? ''"),
          url: await browser.evaluate<string>('location.pathname'),
          // Anything but the pages that could take a sideways swipe itself.
          sideways: await browser.evaluate<string[]>(`[...document.querySelectorAll('body *')].filter((n) => n.id !== 'pages' && n.scrollWidth > n.clientWidth && ['auto', 'scroll'].includes(getComputedStyle(n).overflowX)).map((n) => (n.id || n.className) + ':' + n.scrollLeft + '/' + (n.scrollWidth - n.clientWidth))`),
        };
        return value;
      });
    } catch (error) {
      throw new Error(`${(error as Error).message}; last seen: ${JSON.stringify(seen)}; on the way: ${trail.join(' ')}`);
    }
  };
  /** Waits until the pages stand still on a page, snapped in place. */
  const restsOn = (page: string, why: string) =>
    seeing(why, async () => {
      const first = await pages();
      await pause(250);
      const now = await pages();
      return now.page === page && now.left === first.left && Math.abs(now.left - (page === 'agents' ? 0 : now.width)) < 1 ? now : null;
    });

  // ---------- two pages: the agents first ----------
  await openDisplay(browser, main.startFile);
  let p = await seeing('the calendar page is there', async () => {
    const now = await pages();
    return now.dots === 2 && (await rect('#agenda .event')) !== null && now.page === 'agents' ? now : null;
  });
  check(p.left === 0 && !p.agentsInert && p.calendarInert && p.dotsShown, 'at first the agents show; the calendar page, out of view, takes no taps');
  await screenshot(browser, shots, 'agents');

  // A finger drawn sideways over the agents goes to the calendar page, and it snaps in place.
  const agents = (await rect('#agents'))!;
  await sideways(1000, 100, (agents.top + agents.bottom) / 2);
  p = await restsOn('calendar', 'a swipe to the left goes to the calendar page');
  check(p.agentsInert && !p.calendarInert, `a swipe to the left goes to the calendar page and snaps in place (at ${p.left} of ${p.width})`);
  await screenshot(browser, shots, 'calendar');

  // Up and down still scroll the agenda, and turn no page.
  const agenda = (await rect('#agenda'))!;
  const before = await browser.evaluate<number>("document.getElementById('agenda').scrollTop");
  await swipe(browser, 300)({ x: (agenda.left + agenda.right) / 2, y: (agenda.top + agenda.bottom) / 2 });
  await pause(600);
  const after = await browser.evaluate<number>("document.getElementById('agenda').scrollTop");
  p = await pages();
  check(after > before && p.page === 'calendar' && p.left === p.width, `a swipe up scrolls the agenda (${before} to ${after}) and stays on the page`);

  // A tap on an issue opens it in the browser.
  const issue = (await rect('#issues .entry--tappable'))!;
  await tap(browser, (issue.left + issue.right) / 2, (issue.top + issue.bottom) / 2);
  await until('the issue is opened', async () => opened.length === 1);
  check(opened[0] === 'https://github.com/example/shop-api/issues/57', `a tap on an issue opens it in the browser (${opened[0]})`);

  // A swipe to the right over a list that scrolls itself (the agenda) goes back: only up and down stay in it.
  await sideways(300, 1200, (agenda.top + agenda.bottom) / 2);
  await restsOn('agents', 'a swipe to the right over the agenda goes back to the agents');
  check(true, 'a swipe to the right over the agenda, a list that scrolls itself, goes back to the agents');

  // The arrow keys go to the next page and the one before.
  await press(browser, 'ArrowRight', 39);
  await restsOn('calendar', 'the right arrow goes to the calendar page');
  await press(browser, 'ArrowLeft', 37);
  await restsOn('agents', 'the left arrow goes back to the agents');
  await press(browser, 'ArrowRight', 39);
  await restsOn('calendar', 'the right arrow goes to the calendar page again');
  check(true, 'the arrow keys go to the next page and the one before');

  // A new request takes the display back to the agents at once, its card in view.
  const first = hook(main.hub.port, main.token, 'card-1', { hook_event_name: 'PermissionRequest', session_title: 'Deploy', tool_name: 'Bash', tool_input: { command: 'npm run deploy' } });
  p = await until('a new request goes back to the agents', async () => {
    const now = await pages();
    return now.page === 'agents' && now.left === 0 && (await rect('.card [data-decision="allow"]')) !== null ? now : null;
  });
  check(!p.agentsInert && p.calendarInert, 'a new request takes the display back to the agents at once, its card in view');

  // Swiped away while it waits (over the waiting list, which scrolls itself), the first page's dot says so;
  // nothing new, so the page stays.
  const card = (await rect('.card'))!;
  await sideways(1000, 100, (card.top + card.bottom) / 2 - 60);
  p = await restsOn('calendar', 'a swipe away over the waiting list while a request waits');
  await pause(1500);
  p = await pages();
  check(p.page === 'calendar' && p.badge === '1', `on the calendar page the first page's dot says one waits ("${p.badge}"); the page stays`);
  await screenshot(browser, shots, 'calendar-waiting');

  // A second request takes it back again; on the agents the dot carries no number.
  const second = hook(main.hub.port, main.token, 'card-2', { hook_event_name: 'PermissionRequest', session_title: 'Migrate', tool_name: 'Bash', tool_input: { command: 'npm run migrate' } });
  p = await restsOn('agents', 'a second request goes back to the agents');
  check(p.badge === '', 'a second request takes it back again; on the agents the dot carries no number');

  // A page out of view takes no taps: Allow is in view and still works.
  const allow = (await rect('.card [data-decision="allow"]'))!;
  await tap(browser, (allow.left + allow.right) / 2, (allow.top + allow.bottom) / 2);
  check(behaviorOf(await answerOf(first, 'the tap on Allow')) === 'allow', 'back on the agents a tap on Allow allows');
  void second.catch(() => {});

  // ---------- going to rest takes it back to the agents; a waking swipe turns no page ----------
  await openDisplay(browser, resting.startFile);
  await seeing('the second hub shows its calendar page', async () => (await pages()).dots === 2 && (await rect('#agenda .event')) !== null);
  await press(browser, 'ArrowRight', 39);
  await restsOn('calendar', 'on the calendar page');
  await until('the display rests', () => browser.evaluate<boolean>("document.body.classList.contains('quiet')"), 10_000);
  p = await restsOn('agents', 'at rest it goes back to the agents');
  check(true, 'going to rest takes the display back to the agents');
  await sideways(1000, 100, 360);
  await pause(1000);
  p = await pages();
  const awake = !(await browser.evaluate<boolean>("document.body.classList.contains('quiet')"));
  check(awake && p.page === 'agents' && p.left === 0, `a swipe on the resting display wakes it and turns no page (${p.page}, ${p.left})`);
  await sideways(1000, 100, 360);
  await restsOn('calendar', 'awake, the next swipe turns the page');
  check(true, 'awake, the next swipe turns the page');

  // ---------- one page: nothing to swipe ----------
  await openDisplay(browser, single.startFile);
  await until('the third hub shows its display', async () => (await rect('#agents-title')) !== null && (await pages()).width > 0);
  await pause(800);
  p = await pages();
  check(p.dots <= 1 && !p.dotsShown && p.scrollWidth === p.width, `without a calendar there is one page: no dots, nothing to swipe (${p.scrollWidth} of ${p.width})`);
  await sideways(1000, 100, 360);
  await pause(800);
  check((await pages()).left === 0, 'a swipe moves nothing');
} finally {
  await edge?.close();
  await Promise.all([main.hub.close(), resting.hub.close(), single.hub.close()]);
  await pause(500);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log('Screens check passed.');
