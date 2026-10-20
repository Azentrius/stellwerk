// Which sessions wait for an answer in the app: a question, some input, or a permission whose card is open
// there. Mere idleness does not count. Without the DOM, so that the display's rest (quiet.ts) and the tests
// can use it too.
//
// SPDX-License-Identifier: Apache-2.0

import type { SessionView, WaitingFor } from '../../src/shared/protocol.js';

export type DueFor = Exclude<WaitingFor, 'idle'>;
export type DueSession = SessionView & { waitingFor: DueFor };

/** Sessions waiting for an answer in the app, the longest waiting first. */
export function waitingForAnswer(sessions: SessionView[]): DueSession[] {
  return sessions
    .filter((s): s is DueSession => s.status === 'waiting' && s.waitingFor !== null && s.waitingFor !== 'idle')
    .sort((a, b) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0));
}
