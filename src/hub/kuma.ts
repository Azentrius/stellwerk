// The monitors of Uptime Kuma on the display: which fail, and how many are up. Every minute the hub asks
// the address set up with `stellwerk kuma key` for /metrics, with the API key as the password (Uptime
// Kuma's API keys can read the metrics and nothing else), and keeps of each monitor only its name and
// status. It asks for nothing else there and changes nothing.
//
// SPDX-License-Identifier: Apache-2.0

import type { FailingMonitor, MonitorCounts, UptimeKumaProblem, UptimeKumaView } from '../shared/protocol.js';

export const KUMA_METRICS_PATH = '/metrics';
const REQUEST_TIMEOUT_MS = 5000;
const MAX_ANSWER_BYTES = 4 * 1024 * 1024;
/** Longer names are cut; a name is set by hand in Uptime Kuma. */
const MAX_NAME = 200;

/** Uptime Kuma's monitor_status, by its value: 0 down, 1 up, 2 pending, 3 maintenance. */
const STATUSES = ['down', 'up', 'pending', 'maintenance'] as const;
export type MonitorStatus = (typeof STATUSES)[number];

export interface KumaMonitor {
  id: string;
  name: string;
  status: MonitorStatus;
}

// ---------- /metrics ----------

/**
 * The monitors in Uptime Kuma's /metrics, from the lines of `monitor_status`; null when the text is not
 * Uptime Kuma's metrics. Group monitors only sum up others and are left out; paused monitors are not in
 * the metrics at all. Of the labels only id, name and type are looked at.
 */
export function readMonitors(text: string): KumaMonitor[] | null {
  if (!/^# TYPE monitor_status gauge\r?$/m.test(text)) return null;
  const byId = new Map<string, KumaMonitor>();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.startsWith('monitor_status{')) continue;
    const sample = parseSample(line.slice('monitor_status'.length));
    if (!sample) return null;
    const id = sample.labels.get('monitor_id');
    const name = sample.labels.get('monitor_name');
    if (id === undefined || name === undefined) return null;
    if (sample.labels.get('monitor_type') === 'group') continue;
    const status = Number.isInteger(sample.value) ? STATUSES[sample.value] : undefined;
    if (status === undefined) continue;
    byId.set(id, { id, name: name.length > MAX_NAME ? `${name.slice(0, MAX_NAME)}…` : name, status });
  }
  return [...byId.values()];
}

/**
 * The labels and the value of a sample in Prometheus' text format: `{a="b",c="d"} 1`, label values in
 * double quotes with `\\`, `\"` and `\n` escaped. Null for anything else.
 */
export function parseSample(rest: string): { labels: Map<string, string>; value: number } | null {
  const labels = new Map<string, string>();
  if (rest[0] !== '{') return null;
  let i = 1;
  while (rest[i] !== '}') {
    const name = /^[a-zA-Z_][a-zA-Z0-9_]*="/.exec(rest.slice(i));
    if (!name) return null;
    i += name[0].length;
    let value = '';
    for (;;) {
      const c = rest[i++];
      if (c === undefined) return null;
      if (c === '"') break;
      if (c !== '\\') {
        value += c;
        continue;
      }
      const escaped = rest[i++];
      if (escaped === 'n') value += '\n';
      else if (escaped === '\\' || escaped === '"') value += escaped;
      else return null;
    }
    labels.set(name[0].slice(0, -2), value);
    if (rest[i] === ',') i++;
    else if (rest[i] !== '}') return null;
  }
  const [field] = rest.slice(i + 1).trim().split(/\s+/);
  const value = field ? Number(field) : NaN;
  return Number.isNaN(value) ? null : { labels, value };
}

// ---------- asking ----------

class KumaFailure extends Error {
  readonly problem: UptimeKumaProblem;
  constructor(problem: UptimeKumaProblem) {
    super(problem);
    this.problem = problem;
  }
}

export interface UptimeKumaWatcherOptions {
  /** Uptime Kuma's address, such as http://192.168.0.130:3001 (checked by the configuration). */
  url: string;
  /** An API key of Uptime Kuma ("uk1_…"), sent as the password; never logged. */
  key: string;
  intervalMs: number;
  /** For tests; the global fetch otherwise. */
  fetch?: typeof fetch;
  now?: () => number;
  onChange?: () => void;
  log?: (line: string) => void;
}

