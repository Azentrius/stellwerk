// The calendars and task lists on the display's second page. Every few minutes the hub asks each link set
// up with `stellwerk calendar add` (a calendar's subscription link from Outlook, Google, Nextcloud or
// iCloud, or the export of a Nextcloud task list, with an app password), and nothing else: GET only, https
// only, no redirects, at most 2 MB. It keeps of each event its title and times and of each open task its
// title, due date and priority (ics.ts); places, descriptions and people stay out. The links are secrets
// like a token: never logged, never sent to the display. A failed question keeps what the calendar gave
// before and says why in the log.
//
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import type { CalendarProblem, CalendarView, EventView, TaskView } from '../shared/protocol.js';
import { readCalendar, type IcsEvent, type IcsTask } from './ics.ts';

const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_CALENDAR_BYTES = 2 * 1024 * 1024;
/** The display shows today and the next six days. */
export const CALENDAR_DAYS = 7;
/** At most this many events and tasks go to the display. */
const MAX_SHOWN = 100;

/** A calendar's name on the display and in the log: letters, digits, spaces and a few signs. */
export const CALENDAR_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

/** A calendar or task list as set up: its link, and for a Nextcloud list a user and an app password. */
export const calendarSource = z.strictObject({
  name: z.string().regex(CALENDAR_NAME),
  url: z.string().max(2000).refine((value) => calendarAddress(value) === value, 'an https link without user or password'),
  user: z.string().min(1).max(200).optional(),
  password: z.string().min(1).max(500).optional(),
});
export type CalendarSource = z.infer<typeof calendarSource>;

/**
 * A calendar's link as the hub keeps it: https (a webcal link becomes one), with a host and no user,
 * password or fragment in it. Null for anything else.
 */
export function calendarAddress(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) return null;
  return url.toString();
}

/** Midnight today on this computer, and the same days later: the window of the display. */
export function calendarWindow(now: number): { from: number; to: number } {
  const today = new Date(now);
  return {
    from: new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime(),
    to: new Date(today.getFullYear(), today.getMonth(), today.getDate() + CALENDAR_DAYS).getTime(),
  };
}

class CalendarFailure extends Error {
  readonly problem: CalendarProblem;
  /** For the log: how the question failed; never the link. */
  readonly detail: string;
  constructor(problem: CalendarProblem, detail: string) {
    super(problem);
    this.problem = problem;
    this.detail = detail;
  }
}

export interface CalendarWatcherOptions {
  sources: CalendarSource[];
  intervalMs: number;
  /** For tests; the global fetch otherwise. */
  fetch?: typeof fetch;
  now?: () => number;
  onChange?: () => void;
  log?: (line: string) => void;
}

interface Taken {
  events: IcsEvent[];
  tasks: IcsTask[];
}

export class CalendarWatcher {
  updatedAt: number | null = null;
  private readonly options: CalendarWatcherOptions;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;
  /** What each calendar gave at its last answer, by name. */
  private readonly taken = new Map<string, Taken>();
  private readonly problems = new Map<string, CalendarProblem>();
  /** What the log last said of each calendar's zones and rules it does not know, so it says it once. */
  private readonly noted = new Map<string, string>();

  constructor(options: CalendarWatcherOptions) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The problem of each calendar whose last question failed, by name. */
  problemOf(name: string): CalendarProblem | null {
    return this.problems.get(name) ?? null;
  }

