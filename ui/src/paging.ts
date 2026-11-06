// Which pages the display has, and when it goes back to the first: the agents and what waits for you come
// first, so a new request or a new answer due in the app takes the display back there, wherever one swiped.
// Without the DOM, so the tests can use it.
//
// SPDX-License-Identifier: Apache-2.0

import type { StateMessage } from '../../src/shared/protocol.js';
import { waitingForAnswer } from './due.ts';

export type PageName = 'agents' | 'calendar';

/** The agents always; the calendar page when a calendar or the issues assigned to me are set up. */
export function pagesOf(state: StateMessage | null): PageName[] {
  return state && (state.calendar !== null || state.issues !== null) ? ['agents', 'calendar'] : ['agents'];
}

/** What waits on the first page: open requests and answers due in the app, one key each. */
export function waitingKeys(state: StateMessage | null): string[] {
  if (!state) return [];
  return [
    ...state.permissions.filter((p) => p.outcome === null).map((p) => `request ${p.id}`),
    ...waitingForAnswer(state.sessions).map((s) => `answer ${s.id} ${s.waitingSince}`),
  ];
}

/** Notes what waits; says when something new does, so the display goes back to the first page. */
export class Home {
  private known = new Set<string>();

  /** True when a key is new since the last time. */
  update(keys: string[]): boolean {
    const fresh = keys.some((key) => !this.known.has(key));
    this.known = new Set(keys);
    return fresh;
  }
}
