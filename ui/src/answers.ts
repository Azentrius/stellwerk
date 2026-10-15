// Below the cards: sessions that wait for an answer in the app (a question, some input, or a permission
// whose card is open there). Nothing to decide on the display, but it shows who is waiting and how long.
// One line each, so they still fit below a card or two.
//
// SPDX-License-Identifier: Apache-2.0

import type { SessionView, WaitingFor } from '../../src/shared/protocol.js';
import { naming } from './agents.ts';
import { el } from './dom.ts';
import type { Texts } from './i18n.ts';
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
      const item = el('li', 'answer');
      const signal = el('span', 'signal signal--waiting');
      signal.setAttribute('aria-hidden', 'true');
      const { name, project } = naming(session.project, session.title, session.id);
      const detail = [texts.waitingFor[session.waitingFor], project].filter(Boolean).join(' · ');
      const since = session.waitingSince === null ? '' : texts.since(duration(now - session.waitingSince));
      item.append(signal, el('span', 'answer__name', name), el('span', 'answer__detail', detail), el('span', 'answer__since', since));
      return item;
    }),
  );
}
