// The agents column: every session with how full its context is in front (the percentage over a thin
// line), its name (bold), whose agent it is and how long ago it was active on top ("Claude · 12 s"), its
// project (and subagents) and its state below; the most urgent first (the hub sorts them). All agents look
// alike.
//
// SPDX-License-Identifier: Apache-2.0

import type { ContextUsage, SessionView } from '../../src/shared/protocol.js';
import { contextPercent } from './context.ts';
import { el, entry } from './dom.ts';
import type { Texts } from './i18n.ts';
import { meterTone } from './levels.ts';
import { sessionState } from './states.ts';
import { elapsed } from './time.ts';

export function renderAgents(list: HTMLElement, sessions: SessionView[], now: number, texts: Texts): void {
  list.replaceChildren(
    ...sessions.map((session) => {
      const { name, project } = naming(session.project, session.title, session.id);
      const details = [project, session.subagents > 0 ? texts.subagents(session.subagents) : ''].filter(Boolean).join(' · ');
      // Whose agent it is, for every session alike, with the time, which is kept short for it ("12 s").
      const time = `${texts.providers[session.provider]} · ${elapsed(now - session.lastActivity, texts)}`;
      const item = entry(`agent agent--${session.status} entry--meter`, name, time, details, sessionState(session.status, texts));
      item.title = session.cwd;
      item.prepend(contextMeter(session.context, texts));
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

/** The percentage over a thin line; its words are its name and tooltip. Empty while not known. */
function contextMeter(usage: ContextUsage | null, texts: Texts): HTMLSpanElement {
  const percent = contextPercent(usage);
  const tone = meterTone(percent);
  const node = el('span', tone === 'neutral' ? 'meter' : `meter meter--${tone}`);
  const name = percent === null ? texts.contextUnknown : texts.context(`${texts.number(percent, 0)} %`);
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', name);
  node.title = name;
  const bar = el('span', 'meter__bar');
  const fill = el('span', 'meter__fill');
  fill.style.transform = `scaleX(${(percent ?? 0) / 100})`;
  bar.append(fill);
  node.append(el('span', 'meter__value', percent === null ? '' : `${texts.number(percent, 0)} %`), bar);
  return node;
}
