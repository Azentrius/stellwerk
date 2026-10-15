// Every text of the display, in English and German. The language follows the system (the browser's
// languages): German if it comes first, English otherwise.
//
// SPDX-License-Identifier: Apache-2.0

import type { PermissionOutcome, SessionStatus, WaitingFor } from '../../src/shared/protocol.js';

export type Lang = 'en' | 'de';
export type TimeUnit = 's' | 'min' | 'h';

export interface Texts {
  queueTitle: string;
  agentsTitle: string;
  answersTitle: string;
  allClear: string;
  noSessions: string;
  status: Record<SessionStatus, string>;
  /** Why a session waits for an answer in the app. */
  waitingFor: Record<Exclude<WaitingFor, 'idle'>, string>;
  since: (duration: string) => string;
  allow: string;
  deny: string;
  inApp: string;
  outcome: Record<PermissionOutcome, string>;
  hubConnected: string;
  hubDisconnected: string;
  lastEvent: (ago: string) => string;
  noEvent: string;
  ago: (n: number, unit: TimeUnit) => string;
  justNow: string;
  subagents: (n: number) => string;
  alreadyDecided: string;
  notOpen: string;
  command: string;
  file: string;
  change: string;
  changes: (n: number) => string;
  content: string;
  replaceAll: string;
  server: string;
  tool: string;
  parameters: string;
  moreParameters: string;
  address: string;
  query: string;
}

const en: Texts = {
  queueTitle: 'Waiting for you',
  agentsTitle: 'Agents',
  answersTitle: 'Answer in the app',
  allClear: 'All signals clear.',
  noSessions: 'No session reported yet.',
  status: {
    permission: 'waiting for approval',
    waiting: 'waiting for you',
    working: 'working',
    done: 'done',
    ended: 'ended',
  },
  waitingFor: {
    question: 'Question',
    input: 'Needs input',
    permission: 'Permission',
  },
  since: (d) => `for ${d}`,
  allow: 'Allow',
  deny: 'Deny',
  inApp: 'In the app',
  outcome: {
    allowed: 'Allowed',
    denied: 'Denied',
    'handed-to-app': 'Handed to the app',
    'decided-in-app': 'Decided in the app',
    aborted: 'Cancelled',
    'timed-out': 'Time is up, continue in the app',
  },
  hubConnected: 'Hub connected',
  hubDisconnected: 'Hub disconnected, reconnecting',
  lastEvent: (ago) => `last event ${ago}`,
  noEvent: 'no event yet',
  ago: (n, unit) => `${n} ${unit} ago`,
  justNow: 'just now',
  subagents: (n) => (n === 1 ? '1 subagent' : `${n} subagents`),
  alreadyDecided: 'Already decided.',
  notOpen: 'This request is no longer open.',
  command: 'Command',
  file: 'File',
  change: 'Change',
  changes: (n) => (n === 1 ? '1 change' : `${n} changes`),
  content: 'Content',
  replaceAll: 'replaces every occurrence',
  server: 'Server',
  tool: 'Tool',
  parameters: 'Parameters',
  moreParameters: 'More parameters',
  address: 'Address',
  query: 'Search',
};

const de: Texts = {
  queueTitle: 'Wartet auf dich',
  agentsTitle: 'Agenten',
  answersTitle: 'In der App beantworten',
  allClear: 'Alle Signale auf Fahrt.',
  noSessions: 'Noch keine Sitzung gemeldet.',
  status: {
    permission: 'wartet auf Freigabe',
    waiting: 'wartet auf dich',
    working: 'arbeitet',
    done: 'fertig',
    ended: 'beendet',
  },
  waitingFor: {
    question: 'Rückfrage',
    input: 'braucht eine Eingabe',
    permission: 'Freigabe',
  },
  since: (d) => `seit ${d}`,
  allow: 'Erlauben',
  deny: 'Ablehnen',
  inApp: 'In der App',
  outcome: {
    allowed: 'Erlaubt',
    denied: 'Abgelehnt',
    'handed-to-app': 'An die App übergeben',
    'decided-in-app': 'In der App entschieden',
    aborted: 'Abgebrochen',
    'timed-out': 'Zeit abgelaufen, weiter in der App',
  },
  hubConnected: 'Hub verbunden',
  hubDisconnected: 'Hub getrennt, verbinde neu',
  lastEvent: (ago) => `letztes Ereignis ${ago}`,
  noEvent: 'noch kein Ereignis',
  ago: (n, unit) => `vor ${n} ${unit}`,
  justNow: 'gerade eben',
  subagents: (n) => (n === 1 ? '1 Subagent' : `${n} Subagenten`),
  alreadyDecided: 'Bereits entschieden.',
  notOpen: 'Diese Anfrage ist nicht mehr offen.',
  command: 'Befehl',
  file: 'Datei',
  change: 'Änderung',
  changes: (n) => (n === 1 ? '1 Änderung' : `${n} Änderungen`),
  content: 'Inhalt',
  replaceAll: 'ersetzt jedes Vorkommen',
  server: 'Server',
  tool: 'Werkzeug',
  parameters: 'Parameter',
  moreParameters: 'Weitere Parameter',
  address: 'Adresse',
  query: 'Suche',
};

export function pickTexts(languages: readonly string[]): { lang: Lang; texts: Texts } {
  const first = (languages[0] ?? 'en').toLowerCase();
  return first.startsWith('de') ? { lang: 'de', texts: de } : { lang: 'en', texts: en };
}
