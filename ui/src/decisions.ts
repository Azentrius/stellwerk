// The last decisions on permission requests, in the status column below the hub and its hints: folded into
// one line by default, which a click opens and the next closes. Each decision: what it was about and when,
// whose session and which tool, and how it ended.
//
// SPDX-License-Identifier: Apache-2.0

import type { DecisionView } from '../../src/shared/protocol.js';
import { entry, icon } from './dom.ts';
import type { Texts } from './i18n.ts';
import { decisionState } from './states.ts';
import { clock } from './time.ts';

/**
 * The line and, while it is open, the decisions below it. The line's button is the same element each time
 * and stays where it is, so a press on it is never lost; its content changes only with what it says.
 */
export function renderDecisions(
  parts: { section: HTMLElement; button: HTMLButtonElement; list: HTMLUListElement },
  decisions: DecisionView[],
  open: boolean,
  now: number,
  texts: Texts,
): void {
  parts.section.hidden = decisions.length === 0;
  const shown = `${open} ${decisions.length}`;
  if (parts.button.dataset.shown !== shown) {
    parts.button.dataset.shown = shown;
    parts.button.setAttribute('aria-expanded', String(open));
    parts.button.replaceChildren(icon(open ? 'angle-down' : 'angle-right'), texts.decisionsTitle(decisions.length));
  }
  parts.list.hidden = !open;
  if (!open) return void parts.list.replaceChildren();
  parts.list.replaceChildren(
    ...decisions.map((d) => {
      const who = [d.title || d.project, d.tool].filter(Boolean).join(' · ');
      const item = entry('decision', d.what || d.tool, when(d.at, now, texts), who, decisionState(d.outcome, texts));
      item.title = d.what;
      return item;
    }),
  );
}

/** The time of day; for an earlier day with its weekday in front. */
function when(at: number, now: number, texts: Texts): string {
  return new Date(at).toDateString() === new Date(now).toDateString() ? clock(at) : `${texts.weekday(at)} ${clock(at)}`;
}
