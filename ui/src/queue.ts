// The cards in "waiting for you": one per permission request, the oldest on top. Cards are kept by id and
// updated in place, so an opened fold stays open and only new cards pulse.
//
// SPDX-License-Identifier: Apache-2.0

import type { Decision, PermissionView } from '../../src/shared/protocol.js';
import { naming } from './agents.ts';
import { el } from './dom.ts';
import type { Texts } from './i18n.ts';
import { duration } from './time.ts';
import { renderToolInput } from './tool-input.ts';

interface Card {
  view: PermissionView;
  root: HTMLElement;
  wait: HTMLElement;
  bar: HTMLElement;
  outcome: HTMLElement;
  buttons: HTMLButtonElement[];
  /** A decision was sent and its answer is still out. */
  busy: boolean;
}

export class QueueView {
  private readonly list: HTMLElement;
  private readonly texts: Texts;
  private readonly onDecide: (id: string, decision: Decision) => void;
  private readonly cards = new Map<string, Card>();
  private connected = false;

  constructor(list: HTMLElement, texts: Texts, onDecide: (id: string, decision: Decision) => void) {
    this.list = list;
    this.texts = texts;
    this.onDecide = onDecide;
    list.addEventListener('click', (event) => this.onClick(event));
  }

  /** Shows the requests; returns the ids of open requests that are new on the display. */
  update(permissions: PermissionView[], connected: boolean): string[] {
    this.connected = connected;
    const added: string[] = [];
    const seen = new Set<string>();
    permissions.forEach((view, position) => {
      seen.add(view.id);
      let card = this.cards.get(view.id);
      if (!card) {
        card = this.createCard(view);
        this.cards.set(view.id, card);
        if (view.outcome === null) {
          added.push(view.id);
          card.root.classList.add('card--new');
        }
      }
      card.view = view;
      if (view.outcome !== null) card.busy = false;
      this.refresh(card);
      if (this.list.children[position] !== card.root) this.list.insertBefore(card.root, this.list.children[position] ?? null);
    });
    for (const [id, card] of this.cards) {
      if (!seen.has(id)) {
        card.root.remove();
        this.cards.delete(id);
      }
    }
    this.list.hidden = permissions.length === 0;
    return added;
  }

  /** The decision was not taken (already decided elsewhere): the card can be used again. */
  release(id: string): void {
    const card = this.cards.get(id);
    if (!card) return;
    card.busy = false;
    this.refresh(card);
  }

  openCount(): number {
    let count = 0;
    for (const card of this.cards.values()) if (card.view.outcome === null) count++;
    return count;
  }

  /** Running wait time and the bar that shows how much of the hold time is left. */
  tick(now: number): void {
    for (const card of this.cards.values()) {
      const { view } = card;
      if (view.outcome !== null) continue;
      card.wait.textContent = duration(now - view.receivedAt);
      const total = view.holdUntil - view.receivedAt;
      const left = total > 0 ? Math.min(1, Math.max(0, (view.holdUntil - now) / total)) : 0;
      card.bar.style.transform = `scaleX(${left})`;
    }
  }

  private createCard(view: PermissionView): Card {
    const t = this.texts;
    const root = el('article', 'card');
    root.dataset.id = view.id;
    root.addEventListener('animationend', () => root.classList.remove('card--new'));

    // As in the agents column: the session's name on top, the project below.
    const { name, project } = naming(view.project, view.title, view.sessionId);
    const head = el('header', 'card__head');
    const wait = el('span', 'card__wait');
    head.append(el('span', 'card__name', name), el('span', 'card__sep', '·'));
    head.append(el('span', 'card__tool', view.tool), wait);
    root.append(head);
    if (project) root.append(el('p', 'card__project', project));
    root.append(renderToolInput(view.tool, view.input, view.mcpServer, t));

    const hold = el('div', 'card__hold');
    const bar = el('span', 'card__hold-bar');
    hold.append(bar);
    root.append(hold);

    const actions = el('div', 'card__actions');
    const buttons = (
      [
        ['allow', t.allow],
        ['deny', t.deny],
        ['app', t.inApp],
      ] as const
    ).map(([decision, label]) => {
      const button = el('button', `btn btn--${decision}`, label);
      button.type = 'button';
      button.dataset.decision = decision;
      return button;
    });
    actions.append(...buttons);
    const outcome = el('p', 'card__outcome');
    root.append(actions, outcome);
    return { view, root, wait, bar, outcome, buttons, busy: false };
  }

  private refresh(card: Card): void {
    const settled = card.view.outcome !== null;
    card.root.classList.toggle('card--settled', settled);
    card.outcome.textContent = settled ? this.texts.outcome[card.view.outcome!] : '';
    for (const button of card.buttons) button.disabled = settled || card.busy || !this.connected;
    if (settled && card.view.resolvedAt !== null) card.wait.textContent = duration(card.view.resolvedAt - card.view.receivedAt);
  }

  private onClick(event: MouseEvent): void {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-decision]');
    if (!button || button.disabled) return;
    const id = button.closest<HTMLElement>('.card')?.dataset.id;
    const card = id ? this.cards.get(id) : undefined;
    if (!card || card.view.outcome !== null) return;
    card.busy = true;
    this.refresh(card);
    this.onDecide(card.view.id, button.dataset.decision as Decision);
  }
}
