// The agents column: every session with its signal, its name (bold) and how long ago it was active on
// top, its project (and subagents) and status below; the most urgent first (the hub sorts them).
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

      const { name, project } = naming(session.project, session.title, session.id);
      const nameNode = el('span', 'agent__name', name);
      nameNode.title = session.cwd;
      const below = [project, session.subagents > 0 ? texts.subagents(session.subagents) : ''].filter(Boolean).join(' · ');

      // Two lines of their own, so a long status below never narrows the name above.
      const top = el('span', 'agent__line');
      top.append(nameNode, el('span', 'agent__ago', ago(now - session.lastActivity, texts)));
      const bottom = el('span', 'agent__line');
      bottom.append(el('span', 'agent__project', below), el('span', 'agent__status', texts.status[session.status]));
      const lines = el('span', 'agent__lines');
      lines.append(top, bottom);
      item.append(signal, lines);
      return item;
    }),
  );
}

/**
 * A session's name (its title) on top, the project below; without a title the project is the name. Used
 * for agents, cards and answers alike.
 */
export function naming(projectName: string, title: string | null, sessionId: string): { name: string; project: string } {
  const project = projectName || sessionId.slice(0, 8);
  const trimmed = title?.trim();
  return trimmed && trimmed !== project ? { name: trimmed, project } : { name: project, project: '' };
}
