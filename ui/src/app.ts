// Stellwerk's display: connects to the hub, shows the sessions, what waits for the user (permission
// requests, answers due in the app, open pull requests), the hub's state, the hardware values and the usage
// of the plans' limits, and sends decisions. Everything goes over the one WebSocket to the hub that served the page. When that hub
// serves a newer display after an update, the page loads itself again.
//
// SPDX-License-Identifier: Apache-2.0

import type { Decision, ServerMessage, StateMessage } from '../../src/shared/protocol.js';
import { renderAgents } from './agents.ts';
import { renderAnswers, waitingForAnswer } from './answers.ts';
import { alert, byId, icon, label } from './dom.ts';
import { renderHardware, renderPlans } from './hardware.ts';
import { pickTexts } from './i18n.ts';
import { renderPulls } from './pulls.ts';
import { QueueView } from './queue.ts';
import { shouldReload } from './reload.ts';
import { githubLine, hardwareLine, hubState, type Problem, type State } from './states.ts';
import { ago, clock } from './time.ts';

const WS_PROTOCOL = 'stellwerk.v1';
const WS_SESSION_PREFIX = 'stellwerk.session.';
const TOAST_MS = 3000;
/** sessionStorage: the hub build a reload was last tried for. */
const RELOAD_KEY = 'stellwerk-reloaded-for';

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
const sessionToken = meta('stellwerk-session');
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
const answers = byId<HTMLUListElement>('answers');
const answersSection = byId('answers-section');
const pulls = byId<HTMLUListElement>('pulls');
const pullsSection = byId('pulls-section');
const githubState = byId('github-state');
const hardwareSection = byId('hardware');
const gauges = byId('gauges');
const hardwareState = byId('hardware-state');
const plansNode = byId('plans');
const waitingCount = byId('waiting-count');
const waitingList = byId('waiting-list');
const waitingEmpty = byId('waiting-empty');
const clockNode = byId('clock');
const hubNode = byId('hub-state');
const lastEvent = byId('last-event');
const toastNode = byId('toast');

let state: StateMessage | null = null;
/** The hub's clock minus ours; both run on the same machine, so this stays near zero. */
let clockOffset = 0;
let socket: WebSocket | null = null;
let connected = false;
let attempts = 0;
let toastTimer: number | undefined;
let audio: AudioContext | null = null;

byId('all-clear-icon').append(icon('check-circle'));

function connect(): void {
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
  tick();
  return added;
}

/** Everything that changes with time alone. */
function tick(): void {
  const now = Date.now() + clockOffset;
  queue.tick(now);
  const sessions = state?.sessions ?? [];
  renderAgents(agents, sessions, now, texts);
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
  const below = waitingList.scrollHeight - waitingList.scrollTop - waitingList.clientHeight;
  waitingList.classList.toggle('waiting--more', below > 4);
  clockNode.textContent = clock(now);
  show(hubNode, hubState(connected, texts));
  const last = state?.hub.lastEventAt ?? null;
  lastEvent.textContent = last === null ? texts.noEvent : texts.lastEvent(ago(now - last, texts));
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
}

/**
 * Puts plain text, a state (as a label with its icon) or a problem (as an alert that says how to fix it)
 * into a line of the status column, when it changed.
 */
function show(node: HTMLElement, content: string | State | Problem): void {
  const key = JSON.stringify(content);
  if (node.dataset.shown === key) return;
  node.dataset.shown = key;
  node.replaceChildren(typeof content === 'string' ? content : 'fix' in content ? alert(content) : label(content));
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
