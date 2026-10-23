// Stellwerk's display: connects to the hub, shows the sessions, what waits for the user (permission
// requests, answers due in the app, open pull requests), Uptime Kuma's monitors, the hub's state, the
// hardware values and the usage of the plans' limits, and sends decisions. Everything goes over the one WebSocket to the hub that served the page. When that hub
// serves a newer display after an update, the page loads itself again.
//
// SPDX-License-Identifier: Apache-2.0

import type { Decision, ServerMessage, StateMessage } from '../../src/shared/protocol.js';
import { AgentItems, renderAgents } from './agents.ts';
import { renderDecisions } from './decisions.ts';
import { renderAnswers } from './answers.ts';
import { newReminders, waitingForAnswer } from './due.ts';
import { alert, byId, el, icon, label } from './dom.ts';
import { TimedFold } from './fold.ts';
import { renderHardware, renderPlans } from './hardware.ts';
import { pickTexts } from './i18n.ts';
import { renderMonitors } from './monitors.ts';
import { renderPulls } from './pulls.ts';
import { QueueView } from './queue.ts';
import { Rest, inNight, restAfter, watched } from './quiet.ts';
import { splitResting } from './resting.ts';
import { shouldReload } from './reload.ts';
import {
  githubLine,
  hardwareLine,
  hubState,
  newReleaseLine,
  rawLogLine,
  rejectedLine,
  uptimeKumaLine,
  type Problem,
  type State,
} from './states.ts';
import { ago, clock } from './time.ts';

const WS_PROTOCOL = 'stellwerk.v1';
const WS_SESSION_PREFIX = 'stellwerk.session.';
const TOAST_MS = 3000;
/** sessionStorage: the hub build a reload was last tried for. */
const RELOAD_KEY = 'stellwerk-reloaded-for';

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
/** sessionStorage: the page token, kept for the hub's origin only (other ports are other origins). */
const SESSION_KEY = 'stellwerk-session';
const sessionToken = keepSessionToken(meta('stellwerk-session'));
const pageBuild = meta('stellwerk-build');
const scale = Number(meta('stellwerk-scale')) || 1;
document.documentElement.style.setProperty('--stellwerk-scale', String(scale));

// ?lang=en or ?lang=de picks the language; otherwise it follows the system.
const chosen = new URLSearchParams(location.search).get('lang');
const { lang, texts } = pickTexts(chosen ? [chosen] : navigator.languages);
document.documentElement.lang = lang;
for (const node of document.querySelectorAll<HTMLElement>('[data-text]')) {
  const value = texts[node.dataset.text as keyof typeof texts];
  if (typeof value === 'string') node.textContent = value;
}

const queue = new QueueView(byId('queue'), texts, decide);
const agents = byId<HTMLUListElement>('agents');
const agentsEmpty = byId('agents-empty');
const agentsCount = byId('agents-count');
/** The line at the foot of the agents column behind which the sessions at rest wait (resting.ts). */
const restingLine = new TimedFold();
/** The open requests that have reminded already, each once. */
const reminded = new Set<string>();
const restingItem = el('li', 'resting');
const restingButton = el('button', 'resting__toggle');
/** The sessions' elements, and whose details a tap opened. */
const agentItems = new AgentItems();
const toggleDetails = (id: string) => {
  if (!agentItems.open.delete(id)) agentItems.open.add(id);
  tick();
};
/**
 * The last decisions at the foot of the waiting column, folded until a tap opens them; open, they close by
 * themselves a while after the last touch, and at once when a new request comes, so it is not hidden.
 */
