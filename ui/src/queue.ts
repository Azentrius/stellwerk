// The cards in "waiting for you": one per permission request, the oldest on top. Cards are kept by id and
// updated in place, so an opened fold stays open.
//
// SPDX-License-Identifier: Apache-2.0

import type { Decision, PermissionView } from '../../src/shared/protocol.js';
import { naming, providerName } from './naming.ts';
import { el, icon } from './dom.ts';
import type { Texts } from './i18n.ts';
import { leadingRequest } from './leading.ts';
import { duration } from './time.ts';
import { renderToolInput } from './tool-input.ts';

interface Card {
  view: PermissionView;
  root: HTMLElement;
  wait: HTMLElement;
  bar: HTMLElement;
  outcome: HTMLElement;
  buttons: HTMLButtonElement[];
  allow: HTMLButtonElement;
  /** Whose agent and the project, and the third button's word: both differ for Codex' command line. */
  project: HTMLElement;
  appLabel: Text;
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
        if (view.outcome === null) added.push(view.id);
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
    const leading = leadingRequest(permissions);
    for (const card of this.cards.values()) {
      const filled = card.view.id === leading;
      card.allow.classList.toggle('az-btn--primary', filled);
      card.allow.classList.toggle('az-btn--secondary', !filled);
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
    const root = el('article', 'az-card card');
    root.dataset.id = view.id;

    // As in the agents column: the session's name on top, the project below.
    const { name } = naming(view.project, view.title, view.sessionId);
    const head = el('header', 'card__head');
    const line = el('p', 'card__line');
    const wait = el('span', 'card__wait');
    line.append(el('span', 'card__name', name), el('span', 'card__sep', '·'), el('span', 'card__tool', view.tool), wait);
    head.append(line);
    const projectLine = el('p', 'card__project');
    head.append(projectLine);
    root.append(head, renderToolInput(view.tool, view.input, view.mcpServer, t));

    const hold = el('div', 'card__hold');
    const bar = el('span', 'card__hold-bar');
    hold.append(bar);
    root.append(hold);

    // Allow is the card's main action; deny and leaving it to the app are outlined. All start outlined:
    // update fills the Allow of the oldest open request only.
    const actions = el('div', 'card__actions');
    const buttons = (
      [
        ['allow', t.allow, 'check'],
        ['deny', t.deny, 'times'],
        ['app', t.inApp, 'external-link-alt'],
      ] as const
    ).map(([decision, text, iconName]) => {
      const button = el('button', 'az-btn az-btn--secondary btn');
      button.type = 'button';
      button.dataset.decision = decision;
      button.append(icon(iconName), document.createTextNode(text));
      return button;
    });
    actions.append(...buttons);
    const outcome = el('p', 'card__outcome');
    root.append(actions, outcome);
    return { view, root, wait, bar, outcome, buttons, allow: buttons[0]!, busy: false, project: projectLine, appLabel: buttons[2]!.lastChild as Text };
  }

  private refresh(card: Card): void {
    const t = this.texts;
    // Known only after the first read of the session's transcript, so it can change while the card stands.
    const { project } = naming(card.view.project, card.view.title, card.view.sessionId);
    card.project.textContent = [providerName(card.view.provider, card.view.terminal, t), project].filter(Boolean).join(' · ');
    card.appLabel.data = card.view.terminal ? t.inTerminal : t.inApp;
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