  /** The events of today and the next six days, and the open tasks, of all calendars together. */
  view(): CalendarView {
    const now = this.now();
    const window = calendarWindow(now);
    const events: EventView[] = [];
    const tasks: TaskView[] = [];
    for (const source of this.options.sources) {
      const taken = this.taken.get(source.name);
      if (!taken) continue;
      for (const event of taken.events) {
        if (event.start < window.to && (event.end > window.from || (event.end === event.start && event.start >= window.from))) {
          events.push({ source: source.name, ...event });
        }
      }
      for (const task of taken.tasks) tasks.push({ source: source.name, ...task });
    }
    events.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.end - b.end || a.title.localeCompare(b.title));
    // Overdue first, then by due date (an all-day one is due until the end of its day), those without one last.
    const dueBy = (task: TaskView) => (task.due === null ? Infinity : task.dueAllDay ? task.due + 86_400_000 - 1 : task.due);
    tasks.sort((a, b) => dueBy(a) - dueBy(b) || (a.priority ?? 10) - (b.priority ?? 10) || a.title.localeCompare(b.title));
    return {
      events: events.slice(0, MAX_SHOWN),
      tasks: tasks.slice(0, MAX_SHOWN),
      updatedAt: this.updatedAt,
      problems: this.options.sources.flatMap((source) => {
        const problem = this.problems.get(source.name);
        return problem ? [{ source: source.name, problem }] : [];
      }),
    };
  }

  /** One round over all calendars; a round still running is not started twice. */
  poll(): Promise<void> {
    this.polling ??= this.round().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async round(): Promise<void> {
    const window = calendarWindow(this.now());
    // The window reaches a day back, so an event that began yesterday and runs into today is there.
    const asked = { from: window.from - 86_400_000, to: window.to };
    await Promise.all(this.options.sources.map((source) => this.ask(source, asked)));
    this.options.onChange?.();
  }

  private async ask(source: CalendarSource, window: { from: number; to: number }): Promise<void> {
    const before = this.problems.get(source.name) ?? null;
    const label = `Calendar "${source.name}"`;
    try {
      const calendar = readCalendar(await this.download(source), window);
      if (!calendar) throw new CalendarFailure('unexpected', 'the link gave no complete iCalendar.');
      this.taken.set(source.name, { events: calendar.events, tasks: calendar.tasks });
      this.problems.delete(source.name);
      this.updatedAt = this.now();
      if (before !== null) this.options.log?.(`${label} answers again.`);
      const unknown = [
        ...(calendar.unknownZones.length > 0 ? [`time zones it does not know, taken as this computer's: ${calendar.unknownZones.join(', ')}`] : []),
        ...(calendar.unknownRules > 0 ? [`${calendar.unknownRules} repetition(s) it does not follow, shown once at their start`] : []),
      ].join('; ');
      if (unknown !== (this.noted.get(source.name) ?? '')) {
        if (unknown) this.options.log?.(`${label}: ${unknown}.`);
        this.noted.set(source.name, unknown);
      }
    } catch (err) {
      const failure = err instanceof CalendarFailure ? err : new CalendarFailure('unreachable', 'got no answer.');
      this.problems.set(source.name, failure.problem);
      // Once per new problem, not every round.
      if (failure.problem !== before) this.options.log?.(`${label}: ${describeCalendarProblem(failure.problem)} The link ${failure.detail}`);
    }
  }

  /** The calendar's text, at most MAX_CALENDAR_BYTES of it. */
  private async download(source: CalendarSource): Promise<string> {
    const headers: Record<string, string> = { Accept: 'text/calendar', 'User-Agent': 'stellwerk' };
    if (source.user !== undefined && source.password !== undefined) {
      headers.Authorization = `Basic ${Buffer.from(`${source.user}:${source.password}`).toString('base64')}`;
    }
    let response: Response;
    try {
      response = await this.fetch(source.url, { headers, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new CalendarFailure('unreachable', `${noAnswer(err)}.`);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const problem: CalendarProblem = response.status === 401 || response.status === 403 ? 'rejected' : response.status === 404 || response.status === 410 ? 'not-found' : 'unexpected';
      throw new CalendarFailure(problem, `answered ${response.status}.`);
    }
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_CALENDAR_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new CalendarFailure('unexpected', `gave more than ${MAX_CALENDAR_BYTES / 1024 / 1024} MB.`);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of response.body ?? []) {
        size += chunk.byteLength;
        if (size > MAX_CALENDAR_BYTES) throw new CalendarFailure('unexpected', `gave more than ${MAX_CALENDAR_BYTES / 1024 / 1024} MB.`);
        chunks.push(chunk);
      }
    } catch (err) {
      if (err instanceof CalendarFailure) throw err;
      throw new CalendarFailure('unreachable', `${noAnswer(err)}.`);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

/** How a question got no answer: its time ran out, or the error code of the connection, if there is one. */
function noAnswer(err: unknown): string {
  if ((err as { name?: unknown } | null)?.name === 'TimeoutError') return `timed out after ${REQUEST_TIMEOUT_MS / 1000} s`;
  const code = ((err as { cause?: unknown } | null)?.cause as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? `got no answer (${code})` : 'got no answer';
}

export function describeCalendarProblem(problem: CalendarProblem): string {
  switch (problem) {
    case 'rejected':
      return 'the link or the app password was turned down. Set the calendar up again with "stellwerk calendar add".';
    case 'not-found':
      return 'the link leads nowhere (any more). Set the calendar up again with "stellwerk calendar add".';
    case 'unreachable':
      return 'the calendar does not answer.';
    case 'unexpected':
      return 'the answer was no calendar Stellwerk can read.';
  }
}
