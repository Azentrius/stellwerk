// Every text of the display, in English and German. The language follows the system (the browser's
// languages): German if it comes first, English otherwise.
//
// SPDX-License-Identifier: Apache-2.0

import type {
  ChecksState,
  GitHubProblem,
  HardwareProblem,
  OpenedIn,
  PermissionOutcome,
  Provider,
  RejectionReason,
  SessionStatus,
  UptimeKumaProblem,
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
  /** The column of Uptime Kuma's monitors. */
  monitorsTitle: string;
  monitorStatus: { down: string; pending: string };
  /** The monitors that do not fail, as numbers only: "35 up", "1 in maintenance". */
  monitorsUp: (n: number) => string;
  monitorsMaintenance: (n: number) => string;
  monitorsNone: string;
  uptimeKuma: {
    asking: string;
    synced: (ago: string) => string;
    problem: Record<UptimeKumaProblem, string>;
    fix: Record<UptimeKumaProblem, string>;
  };
  /** The title over a provider's limits: "Codex plan usage". */
  planTitle: (provider: string) => string;
  /** A limit's window by its length in minutes: "5 h", "Week". */
  planWindow: (minutes: number) => string;
  /** When a limit's window starts again: "until 14:20", "until Fri". */
  resets: (at: string) => string;
  /** The day of the week, short. */
  weekday: (ms: number) => string;
  /** A number with the given decimals, in the language's way. */
  number: (n: number, decimals: number) => string;
  allow: string;
  deny: string;
  inApp: string;
  /** The same for a session of Codex' command line, whose own card shows in its terminal. */
  inTerminal: string;
  outcome: Record<PermissionOutcome, string>;
  hubConnected: string;
  hubDisconnected: string;
  hubDisconnectedFix: string;
  /** Requests the hub turned away: how many, and when and why the last; the reason never quotes a request. */
  rejected: {
    title: (count: number) => string;
    detail: (ago: string, reason: string) => string;
    reasons: Record<RejectionReason, string>;
  };
  /** The raw hook log is on. */
  rawLog: { title: string; fix: string };
  newRelease: { title: (version: string) => string; fix: (version: string) => string };
  /** The display was opened without its start file. */
  notSignedIn: string;
  notSignedInFix: string;
  lastEvent: (ago: string) => string;
  noEvent: string;
  ago: (n: number, unit: TimeUnit) => string;
  justNow: string;
  subagents: (n: number) => string;
  /** The line behind which the sessions at rest wait, closed and open. */
  restingMore: (n: number) => string;
  decisionsTitle: (n: number) => string;
  /** A session's details, opened by a tap on it. */
  details: {
    folder: string;
    model: string;
    context: string;
    contextOf: (usedK: string, sizeK: string, percent: string) => string;
    subagents: string;
    lastTool: string;
    session: string;
    unknown: string;
    none: string;
  };
  /** How a request ended, shortly, for the list of the last decisions. */
  decided: Record<PermissionOutcome, string>;
  restingHide: (n: number) => string;
  /** Whose agent a session is, shown for every session alike. */
  providers: Record<Provider, string>;
  /** Codex' command line, in place of the provider's name. */
  codexCli: string;
  /** A moment ago, short (with the provider, in place of "just now"). */
  now: string;
  /** The context ring of an agent: how full, as its name and tooltip; or not known yet. */
  context: (percent: string) => string;
  contextUnknown: string;
  alreadyDecided: string;
  notOpen: string;
  /** The button in a session's details that opens it in its app ("Claude", "Codex"). */
  openIn: (app: string) => string;
  /** A tap on a pull request opens it in the browser: its tooltip. */
  openPull: string;
  /** Opening did not work: there is nothing to open for it any more, or the shell failed. */
  openUnknown: string;
  openFailed: string;
  /** Said at once after a tap that opens something, while the app takes its time. */
  opening: Record<OpenedIn, string>;
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
    unknown: 'Unknown',
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
      'too-many': 'GitHub: too many results',
    },
    fix: {
      rejected: 'Create a new token and run `stellwerk github token`.',
      forbidden: 'The token needs "Pull requests: Read" and "Actions: Read". If only the rate limit is reached, it goes on by itself.',
      'not-found': 'Check the name and set the token again: `stellwerk github token --owner NAME`.',
      unreachable: 'Check the internet connection; the hub asks again by itself.',
      unexpected: 'The hub asks again by itself. If it stays, see `hub.log`.',
      'too-many': 'A list has more than 1000 entries; Stellwerk shows none rather than an incomplete one. Give the token fewer repositories.',
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
  monitorsTitle: 'Monitoring',
  monitorStatus: { down: 'Down', pending: 'Retrying' },
  monitorsUp: (n) => `${n} up`,
  monitorsMaintenance: (n) => `${n} in maintenance`,
  monitorsNone: 'No monitors reported.',
  uptimeKuma: {
    asking: 'Uptime Kuma: asking',
    synced: (ago) => `Uptime Kuma: updated ${ago}`,
    problem: {
      unreachable: 'Uptime Kuma: not reachable',
      rejected: 'Uptime Kuma: key rejected',
      unexpected: 'Uptime Kuma: unexpected answer',
    },
    fix: {
      unreachable: 'Check that Uptime Kuma runs at its address; the hub asks again by itself.',
      rejected: 'Create a new API key in Uptime Kuma and run `stellwerk kuma key`.',
      unexpected: 'Check the address and set it again: `stellwerk kuma key --url ADDRESS`.',
    },
  },
  planTitle: (provider) => `${provider} plan usage`,
  planWindow: (m) =>
    m === 10_080 ? 'Week' : m % 1440 === 0 ? (m === 1440 ? 'Day' : `${m / 1440} days`) : m < 60 ? `${m} min` : `${Math.round(m / 60)} h`,
  resets: (at) => `until ${at}`,
  weekday: (ms) => new Date(ms).toLocaleDateString('en', { weekday: 'short' }),
  number: (n, decimals) => n.toLocaleString('en', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  allow: 'Allow',
  deny: 'Deny',
  inApp: 'In the app',
  inTerminal: 'In the terminal',
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
  rejected: {
    title: (n) => (n === 1 ? '1 request turned away' : `${n} requests turned away`),
    detail: (ago, reason) => `The last one ${ago}: ${reason}.` + ' More in `hub.log`.',
    reasons: {
      token: 'missing or wrong token',
      'hook-data': 'hook data the hub could not take',
      foreign: 'a request from elsewhere (host, origin or address)',
      display: 'a display not signed in, or a broken display connection',
    },
  },
  rawLog: {
    title: 'Raw hook log is on',
    fix: 'It holds prompts and code. Set `debugRawLog` to false in `config.json` (or start without `--debug-raw`), restart the hub and run `stellwerk raw-log delete`.',
  },
  newRelease: {
    title: (version) => `Stellwerk ${version} is out`,
    fix: (version) => `Download \`stellwerk-${version}.zip\` and \`SHA256SUMS\` from its release on GitHub, then run \`stellwerk update stellwerk-${version}.zip\`.`,
  },
  notSignedIn: 'Display not signed in',
  notSignedInFix: 'Open it with its start file, `display.html` in `%LOCALAPPDATA%\\stellwerk`, or start the task "Stellwerk display" again.',
  lastEvent: (ago) => `last event ${ago}`,
  noEvent: 'no event yet',
  ago: (n, unit) => `${n} ${unit} ago`,
  justNow: 'just now',
  subagents: (n) => (n === 1 ? '1 subagent' : `${n} subagents`),
  restingMore: (n) => `${n} more at rest`,
  decisionsTitle: (n) => (n === 1 ? 'The last decision' : `The last ${n} decisions`),
  details: {
    folder: 'Folder',
    model: 'Model',
    context: 'Context',
    contextOf: (used, size, percent) => `${used}k of ${size}k (${percent} %)`,
    subagents: 'Subagents',
    lastTool: 'Last tool',
    session: 'Session',
    unknown: 'not known',
    none: 'none yet',
  },
  decided: {
    allowed: 'Allowed',
    denied: 'Denied',
    'handed-to-app': 'To the app',
    'decided-in-app': 'In the app',
    aborted: 'Cancelled',
    'timed-out': 'Time up',
  },
  restingHide: (n) => (n === 1 ? 'Hide the one at rest' : `Hide the ${n} at rest`),
  providers: { claude: 'Claude', codex: 'Codex' },
  codexCli: 'Codex CLI',
  now: 'now',
  context: (percent) => `Context ${percent} used`,
  contextUnknown: 'Context not known yet',
  alreadyDecided: 'Already decided.',
  notOpen: 'This request is no longer open.',
  openIn: (app) => `Open in ${app}`,
  openPull: 'Open in the browser',
  openUnknown: 'There is nothing to open for it.',
  openFailed: 'It could not be opened.',
  opening: { claude: 'Opening in Claude …', codex: 'Opening in Codex …', browser: 'Opening in the browser …' },
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
    unknown: 'Unbekannt',
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
      'too-many': 'GitHub: zu viele Ergebnisse',
    },
    fix: {
      rejected: 'Lege einen neuen Token an und führe `stellwerk github token` aus.',
      forbidden: 'Der Token braucht „Pull requests: Read“ und „Actions: Read“. Ist nur das Limit erreicht, geht es von selbst weiter.',
      'not-found': 'Prüfe den Namen und lege den Token neu an: `stellwerk github token --owner NAME`.',
      unreachable: 'Prüfe die Internetverbindung; der Hub fragt von selbst wieder.',
      unexpected: 'Der Hub fragt von selbst wieder. Bleibt es so, steht mehr in `hub.log`.',
      'too-many': 'Eine Liste hat mehr als 1000 Einträge; Stellwerk zeigt sie lieber gar nicht als unvollständig. Gib dem Token weniger Repositories.',
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
  monitorsTitle: 'Überwachung',
  monitorStatus: { down: 'Ausgefallen', pending: 'Prüft erneut' },
  monitorsUp: (n) => `${n} in Ordnung`,
  monitorsMaintenance: (n) => `${n} in Wartung`,
  monitorsNone: 'Noch keine Monitore gemeldet.',
  uptimeKuma: {
    asking: 'Uptime Kuma: wird abgefragt',
    synced: (ago) => `Uptime Kuma: aktualisiert ${ago}`,
    problem: {
      unreachable: 'Uptime Kuma: nicht erreichbar',
      rejected: 'Uptime Kuma: Schlüssel abgelehnt',
      unexpected: 'Uptime Kuma: unerwartete Antwort',
    },
    fix: {
      unreachable: 'Prüfe, ob Uptime Kuma unter seiner Adresse läuft; der Hub fragt von selbst wieder.',
      rejected: 'Lege in Uptime Kuma einen neuen API-Schlüssel an und führe `stellwerk kuma key` aus.',
      unexpected: 'Prüfe die Adresse und setze sie neu: `stellwerk kuma key --url ADRESSE`.',
    },
  },
  planTitle: (provider) => `Abo-Nutzung ${provider}`,
  planWindow: (m) =>
    m === 10_080 ? 'Woche' : m % 1440 === 0 ? (m === 1440 ? 'Tag' : `${m / 1440} Tage`) : m < 60 ? `${m} min` : `${Math.round(m / 60)} h`,
  resets: (at) => `bis ${at}`,
  weekday: (ms) => new Date(ms).toLocaleDateString('de', { weekday: 'short' }),
  number: (n, decimals) => n.toLocaleString('de', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  allow: 'Erlauben',
  deny: 'Ablehnen',
  inApp: 'In der App',
  inTerminal: 'Im Terminal',
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
  rejected: {
    title: (n) => (n === 1 ? '1 Anfrage abgelehnt' : `${n} Anfragen abgelehnt`),
    detail: (ago, reason) => `Zuletzt ${ago}: ${reason}.` + ' Mehr in `hub.log`.',
    reasons: {
      token: 'Token fehlt oder ist falsch',
      'hook-data': 'Hook-Daten, die der Hub nicht annehmen konnte',
      foreign: 'eine Anfrage von außerhalb (Host, Herkunft oder Adresse)',
      display: 'eine Anzeige ohne Anmeldung oder eine abgebrochene Verbindung',
    },
  },
  rawLog: {
    title: 'Rohprotokoll ist an',
    fix: 'Es enthält Prompts und Code. Setze `debugRawLog` in `config.json` auf false (oder starte ohne `--debug-raw`), starte den Hub neu und führe `stellwerk raw-log delete` aus.',
  },
  newRelease: {
    title: (version) => `Stellwerk ${version} ist da`,
    fix: (version) => `Lade \`stellwerk-${version}.zip\` und \`SHA256SUMS\` aus dem Release auf GitHub und führe \`stellwerk update stellwerk-${version}.zip\` aus.`,
  },
  notSignedIn: 'Anzeige nicht angemeldet',
  notSignedInFix: 'Öffne sie über ihre Startdatei, `display.html` in `%LOCALAPPDATA%\\stellwerk`, oder starte die Aufgabe „Stellwerk display“ neu.',
  lastEvent: (ago) => `letztes Ereignis ${ago}`,
  noEvent: 'noch kein Ereignis',
  ago: (n, unit) => `vor ${n} ${unit}`,
  justNow: 'gerade eben',
  subagents: (n) => (n === 1 ? '1 Subagent' : `${n} Subagenten`),
  restingMore: (n) => (n === 1 ? '1 weitere ruht' : `${n} weitere ruhen`),
  decisionsTitle: (n) => (n === 1 ? 'Die letzte Entscheidung' : `Die letzten ${n} Entscheidungen`),
  details: {
    folder: 'Ordner',
    model: 'Modell',
    context: 'Kontext',
    contextOf: (used, size, percent) => `${used}k von ${size}k (${percent} %)`,
    subagents: 'Subagenten',
    lastTool: 'Zuletzt',
    session: 'Sitzung',
    unknown: 'unbekannt',
    none: 'noch keins',
  },
  decided: {
    allowed: 'Erlaubt',
    denied: 'Abgelehnt',
    'handed-to-app': 'An die App',
    'decided-in-app': 'In der App',
    aborted: 'Abgebrochen',
    'timed-out': 'Zeit abgelaufen',
  },
  restingHide: (n) => (n === 1 ? 'Ruhende ausblenden' : `${n} ruhende ausblenden`),
  providers: { claude: 'Claude', codex: 'Codex' },
  codexCli: 'Codex CLI',
  now: 'jetzt',
  context: (percent) => `Kontext ${percent} genutzt`,
  contextUnknown: 'Kontext noch unbekannt',
  alreadyDecided: 'Bereits entschieden.',
  notOpen: 'Diese Anfrage ist nicht mehr offen.',
  openIn: (app) => `In ${app} öffnen`,
  openPull: 'Im Browser öffnen',
  openUnknown: 'Dafür gibt es nichts zu öffnen.',
  openFailed: 'Ließ sich nicht öffnen.',
  opening: { claude: 'Öffnet in Claude …', codex: 'Öffnet in Codex …', browser: 'Öffnet im Browser …' },
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
