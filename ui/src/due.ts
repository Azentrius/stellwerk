// Which sessions wait for an answer in the app: a question, some input, or a permission whose card is open
// there. Mere idleness does not count. And which open requests have waited long enough to remind. Without
// the DOM, so that the display's rest (quiet.ts) and the tests can use it too.
//
// SPDX-License-Identifier: Apache-2.0

import type { PermissionView, SessionView, WaitingFor } from '../../src/shared/protocol.js';

export type DueFor = Exclude<WaitingFor, 'idle'>;
export type DueSession = SessionView & { waitingFor: DueFor };

/** Sessions waiting for an answer in the app, the longest waiting first. */
export function waitingForAnswer(sessions: SessionView[]): DueSession[] {
  return sessions
    .filter((s): s is DueSession => s.status === 'waiting' && s.waitingFor !== null && s.waitingFor !== 'idle')
    .sort((a, b) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0));
}

/** Whether an open request has waited long enough to remind. */
export function reminds(view: Pick<PermissionView, 'outcome' | 'receivedAt'>, remindAfterMs: number, now: number): boolean {
  return remindAfterMs > 0 && view.outcome === null && now - view.receivedAt >= remindAfterMs;
}

/**
 * The open requests that remind from now on, each once: they are added to `reminded`, which forgets the
 * ones no longer open.
 */
export function newReminders(permissions: PermissionView[], remindAfterMs: number, now: number, reminded: Set<string>): string[] {
  const open = new Set(permissions.filter((p) => p.outcome === null).map((p) => p.id));
  for (const id of reminded) if (!open.has(id)) reminded.delete(id);
  const fresh = permissions.filter((p) => reminds(p, remindAfterMs, now) && !reminded.has(p.id)).map((p) => p.id);
  for (const id of fresh) reminded.add(id);
  return fresh;
}