const decisionsParts = { section: byId('decisions'), button: byId<HTMLButtonElement>('decisions-toggle'), list: byId<HTMLUListElement>('decisions-list') };
const decisionsLine = new TimedFold();
restingButton.type = 'button';
restingItem.append(restingButton);
const answers = byId<HTMLUListElement>('answers');
const answersSection = byId('answers-section');
const pulls = byId<HTMLUListElement>('pulls');
const pullsSection = byId('pulls-section');
const githubState = byId('github-state');
const hardwareSection = byId('hardware');
const gauges = byId('gauges');
const hardwareState = byId('hardware-state');
const plansNode = byId('plans');
const statusDetails = byId('status-details');
const monitorsNode = byId('monitors');
const monitorsCount = byId('monitors-count');
const monitorsFailing = byId('monitors-failing');
const monitorNodes = { down: byId('monitors-down'), pending: byId('monitors-pending'), ok: byId('monitors-ok') };
const monitorsState = byId('monitors-state');
const waitingCount = byId('waiting-count');
const waitingList = byId('waiting-list');
const waitingEmpty = byId('waiting-empty');
const clockNode = byId('clock');
const hubNode = byId('hub-state');
const lastEvent = byId('last-event');
const rejectedState = byId('rejected-state');
const rawLogState = byId('raw-log-state');
const newReleaseState = byId('new-release-state');
const toastNode = byId('toast');

let state: StateMessage | null = null;
/** The hub's clock minus ours; both run on the same machine, so this stays near zero. */
let clockOffset = 0;
let socket: WebSocket | null = null;
let connected = false;
let attempts = 0;
let toastTimer: number | undefined;
let audio: AudioContext | null = null;
const rest = new Rest(Date.now());
/** The tap that woke the resting display: its click does nothing. */
let swallowClick = false;

byId('all-clear-icon').append(icon('check-circle'));

/**
 * The page token is in the page only as the answer to the start file's sign-in. The display keeps it in
 * this tab's storage, which the browser keeps apart per origin, port included, and sends it only in the
 * WebSocket handshake to its own hub; no cookie, so no other service on this computer gets it. A page
 * loaded at the address alone (a reload, a new build) takes it from there.
 */
function keepSessionToken(fromPage: string): string {
  if (fromPage) {
    try {
      sessionStorage.setItem(SESSION_KEY, fromPage);
    } catch {}
    // The sign-in answered the POST to /login; the display lives at /, so a reload does not post again.
    if (location.pathname !== '/') history.replaceState(null, '', '/');
    return fromPage;
  }
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

function connect(): void {
  // Not signed in: nothing to connect with; the status column says how to open the display.
  if (!sessionToken) return;
  const ws = new WebSocket(`ws://${location.host}/ws`, [WS_PROTOCOL, WS_SESSION_PREFIX + sessionToken]);
  socket = ws;
  ws.addEventListener('open', () => {
    connected = true;
    attempts = 0;
    render();
  });
  ws.addEventListener('message', (event) => onMessage(JSON.parse(String(event.data)) as ServerMessage));
  ws.addEventListener('close', () => {
    connected = false;
    socket = null;
    render();
    window.setTimeout(connect, Math.min(5000, 500 * 2 ** attempts++));
  });
}

function onMessage(message: ServerMessage): void {
  if (message.type === 'state') {
    if (reloadForNewBuild(message.hub.build)) return;
    clockOffset = message.now - Date.now();
    state = message;
    const added = render();
    if (added.length > 0 && message.hub.sound) chime();
  } else if (message.type === 'decision-result' && !message.ok) {
    queue.release(message.id);
    toast(message.reason === 'already-decided' ? texts.alreadyDecided : texts.notOpen);
  }
}

/** Loads the page again when the hub serves another build of the display; true if it does. */
function reloadForNewBuild(hubBuild: string): boolean {
  let tried: string | null = null;
  // Without storage there is no limit on the tries; the hub sends no-store, so a reload brings the new page.
  try {
    tried = sessionStorage.getItem(RELOAD_KEY);
  } catch {}
  if (!shouldReload(pageBuild, hubBuild, tried)) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, hubBuild);
  } catch {}
  location.reload();
  return true;
}

function decide(id: string, decision: Decision): void {
  socket?.send(JSON.stringify({ type: 'decide', id, decision }));
}

/** Draws everything from the last state; returns the ids of new open requests. */
function render(): string[] {
  const added = queue.update(state?.permissions ?? [], connected);
  if (added.length > 0) decisionsLine.close();
  tick();
  return added;
}

