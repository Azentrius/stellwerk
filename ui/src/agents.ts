// The agents column: every session with the ring of its context in front, its name (bold) and how long ago
// it was active on top, its project (and subagents) and its state below; the most urgent first (the hub
// sorts them).
//
// SPDX-License-Identifier: Apache-2.0

import type { ContextUsage, SessionView } from '../../src/shared/protocol.js';
import { CONTEXT_FULL, contextPercent } from './context.ts';
import { el, entry } from './dom.ts';
import type { Texts } from './i18n.ts';
import { sessionState } from './states.ts';
import { ago } from './time.ts';

const SVG = 'http://www.w3.org/2000/svg';
/** A circle of this radius in a 36 × 36 box is 100 units around, so a percentage is its own dash length. */
const RADIUS = 15.9155;

export function renderAgents(list: HTMLElement, sessions: SessionView[], now: number, texts: Texts): void {
  list.replaceChildren(
    ...sessions.map((session) => {
      const { name, project } = naming(session.project, session.title, session.id);
      const details = [project, session.subagents > 0 ? texts.subagents(session.subagents) : ''].filter(Boolean).join(' · ');
      const item = entry(`agent agent--${session.status} entry--ring`, name, ago(now - session.lastActivity, texts), details, sessionState(session.status, texts));
      item.title = session.cwd;
      item.prepend(contextRing(session.context, texts));
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

/** The ring with the percentage inside; its words are its name and tooltip. Empty while not known. */
function contextRing(usage: ContextUsage | null, texts: Texts): HTMLSpanElement {
  const percent = contextPercent(usage);
  const node = el('span', percent !== null && percent >= CONTEXT_FULL ? 'ring ring--full' : 'ring');
  const name = percent === null ? texts.contextUnknown : texts.context(`${texts.number(percent, 0)} %`);
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', name);
  node.title = name;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ring__svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  svg.append(circle('ring__track'));
  if (percent !== null && percent > 0) {
    const fill = circle('ring__fill');
    fill.setAttribute('stroke-dasharray', `${percent} 100`);
    // Start at the top, clockwise.
    fill.setAttribute('transform', 'rotate(-90 18 18)');
    svg.append(fill);
  }
  node.append(svg, el('span', 'ring__value', percent === null ? '' : `${texts.number(percent, 0)}%`));
  return node;
}

function circle(className: string): SVGCircleElement {
  const c = document.createElementNS(SVG, 'circle');
  c.setAttribute('class', className);
  c.setAttribute('cx', '18');
  c.setAttribute('cy', '18');
  c.setAttribute('r', String(RADIUS));
  return c;
}
