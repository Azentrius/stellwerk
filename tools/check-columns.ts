// The agents and the waiting column in a real Edge at the display's 1920×720: with more than fit, each
// scrolls by mouse wheel, finger and keyboard to its last entry, which can then be read in full, and keeps
// its place while the display updates; the column titles and GitHub's line stay in place; the Allow of a
// card far down can be reached and pressed by finger and by keyboard; with only a few nothing scrolls and
// nothing moves. Isolated hubs with made-up tokens; sessions and requests come as hook events, GitHub's
// answers are made up here, nothing goes online. Needs the display built (npm run build) and Edge.
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
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
const pad = (n: number) => String(n).padStart(2, '0');

const AGENTS: ListSpec = {
  list: '#agents',
  entries: '.agent',
  parts: ['.entry__name', '.az-label'],
  name: '.entry__name',
  fixed: { title: 'agents-title' },
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

/** A hub of its own with its start file, as `serve` writes it. */
async function testHub(dir: string, pulls: number): Promise<{ hub: Hub; token: string; startFile: string }> {
  fs.mkdirSync(dir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  const hub = await startHub({
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
  });
  if (hub.missingBuild) throw new Error('The display is not built. Run "npm run build" first.');
  const startFile = path.join(dir, 'display.html');
  fs.writeFileSync(startFile, displayStartPage(hub.port, displayKey(token)));
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
const many = await testHub(path.join(dir, 'many'), 8);
let few: Awaited<ReturnType<typeof testHub>> | null = null;
let edge: Edge | null = null;
try {
  const COUNTS = { working: 26, answers: 4, cards: 5 };
  const replies = await fill(many.hub, many.token, COUNTS);
  const sessions = COUNTS.working + COUNTS.answers + COUNTS.cards;

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
  await browser.evaluate('document.activeElement?.blur()');
  focused = false;
  for (let i = 0; i < 40 && !focused; i++) {
    await press(browser, 'Tab', 9);
    focused = await browser.call<boolean>(`(card) => document.activeElement === document.querySelectorAll('.card')[card]?.querySelector('[data-decision="allow"]')`, before);
  }
  check(focused, 'Tab reaches the Allow of a card further down');
  allow = await button(before, 'allow');
  check(allow?.inView === true, 'focused, it is scrolled into view');
  await press(browser, 'End', 35);
  g = await settled(browser, WAITING);
  check(g.scrollTop >= g.max - 1 && lastReadable(g), 'End scrolls the column to its foot, which can be read');
  await press(browser, 'Enter', 13, '\r');
  check(behaviorOf(await answerOf(replies[before]!, 'Enter')) === 'allow', 'Enter allows that request');

  // ---------- only a few: they fit, nothing scrolls, nothing moves ----------
  few = await testHub(path.join(dir, 'few'), 1);
  await fill(few.hub, few.token, { working: 2, answers: 1, cards: 1 });
  await openDisplay(browser, few.startFile);
  await until('the display shows the few', async () => {
    const [agents, waiting] = await Promise.all([measure(browser, AGENTS), measure(browser, WAITING)]);
    return agents.entries.length === 4 && waiting.entries.length === 3;
  });
  await screenshot(browser, shots, 'columns-few');
  const quiet: Array<[string, ListSpec]> = [
    ['agents', AGENTS],
    ['waiting', WAITING],
  ];
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
} finally {
  await edge?.close();
  await many.hub.close();
  await few?.hub.close();
  await pause(500);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log('Column check passed.');