export class UptimeKumaWatcher {
  monitors: MonitorCounts | null = null;
  updatedAt: number | null = null;
  problem: UptimeKumaProblem | null = null;
  private readonly options: UptimeKumaWatcherOptions;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly authorization: string;
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;
  /** Each monitor's status and since when the hub sees it, by id. */
  private seen = new Map<string, { status: MonitorStatus; since: number | null }>();
  /** The last round got an answer: a change seen now happened since then. */
  private watching = false;

  constructor(options: UptimeKumaWatcherOptions) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    // Uptime Kuma takes an API key as the password of Basic authorization, whatever the user name.
    this.authorization = `Basic ${Buffer.from(`stellwerk:${options.key}`).toString('base64')}`;
  }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  view(): UptimeKumaView {
    return { monitors: this.monitors, updatedAt: this.updatedAt, problem: this.problem };
  }

  /** One round; a round still running is not started twice. */
  poll(): Promise<void> {
    this.polling ??= this.round().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async round(): Promise<void> {
    const problemBefore = this.problem;
    try {
      const response = await this.ask();
      if (!response.ok) {
        await response.body?.cancel();
        throw new KumaFailure(response.status === 401 ? 'rejected' : 'unexpected');
      }
      const body = await response.arrayBuffer();
      if (body.byteLength > MAX_ANSWER_BYTES) throw new KumaFailure('unexpected');
      const monitors = readMonitors(Buffer.from(body).toString('utf8'));
      if (!monitors) throw new KumaFailure('unexpected');
      this.monitors = this.count(monitors);
      this.updatedAt = this.now();
      this.problem = null;
      if (problemBefore !== null) this.options.log?.('Uptime Kuma answers again.');
    } catch (err) {
      this.monitors = null;
      this.watching = false;
      this.problem = err instanceof KumaFailure ? err.problem : 'unreachable';
      // Once per new problem, not every round.
      if (this.problem !== problemBefore) this.options.log?.(`Uptime Kuma ${describeUptimeKumaProblem(this.problem)}`);
    }
    // Every round: the display says when the monitors were last asked.
    this.options.onChange?.();
  }

  /**
   * Counts the monitors and notes since when each one is in its status. What was already so at the first
   * answer, or changed while Uptime Kuma did not answer, has no time: the hub did not see it change.
   */
  private count(monitors: KumaMonitor[]): MonitorCounts {
    const now = this.now();
    const seen = new Map<string, { status: MonitorStatus; since: number | null }>();
    for (const monitor of monitors) {
      const before = this.seen.get(monitor.id);
      seen.set(monitor.id, { status: monitor.status, since: before?.status === monitor.status ? before.since : this.watching ? now : null });
    }
    this.seen = seen;
    this.watching = true;
    const failing: FailingMonitor[] = [];
    for (const monitor of monitors) {
      if (monitor.status === 'down' || monitor.status === 'pending') {
        failing.push({ name: monitor.name, status: monitor.status, since: seen.get(monitor.id)!.since });
      }
    }
    // Down before pending; within each the most recent first, those without a time last, then by name.
    const rank = (m: FailingMonitor) => (m.status === 'down' ? 0 : 1);
    failing.sort((a, b) => rank(a) - rank(b) || (b.since ?? -Infinity) - (a.since ?? -Infinity) || a.name.localeCompare(b.name));
    return {
      failing,
      up: monitors.filter((m) => m.status === 'up').length,
      maintenance: monitors.filter((m) => m.status === 'maintenance').length,
    };
  }

  private ask(): Promise<Response> {
    return this.fetch(new URL(KUMA_METRICS_PATH, this.options.url), {
      headers: { Authorization: this.authorization, Accept: 'text/plain' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => {
      throw new KumaFailure('unreachable');
    });
  }
}

export function describeUptimeKumaProblem(problem: UptimeKumaProblem): string {
  switch (problem) {
    case 'unreachable':
      return 'does not answer at its address. Is it running?';
    case 'rejected':
      return 'turned the API key down (401). Create a new one and run "stellwerk kuma key".';
    case 'unexpected':
      return 'gave an unexpected answer for /metrics. Is the address right?';
  }
}
