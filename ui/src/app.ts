// Stellwerk's display: connects to the hub, shows the sessions, what waits for the user (permission
// requests, answers due in the app) and the hub's state, and sends decisions. Everything goes over the one
// WebSocket to the hub that served the page.
//
// SPDX-License-Identifier: Apache-2.0

import type { Decision, ServerMessage, StateMessage } from '../../src/shared/protocol.js';
import { renderAgents } from './agents.ts';
import { renderAnswers, waitingForAnswer } from './answers.ts';
import { byId } from './dom.ts';
import { pickTexts } from './i18n.ts';
import { QueueView } from './queue.ts';
import { ago, clock } from './time.ts';

const WS_PROTOCOL = 'stellwerk.v1';
const WS_SESSION_PREFIX = 'stellwerk.session.';
const TOAST_MS = 3000;

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
const sessionToken = meta('stellwerk-session');
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
const waitingCount = byId('waiting-count');
const waitingList = byId('waiting-list');
const waitingEmpty = byId('waiting-empty');
const clockNode = byId('clock');
const hubState = byId('hub-state');
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
    clockOffset = message.now - Date.now();
    state = message;
    const added = render();
    if (added.length > 0 && message.hub.sound) chime();
  } else if (message.type === 'decision-result' && !message.ok) {
    queue.release(message.id);
    toast(message.reason === 'already-decided' ? texts.alreadyDecided : texts.notOpen);
  }
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
  const waiting = queue.openCount() + due.length;
  waitingCount.textContent = waiting > 0 ? `(${waiting})` : '';
  const nothing = (state?.permissions.length ?? 0) === 0 && due.length === 0;
  waitingEmpty.hidden = !nothing;
  waitingList.hidden = nothing;
  const below = waitingList.scrollHeight - waitingList.scrollTop - waitingList.clientHeight;
  waitingList.classList.toggle('waiting--more', below > 4);
  clockNode.textContent = clock(now);
  hubState.textContent = connected ? texts.hubConnected : texts.hubDisconnected;
  hubState.classList.toggle('hub-state--down', !connected);
  const last = state?.hub.lastEventAt ?? null;
  lastEvent.textContent = last === null ? texts.noEvent : texts.lastEvent(ago(now - last, texts));
}

function toast(text: string): void {
  toastNode.textContent = text;
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
