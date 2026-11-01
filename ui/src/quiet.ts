// The display at rest: dimmed after a while with nothing new, so that it does not glow on the desk all
// day and night. An open request keeps it awake, since it goes back to the app when its hold time is up.
// Anything new wakes it: a request, an answer due in the app, a monitor that goes down, a pull request,
// checks that failed or a conflict, the hub gone away. So does a tap. The hub cannot dim the screen
// itself (it starts no programs); the display dims its own page. At night (the hours set up) it rests after a minute already
// and goes darker than by day, still readable; what wakes it by day wakes it at night too. Its tones are
// quieter then, or none, as set up.
//
// SPDX-License-Identifier: Apache-2.0

import type { NightSound, StateMessage } from '../../src/shared/protocol.js';
import { waitingForAnswer } from './due.ts';

/** What on the display can wake it. */
export interface Watched {
  /** Open requests keep the display awake. */
  open: number;
  /** One key for each thing that wakes the display when it is new. */
  keys: string[];
}

/** What of the last state can wake the display; while the hub is away, that wakes it too. */
export function watched(state: StateMessage | null, connected: boolean): Watched {
  if (!connected) return { open: 0, keys: ['hub away'] };
  if (!state) return { open: 0, keys: [] };
  const keys: string[] = [];
  // A new wait of a session is new, also of one that waited for something else before.
  for (const session of waitingForAnswer(state.sessions)) keys.push(`answer ${session.id} ${session.waitingSince}`);
  for (const monitor of state.uptimeKuma?.monitors?.failing ?? []) if (monitor.status === 'down') keys.push(`down ${monitor.name}`);
  for (const pull of state.pullRequests) {
    keys.push(`pull ${pull.repo}#${pull.number}`);
    if (pull.checks === 'failing') keys.push(`failing ${pull.repo}#${pull.number}`);
    if (pull.conflict) keys.push(`conflict ${pull.repo}#${pull.number}`);
  }
  return { open: state.permissions.filter((p) => p.outcome === null).length, keys };
}

/** At night the display rests after this long, also when the rest by day is longer or off. */
export const NIGHT_REST_MS = 60_000;

/** Whether a minute of the day lies in the night; a night from 23:00 to 07:00 goes over midnight. */
export function inNight(night: { from: number; to: number } | null, minute: number): boolean {
  if (night === null || night.from === night.to) return false;
  return night.from < night.to ? minute >= night.from && minute < night.to : minute >= night.from || minute < night.to;
}

/** How long without anything new before the display rests: by day as set up (0: never), at night a minute. */
export function restAfter(quietAfterMs: number, atNight: boolean): number {
  if (!atNight) return quietAfterMs;
  return quietAfterMs > 0 ? Math.min(quietAfterMs, NIGHT_REST_MS) : NIGHT_REST_MS;
}

/** At night the quiet tones have this share of their loudness by day. */
export const NIGHT_LOUDNESS = 0.25;

/** How loud the tones are, as a share of their loudness by day: none without sound, at night as set up. */
export function chimeLoudness(sound: boolean, nightSound: NightSound, atNight: boolean): number {
  if (!sound) return 0;
  if (!atNight || nightSound === 'on') return 1;
  return nightSound === 'quiet' ? NIGHT_LOUDNESS : 0;
}

export class Rest {
  private lastNews: number;
  private known = new Set<string>();

  constructor(now: number) {
    this.lastNews = now;
  }

  /**
   * Takes what the display shows now; true while it rests: `afterMs` without an open request and without
   * anything new. 0 keeps it awake.
   */
  update(seen: Watched, afterMs: number, now: number): boolean {
    if (seen.open > 0 || seen.keys.some((key) => !this.known.has(key))) this.lastNews = now;
    this.known = new Set(seen.keys);
    return afterMs > 0 && now - this.lastNews >= afterMs;
  }

  /** A tap: awake, and the time starts again. */
  wake(now: number): void {
    this.lastNews = now;
  }
}
