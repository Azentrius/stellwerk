// Which of the last decisions the display shows: only those of the last day, so that old ones, from a test
// days ago, do not look like what just happened. Without the DOM, so the tests can use it.
//
// SPDX-License-Identifier: Apache-2.0

import type { DecisionView } from '../../src/shared/protocol.js';

/** Decisions older than this are not shown. */
export const DECISIONS_FOR_MS = 24 * 60 * 60_000;

/** The decisions of the last day, in the order the hub gave them (newest first). */
export function recentDecisions(decisions: DecisionView[], now: number): DecisionView[] {
  return decisions.filter((d) => now - d.at < DECISIONS_FOR_MS);
}
