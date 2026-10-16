// The agents column: every session with its name (bold) and how long ago it was active on top, its project
// (and subagents) and its state below; the most urgent first (the hub sorts them).
//
// SPDX-License-Identifier: Apache-2.0

import type { SessionView } from '../../src/shared/protocol.js';
import { entry } from './dom.ts';
import type { Texts } from './i18n.ts';
import { sessionState } from './states.ts';
import { ago } from './time.ts';

export function renderAgents(list: HTMLElement, sessions: SessionView[], now: number, texts: Texts): void {
  list.replaceChildren(
    ...sessions.map((session) => {
      const { name, project } = naming(session.project, session.title, session.id);
      const details = [project, session.subagents > 0 ? texts.subagents(session.subagents) : ''].filter(Boolean).join(' · ');
      const item = entry(`agent agent--${session.status}`, name, ago(now - session.lastActivity, texts), details, sessionState(session.status, texts));
      item.title = session.cwd;
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
