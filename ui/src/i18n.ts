// Every text of the display, in English and German. The language follows the system (the browser's
// languages): German if it comes first, English otherwise.
//
// SPDX-License-Identifier: Apache-2.0

import type {
  ChecksState,
  GitHubProblem,
  HardwareProblem,
  PermissionOutcome,
  SessionStatus,
  WaitingFor,
} from '../../src/shared/protocol.js';

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
  pullsTitle: string;
  draft: string;
  checks: Record<ChecksState, string>;
  /** A problem says what happened; its fix says how to fix it, commands in backticks. */
  github: {
    asking: string;
    synced: (ago: string) => string;
    problem: Record<GitHubProblem, string>;
    fix: Record<GitHubProblem, string>;
  };
  hardwareTitle: string;
  parts: { cpu: string; gpu: string; memory: string };
  hardware: { asking: string; problem: Record<HardwareProblem, string>; fix: Record<HardwareProblem, string> };
  /** A number with the given decimals, in the language's way. */
  number: (n: number, decimals: number) => string;
  allow: string;
  deny: string;
  inApp: string;
  outcome: Record<PermissionOutcome, string>;
  hubConnected: string;
  hubDisconnected: string;
  hubDisconnectedFix: string;
  lastEvent: (ago: string) => string;
  noEvent: string;
  ago: (n: number, unit: TimeUnit) => string;
  justNow: string;
  subagents: (n: number) => string;
  /** The context ring of an agent: how full, as its name and tooltip; or not known yet. */
  context: (percent: string) => string;
  contextUnknown: string;
  alreadyDecided: string;
  notOpen: string;
  command: string;
  file: string;
  change: string;
  changes: (n: number) => string;
  /** The old and the new text of a change. */
  before: string;
  after: string;
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
    permission: 'Waiting for approval',
    waiting: 'Waiting for you',
    working: 'Working',
    done: 'Done',
    ended: 'Ended',
  },
  waitingFor: {
    question: 'Question',
    input: 'Needs input',
    permission: 'Permission',
  },
  since: (d) => `for ${d}`,
  pullsTitle: 'Open pull requests',
  draft: 'draft',
  checks: { passing: 'Checks passed', failing: 'Checks failed', pending: 'Checks running', none: 'No checks' },
  github: {
    asking: 'GitHub: asking',
    synced: (ago) => `GitHub: updated ${ago}`,
    problem: {
      rejected: 'GitHub: token rejected',
      forbidden: 'GitHub: no access',
      'not-found': 'GitHub: owner not found',
      unreachable: 'GitHub: not reachable',
      unexpected: 'GitHub: unexpected answer',
    },
    fix: {
      rejected: 'Create a new token and run `stellwerk github token`.',
      forbidden: 'The token needs "Pull requests: Read" and "Actions: Read". If only the rate limit is reached, it goes on by itself.',
      'not-found': 'Check the name and set the token again: `stellwerk github token --owner NAME`.',
      unreachable: 'Check the internet connection; the hub asks again by itself.',
      unexpected: 'The hub asks again by itself. If it stays, see `hub.log`.',
    },
  },
  hardwareTitle: 'Hardware',
  parts: { cpu: 'CPU', gpu: 'GPU', memory: 'RAM' },
  hardware: {
    asking: 'Hardware: asking',
    problem: {
      'not-running': 'Hardware: monitor not running',
      rejected: 'Hardware: password rejected',
      unexpected: 'Hardware: unexpected answer',
    },
    fix: {
      'not-running': 'Start the task "Stellwerk hardware" or sign in again.',
      rejected: 'Run `stellwerk hardware install` again as administrator.',
      unexpected: 'Run `stellwerk hardware install` again as administrator.',
    },
  },
  number: (n, decimals) => n.toLocaleString('en', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
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
  hubDisconnectedFix: 'If it does not come back, start the task "Stellwerk hub" and reload the display.',
  lastEvent: (ago) => `last event ${ago}`,
  noEvent: 'no event yet',
  ago: (n, unit) => `${n} ${unit} ago`,
  justNow: 'just now',
  subagents: (n) => (n === 1 ? '1 subagent' : `${n} subagents`),
  context: (percent) => `Context ${percent} used`,
  contextUnknown: 'Context not known yet',
  alreadyDecided: 'Already decided.',
  notOpen: 'This request is no longer open.',
  command: 'Command',
  file: 'File',
  change: 'Change',
  changes: (n) => (n === 1 ? '1 change' : `${n} changes`),
  before: 'Before',
  after: 'After',
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
    permission: 'Wartet auf Freigabe',
    waiting: 'Wartet auf dich',
    working: 'Arbeitet',
    done: 'Fertig',
    ended: 'Beendet',
  },
  waitingFor: {
    question: 'Rückfrage',
    input: 'Braucht eine Eingabe',
    permission: 'Freigabe',
  },
  since: (d) => `seit ${d}`,
  pullsTitle: 'Offene Pull Requests',
  draft: 'Entwurf',
  checks: { passing: 'Checks bestanden', failing: 'Checks fehlgeschlagen', pending: 'Checks laufen', none: 'Keine Checks' },
  github: {
    asking: 'GitHub: wird abgefragt',
    synced: (ago) => `GitHub: aktualisiert ${ago}`,
    problem: {
      rejected: 'GitHub: Token abgelehnt',
      forbidden: 'GitHub: kein Zugriff',
      'not-found': 'GitHub: Besitzer nicht gefunden',
      unreachable: 'GitHub: nicht erreichbar',
      unexpected: 'GitHub: unerwartete Antwort',
    },
    fix: {
      rejected: 'Lege einen neuen Token an und führe `stellwerk github token` aus.',
      forbidden: 'Der Token braucht „Pull requests: Read“ und „Actions: Read“. Ist nur das Limit erreicht, geht es von selbst weiter.',
      'not-found': 'Prüfe den Namen und lege den Token neu an: `stellwerk github token --owner NAME`.',
      unreachable: 'Prüfe die Internetverbindung; der Hub fragt von selbst wieder.',
      unexpected: 'Der Hub fragt von selbst wieder. Bleibt es so, steht mehr in `hub.log`.',
    },
  },
  hardwareTitle: 'Hardware',
  parts: { cpu: 'CPU', gpu: 'GPU', memory: 'RAM' },
  hardware: {
    asking: 'Hardware: wird abgefragt',
    problem: {
      'not-running': 'Hardware: Monitor läuft nicht',
      rejected: 'Hardware: Passwort abgelehnt',
      unexpected: 'Hardware: unerwartete Antwort',
    },
    fix: {
      'not-running': 'Starte die Aufgabe „Stellwerk hardware“ oder melde dich neu an.',
      rejected: 'Führe `stellwerk hardware install` als Administrator erneut aus.',
      unexpected: 'Führe `stellwerk hardware install` als Administrator erneut aus.',
    },
  },
  number: (n, decimals) => n.toLocaleString('de', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
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
  hubDisconnectedFix: 'Kommt er nicht zurück, starte die Aufgabe „Stellwerk hub“ und lade die Anzeige neu.',
  lastEvent: (ago) => `letztes Ereignis ${ago}`,
  noEvent: 'noch kein Ereignis',
  ago: (n, unit) => `vor ${n} ${unit}`,
  justNow: 'gerade eben',
  subagents: (n) => (n === 1 ? '1 Subagent' : `${n} Subagenten`),
  context: (percent) => `Kontext ${percent} genutzt`,
  contextUnknown: 'Kontext noch unbekannt',
  alreadyDecided: 'Bereits entschieden.',
  notOpen: 'Diese Anfrage ist nicht mehr offen.',
  command: 'Befehl',
  file: 'Datei',
  change: 'Änderung',
  changes: (n) => (n === 1 ? '1 Änderung' : `${n} Änderungen`),
  before: 'Vorher',
  after: 'Nachher',
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
