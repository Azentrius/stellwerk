// Sessions at rest in the agents column: done or unknown (since a restart of the hub) and without any event
// for a while. They make way in one line at the foot ("8 more at rest"), so the ones at work or waiting
// stand out; a tap opens the line, and it closes again by itself a while after the last touch (fold.ts).
// Without the DOM, so the tests can use it.
//
// SPDX-License-Identifier: Apache-2.0

import type { SessionView } from '../../src/shared/protocol.js';

/** A session done or unknown rests after this long without an event. */
export const REST_AFTER_MS = 30 * 60_000;

/** The sessions that stand on their own, and those at rest; each in the order the hub gave them. */
export function splitResting(sessions: SessionView[], now: number): { active: SessionView[]; resting: SessionView[] } {
  const active: SessionView[] = [];
  const resting: SessionView[] = [];
  for (const session of sessions) {
    const rests = (session.status === 'done' || session.status === 'unknown') && now - session.lastActivity >= REST_AFTER_MS;
    (rests ? resting : active).push(session);
  }
  return { active, resting };
}
