// The agents column: every session with how full its context is in front (the percentage over a thin
// line), its name (bold), whose agent it is and how long ago it was active on top ("Claude · 12 s"), its
// project (and subagents) and its state below; the most urgent first (the hub sorts them). All agents look
// alike. Sessions at rest (resting.ts) make way in one line at the foot, which opens on a tap. A tap on a
// session (or Enter or Space on it) opens its details below it: folder, model, context, subagents, the tool
// it used last; the next closes them. When the hub knows where (SessionView.openable), the details end with a
// button that opens the session in its app. Each session keeps its element while only its content is drawn
// anew, and that content takes no pointer events, so a tap that meets a render still reaches the session; the
// button takes its own and stays in place.
//
// SPDX-License-Identifier: Apache-2.0

import type { ContextUsage, SessionView } from '../../src/shared/protocol.js';
import { contextPercent } from './context.ts';
import { el, entry, icon } from './dom.ts';
import type { Texts } from './i18n.ts';
import { meterTone } from './levels.ts';
import { naming, providerName } from './naming.ts';
import { sessionState } from './states.ts';
import { ago, elapsed } from './time.ts';

/** The sessions' elements by id, and whose details are open. */
export class AgentItems {
  readonly open = new Set<string>();
  private readonly items = new Map<string, HTMLLIElement>();
  private readonly buttons = new Map<string, HTMLButtonElement>();

  /** The element of a session: the same one each time; a tap or Enter or Space on it calls `toggle`. */
  item(id: string, toggle: (id: string) => void): HTMLLIElement {
    let item = this.items.get(id);
    if (!item) {
      item = el('li');
      item.dataset.session = id;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.addEventListener('click', () => toggle(id));
      item.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (!event.repeat) toggle(id);
      });
      this.items.set(id, item);
    }
    return item;
  }

  /**
   * The button in a session's open details that opens it in its app: the same one each time. A tap, Enter or
   * Space on it calls `open` and does not fold the details.
   */
  openButton(id: string, label: string, open: (id: string) => void): HTMLButtonElement {
    let button = this.buttons.get(id);
    if (!button) {
      button = el('button', 'az-btn az-btn--secondary btn agent__open');
      button.type = 'button';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        open(id);
      });
      button.addEventListener('keydown', (event) => event.stopPropagation());
      this.buttons.set(id, button);
    }
    if (button.dataset.label !== label) {
      button.dataset.label = label;
      button.replaceChildren(icon('external-link-alt'), document.createTextNode(label));
    }
    return button;
  }

  /** Forgets the elements (and open details) of sessions no longer shown. */
  keep(ids: Set<string>): void {
    for (const id of this.items.keys()) {
      if (ids.has(id)) continue;
      this.items.delete(id);
      this.buttons.delete(id);
      this.open.delete(id);
    }
  }
}

/**
 * The sessions, those at rest behind `line`: its word says how many, and they show below it while it is
 * open. The line is the same element each time and stays in the list while the entries around it are drawn
 * anew, so a focus on it and a press or key still held on it outlast every render.
 */
export function renderAgents(
  list: HTMLElement,
  sessions: { active: SessionView[]; resting: SessionView[] },
  line: { item: HTMLLIElement; button: HTMLButtonElement; open: boolean },
  agents: { items: AgentItems; toggle: (id: string) => void; open: (id: string) => void },
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
  agents.items.keep(new Set([...sessions.active, ...sessions.resting].map((s) => s.id)));
  const fill = (session: SessionView) => {
    const item = agents.items.item(session.id, agents.toggle);
    const open = agents.items.open.has(session.id);
    const fresh = agentEntry(session, now, texts);
    item.className = `${fresh.className} agent--tappable`;
    item.title = fresh.title;
    item.setAttribute('aria-expanded', String(open));
    // The button stays where it is over the renders, so a press on it is not lost; what is before it is new.
    const button = open && session.openable ? agents.items.openButton(session.id, texts.openIn(providerName(session.provider, session.terminal, texts)), agents.open) : null;
    for (const child of [...item.childNodes]) if (child !== button) child.remove();
    item.prepend(...fresh.childNodes, ...(open ? [agentDetails(session, now, texts)] : []));
    if (button && button.parentElement !== item) item.append(button);
    return item;
  };
  const before = sessions.active.map(fill);
  const after = line.open ? sessions.resting.map(fill) : [];
  // Taken out and put back, an element would lose the focus and end a press on it without a click: only
  // what goes away is removed, and only what is out of place is moved, around the line, which never is.
  const keep = new Set<Element>([...before, line.item, ...after]);
  for (const child of [...list.children]) if (!keep.has(child)) child.remove();
  if (line.item.parentElement !== list) list.append(line.item);
  let place = list.firstElementChild;
  for (const item of before) {
    if (item === place) place = place.nextElementSibling;
    else list.insertBefore(item, place);
  }
  place = line.item.nextElementSibling;
  for (const item of after) {
    if (item === place) place = place.nextElementSibling;
    else list.insertBefore(item, place);
  }
}

/** A session's details, below its two lines: folder, model, context, subagents and the tool it used last. */
function agentDetails(session: SessionView, now: number, texts: Texts): HTMLDListElement {
  const list = el('dl', 'agent__details');
  const row = (term: string, value: string, mono = false) => list.append(el('dt', undefined, term), el('dd', mono ? 'az-mono' : undefined, value));
  const usage = session.context;
  row(texts.details.folder, session.cwd, true);
  row(texts.details.model, usage?.model ?? texts.details.unknown);
  row(
    texts.details.context,
    usage ? texts.details.contextOf(texts.number(usage.used / 1000, 0), texts.number(usage.size / 1000, 0), texts.number(contextPercent(usage) ?? 0, 0)) : texts.details.unknown,
  );
  row(texts.details.subagents, texts.number(session.subagents, 0));
  row(texts.details.lastTool, session.lastTool ? `${session.lastTool.name} · ${ago(now - session.lastTool.at, texts)}` : texts.details.none);
  row(texts.details.session, session.id.slice(0, 8), true);
  return list;
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
