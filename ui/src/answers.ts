// Below the cards: sessions that wait for an answer in the app (a question, some input, or a permission
// whose card is open there). Nothing to decide on the display, but it shows who is waiting, why and how
// long. One line each, so they still fit below a card or two: name, the question if known (otherwise the
// project), the reason and how long.
//
// SPDX-License-Identifier: Apache-2.0

import type { SessionView, WaitingFor } from '../../src/shared/protocol.js';
import { naming } from './agents.ts';
import { entry } from './dom.ts';
import type { Texts } from './i18n.ts';
import { state } from './states.ts';
import { duration } from './time.ts';

type DueFor = Exclude<WaitingFor, 'idle'>;

/** Sessions waiting for an answer in the app, the longest waiting first. Mere idleness does not count. */
export function waitingForAnswer(sessions: SessionView[]): Array<SessionView & { waitingFor: DueFor }> {
  return sessions
    .filter((s): s is SessionView & { waitingFor: DueFor } => s.status === 'waiting' && s.waitingFor !== null && s.waitingFor !== 'idle')
    .sort((a, b) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0));
}

export function renderAnswers(list: HTMLElement, sessions: Array<SessionView & { waitingFor: DueFor }>, now: number, texts: Texts): void {
  list.replaceChildren(
    ...sessions.map((session) => {
      const { name, project } = naming(session.project, session.title, session.id);
      // Whose agent it is, with how long it has been waiting ("Codex · 0:42").
      const since = [texts.providers[session.provider], session.waitingSince === null ? '' : duration(now - session.waitingSince)]
        .filter(Boolean)
        .join(' · ');
      // The same state as "waiting for you" in the agents column: a note, with the reason as its word.
      return entry('answer entry--short', name, since, session.question ?? project, state('info', texts.waitingFor[session.waitingFor]));
    }),
  );
}
