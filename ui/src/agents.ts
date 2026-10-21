// The agents column: every session with how full its context is in front (the percentage over a thin
// line), its name (bold), whose agent it is and how long ago it was active on top ("Claude · 12 s"), its
// project (and subagents) and its state below; the most urgent first (the hub sorts them). All agents look
// alike. Sessions at rest (resting.ts) make way in one line at the foot, which opens on a tap.
//
// SPDX-License-Identifier: Apache-2.0

import type { ContextUsage, SessionView } from '../../src/shared/protocol.js';
import { contextPercent } from './context.ts';
import { el, entry, icon } from './dom.ts';
import type { Texts } from './i18n.ts';
import { meterTone } from './levels.ts';
import { naming, providerName } from './naming.ts';
import { sessionState } from './states.ts';
import { elapsed } from './time.ts';

/**
 * The sessions, those at rest behind `line`: its word says how many, and they show below it while it is
 * open. The line is the same element each time and stays in the list while the entries around it are drawn
 * anew, so a focus on it and a press or key still held on it outlast every render.
 */
export function renderAgents(
  list: HTMLElement,
  sessions: { active: SessionView[]; resting: SessionView[] },
  line: { item: HTMLLIElement; button: HTMLButtonElement; open: boolean },
  now: number,
  texts: Texts,
): void {
  const count = sessions.resting.length;
  line.item.hidden = count === 0;
  // Its content only when it changes, so a tap on it meets the same nodes it started on.
  const shown = `${line.open} ${count}`;
  if (line.button.dataset.shown !== shown) {
    line.button.dataset.shown = shown;
    line.button.setAttribute('aria-expanded', String(line.open));
    line.button.replaceChildren(icon(line.open ? 'angle-down' : 'angle-right'), line.open ? texts.restingHide(count) : texts.restingMore(count));
  }
  // Taken out and put back, the line would lose the focus and end a press on it without a click.
  for (const child of [...list.children]) if (child !== line.item) child.remove();
  if (line.item.parentElement !== list) list.append(line.item);
  line.item.before(...sessions.active.map((s) => agentEntry(s, now, texts)));
  line.item.after(...(line.open ? sessions.resting.map((s) => agentEntry(s, now, texts)) : []));
}

function agentEntry(session: SessionView, now: number, texts: Texts): HTMLLIElement {
  const { name, project } = naming(session.project, session.title, session.id);
  const details = [project, session.subagents > 0 ? texts.subagents(session.subagents) : ''].filter(Boolean).join(' · ');
  // Whose agent it is, for every session alike, with the time, which is kept short for it ("12 s").
  const time = `${providerName(session.provider, session.terminal, texts)} · ${elapsed(now - session.lastActivity, texts)}`;
  const item = entry(`agent agent--${session.status} entry--meter`, name, time, details, sessionState(session.status, texts));
  item.title = session.cwd;
  item.prepend(contextMeter(session.context, texts));
  return item;
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
