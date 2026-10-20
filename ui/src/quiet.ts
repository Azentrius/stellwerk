// The display at rest: dimmed after a while with nothing new, so that it does not glow on the desk all
// day and night. An open request keeps it awake, since it goes back to the app when its hold time is up.
// Anything new wakes it: a request, an answer due in the app, a monitor that goes down, a pull request or
// checks that failed, the hub gone away. So does a tap. The hub cannot dim the screen itself (it starts no
// programs); the display dims its own page.
//
// SPDX-License-Identifier: Apache-2.0

import type { StateMessage } from '../../src/shared/protocol.js';
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
  }
  return { open: state.permissions.filter((p) => p.outcome === null).length, keys };
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
