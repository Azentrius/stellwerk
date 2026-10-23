// Below the cards: sessions that wait for an answer in the app (a question, some input, or a permission
// whose card is open there). Nothing to decide on the display, but it shows who is waiting, why and how
// long. One line each, so they still fit below a card or two: name, the question if known (otherwise the
// project), the reason and how long. A tap opens the session in its app, where the answer is given, when the
// hub knows where (SessionView.openable).
//
// SPDX-License-Identifier: Apache-2.0

import type { DueSession } from './due.ts';
import { naming, providerName } from './naming.ts';
import { entry } from './dom.ts';
import type { Texts } from './i18n.ts';
import { state } from './states.ts';
import type { TapList } from './taps.ts';
import { duration } from './time.ts';

/** The sessions of waitingForAnswer (due.ts), one line each. */
export function renderAnswers(list: HTMLElement, taps: TapList, sessions: DueSession[], now: number, texts: Texts): void {
  taps.render(
    list,
    sessions.map((session) => {
      const { name, project } = naming(session.project, session.title, session.id);
      // Whose agent it is, with how long it has been waiting ("Codex · 0:42").
      const since = [providerName(session.provider, session.terminal, texts), session.waitingSince === null ? '' : duration(now - session.waitingSince)]
        .filter(Boolean)
        .join(' · ');
      // The same state as "waiting for you" in the agents column: a note, with the reason as its word.
      const fresh = entry('answer entry--short', name, since, session.question ?? project, state('info', texts.waitingFor[session.waitingFor]));
      const app = providerName(session.provider, session.terminal, texts);
      return { key: session.id, fresh, tappable: session.openable, hint: texts.openIn(app) };
    }),
  );
}