/** Everything that changes with time alone. */
function tick(): void {
  const now = Date.now() + clockOffset;
  queue.tick(now, state?.hub.remindAfterMs ?? 0);
  // A request that waits long reminds once more with the tones, when sound is on.
  if (newReminders(state?.permissions ?? [], state?.hub.remindAfterMs ?? 0, now, reminded).length > 0 && state?.hub.sound) chime();
  const sessions = state?.sessions ?? [];
  renderAgents(agents, splitResting(sessions, now), { item: restingItem, button: restingButton, open: restingLine.isOpen(now) }, { items: agentItems, toggle: toggleDetails }, now, texts);
  // With the line's button in it, the browser no longer makes the list a tab stop by itself.
  markScrolling(agents);
  agentsEmpty.hidden = sessions.length > 0;
  agentsCount.textContent = sessions.length > 0 ? `(${sessions.length})` : '';

  const due = waitingForAnswer(sessions);
  renderAnswers(answers, due, now, texts);
  answersSection.hidden = due.length === 0;
  const open = state?.pullRequests ?? [];
  renderPulls(pulls, open, now, texts);
  pullsSection.hidden = open.length === 0;
  const waiting = queue.openCount() + due.length + open.length;
  waitingCount.textContent = waiting > 0 ? `(${waiting})` : '';
  const nothing = (state?.permissions.length ?? 0) === 0 && due.length === 0 && open.length === 0;
  waitingEmpty.hidden = !nothing;
  waitingList.hidden = nothing;
  fadeWhileMore(waitingList, 'waiting--more');
  renderDecisions(decisionsParts, state?.decisions ?? [], decisionsLine.isOpen(now), now, texts);
  clockNode.textContent = clock(now);
  show(hubNode, hubState(connected, texts, sessionToken !== ''));
  const last = state?.hub.lastEventAt ?? null;
  lastEvent.textContent = last === null ? texts.noEvent : texts.lastEvent(ago(now - last, texts));
  // What the hub turned away and whether its raw log is on: hints to look at its log, while it is here.
  const hub = connected ? (state?.hub ?? null) : null;
  showOrHide(rejectedState, rejectedLine(hub, now, texts));
  showOrHide(rawLogState, rawLogLine(hub, texts));
  showOrHide(newReleaseState, newReleaseLine(hub, texts));
  // While the hub is away, its last problems with GitHub and the hardware are old news: only its own
  // alert shows.
  const current = <T>(line: T): T | null => (connected || typeof line === 'string' ? line : null);
  const line = current(githubLine(state?.github ?? null, now, texts));
  githubState.hidden = line === null;
  if (line) show(githubState, line);
  const hardware = state?.hardware ?? null;
  hardwareSection.hidden = hardware === null;
  renderHardware(gauges, hardware, texts);
  const hardwareNote = current(hardwareLine(hardware, texts));
  hardwareState.hidden = hardwareNote === null;
  if (hardwareNote) show(hardwareState, hardwareNote);
  const plans = state?.plans ?? [];
  plansNode.hidden = plans.length === 0;
  renderPlans(plansNode, plans, now, texts);
  markScrolling(statusDetails, 'status-details--more');

  // Uptime Kuma's column; while the hub is away its monitors are old news too.
  const kuma = connected ? (state?.uptimeKuma ?? null) : null;
  monitorsNode.hidden = kuma === null;
  const failing = renderMonitors(monitorNodes, kuma, now, texts);
  monitorsCount.textContent = failing > 0 ? `(${failing})` : '';
  monitorsFailing.hidden = failing === 0;
  markScrolling(monitorsFailing, 'monitors__failing--more');
  const kumaNote = uptimeKumaLine(kuma, now, texts);
  if (kumaNote) show(monitorsState, kumaNote);

  // At rest after a while with nothing new and no open request: dimmed; at night sooner and almost black (quiet.ts).
  const local = new Date(now);
  const atNight = inNight(state?.hub.night ?? null, local.getHours() * 60 + local.getMinutes());
  const resting = rest.update(watched(state, connected), restAfter(state?.hub.quietAfterMs ?? 0, atNight), now);
  document.body.classList.toggle('quiet', resting);
  document.body.classList.toggle('night', resting && atNight);
}

