// The middle column: every session with its signal, status, subagents and last activity, the most
// urgent first (the hub sorts them).
//
// SPDX-License-Identifier: Apache-2.0

import type { SessionView } from '../../src/shared/protocol.js';
import { el } from './dom.ts';
import type { Texts } from './i18n.ts';
import { ago } from './time.ts';

export function renderAgents(list: HTMLElement, sessions: SessionView[], now: number, texts: Texts): void {
  list.replaceChildren(
    ...sessions.map((session) => {
      const item = el('li', `agent agent--${session.status}`);
      const signal = el('span', `signal signal--${session.status}`);
      signal.setAttribute('aria-hidden', 'true');

      const name = el('span', 'agent__name', session.project || session.id.slice(0, 8));
      name.title = session.cwd;
      const title = el('span', 'agent__title', session.title ?? '');
      const status = el('span', 'agent__status', texts.status[session.status]);
      const meta = [session.subagents > 0 ? texts.subagents(session.subagents) : '', ago(now - session.lastActivity, texts)]
        .filter(Boolean)
        .join(' · ');

      item.append(signal, name, status, title, el('span', 'agent__meta', meta));
      return item;
    }),
  );
}