/**
 * A list's bottom fades out while more of it is below, so its last entry can be read in full at the end. At
 * each render and as the list scrolls, not only with the next second.
 */
function fadeWhileMore(node: HTMLElement, className: string): void {
  node.classList.toggle(className, node.scrollHeight - node.scrollTop - node.clientHeight > 4);
}

/**
 * A list that holds more than fits only now and then (the failing monitors; the status column's hints and
 * gauges): it
 * scrolls, its bottom fades out while more is below, and the keyboard can reach it only while there is
 * something to scroll.
 */
function markScrolling(node: HTMLElement, className?: string): void {
  if (className) fadeWhileMore(node, className);
  const scrolls = node.scrollHeight - node.clientHeight > 4;
  // For the stylesheet: room between the text and the scroll bar, only while there is one.
  node.toggleAttribute('data-scrolls', scrolls);
  if (scrolls !== node.hasAttribute('tabindex')) {
    if (scrolls) node.tabIndex = 0;
    else node.removeAttribute('tabindex');
  }
}

/**
 * Puts plain text, a state (as a label with its icon) or a problem (as an alert that says how to fix it)
 * into a status line (the hub's, GitHub's, the hardware's, Uptime Kuma's), when it changed.
 */
function show(node: HTMLElement, content: string | State | Problem): void {
  const key = JSON.stringify(content);
  if (node.dataset.shown === key) return;
  node.dataset.shown = key;
  node.replaceChildren(typeof content === 'string' ? content : 'fix' in content ? alert(content) : label(content));
}

function showOrHide(node: HTMLElement, content: string | State | Problem | null): void {
  node.hidden = content === null;
  if (content !== null) show(node, content);
}

function toast(text: string): void {
  toastNode.replaceChildren(icon('info-circle'), text);
  toastNode.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastNode.hidden = true), TOAST_MS);
}

/** Two soft tones for a new request, only when the configuration turns sound on. */
function chime(): void {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') void audio.resume();
  const start = audio.currentTime;
  [660, 880].forEach((frequency, i) => {
    const at = start + i * 0.18;
    const tone = audio!.createOscillator();
    const gain = audio!.createGain();
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    tone.connect(gain).connect(audio!.destination);
    tone.start(at);
    tone.stop(at + 0.4);
  });
}

connect();
render();
window.setInterval(tick, 1000);
// What fits in the columns depends on the fonts and the window; measure again when they change.
void document.fonts.ready.then(() => tick());
window.addEventListener('resize', () => tick());
waitingList.addEventListener('scroll', () => fadeWhileMore(waitingList, 'waiting--more'), { passive: true });
monitorsFailing.addEventListener('scroll', () => markScrolling(monitorsFailing, 'monitors__failing--more'), { passive: true });
decisionsParts.button.addEventListener('click', () => {
  decisionsLine.toggle(Date.now() + clockOffset);
  tick();
});
// Touching the open decisions keeps them open.
decisionsParts.list.addEventListener('pointerdown', () => decisionsLine.touched(Date.now() + clockOffset), { passive: true });
decisionsParts.list.addEventListener('scroll', () => decisionsLine.touched(Date.now() + clockOffset), { passive: true });
restingButton.addEventListener('click', () => {
  restingLine.toggle(Date.now() + clockOffset);
  tick();
});
// Touching the agents column keeps an open line open.
agents.addEventListener('pointerdown', () => restingLine.touched(Date.now() + clockOffset), { passive: true });
statusDetails.addEventListener('scroll', () => markScrolling(statusDetails, 'status-details--more'), { passive: true });
// A tap on the resting display wakes it and does nothing else: the click that follows goes nowhere.
document.addEventListener(
  'pointerdown',
  (event) => {
    if (!document.body.classList.contains('quiet')) return;
    rest.wake(Date.now() + clockOffset);
    document.body.classList.remove('quiet', 'night');
    swallowClick = true;
    window.setTimeout(() => (swallowClick = false), 1000);
    event.preventDefault();
    event.stopPropagation();
  },
  { capture: true },
);
document.addEventListener(
  'click',
  (event) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  },
  { capture: true },
);
