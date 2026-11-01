// List entries a tap opens (a session waiting for an answer in its app, a pull request, Dependabot's
// updates of a repository in place): each keeps its element over the renders, by key, while only its
// content is drawn anew; that content takes no pointer events (.entry--tappable > *), so a tap that meets a
// render still reaches the entry. Enter and Space work as a tap. Entries a tap does not open stay plain.
//
// SPDX-License-Identifier: Apache-2.0

import { el } from './dom.ts';

export interface TapEntry {
  key: string;
  /** The entry as drawn now; its content goes into the kept element. */
  fresh: HTMLLIElement;
  /** A tap opens it; else it is a plain entry. */
  tappable: boolean;
  /** Its tooltip while a tap opens it. */
  hint?: string;
  /** For a line a tap opens in place (Dependabot's updates): whether it is open. */
  expanded?: boolean;
}

export class TapList {
  private readonly items = new Map<string, HTMLLIElement>();
  private readonly tap: (key: string) => void;

  constructor(tap: (key: string) => void) {
    this.tap = tap;
  }

  /**
   * The entries in this order. Only what goes away is removed and only what is out of place is moved: taken
   * out and put back, an element would lose the focus and end a press on it without a click.
   */
  render(list: HTMLElement, entries: TapEntry[]): void {
    const shown = entries.map((entry) => this.fill(entry));
    const keys = new Set(entries.map((e) => e.key));
    for (const key of this.items.keys()) if (!keys.has(key)) this.items.delete(key);
    const keep = new Set<Element>(shown);
    for (const child of [...list.children]) if (!keep.has(child)) child.remove();
    let place = list.firstElementChild;
    for (const item of shown) {
      if (item === place) place = place.nextElementSibling;
      else list.insertBefore(item, place);
    }
  }

  private fill({ key, fresh, tappable, hint, expanded }: TapEntry): HTMLLIElement {
    let item = this.items.get(key);
    if (!item) {
      const node = el('li');
      node.addEventListener('click', () => {
        if (node.dataset.tap === 'yes') this.tap(key);
      });
      node.addEventListener('keydown', (event) => {
        if (node.dataset.tap !== 'yes' || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        if (!event.repeat) this.tap(key);
      });
      this.items.set(key, node);
      item = node;
    }
    item.className = tappable ? `${fresh.className} entry--tappable` : fresh.className;
    item.title = tappable && hint ? hint : fresh.title;
    if (tappable) {
      item.dataset.tap = 'yes';
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
    } else {
      delete item.dataset.tap;
      item.removeAttribute('tabindex');
      item.removeAttribute('role');
    }
    if (expanded === undefined) item.removeAttribute('aria-expanded');
    else item.setAttribute('aria-expanded', String(expanded));
    item.replaceChildren(...fresh.childNodes);
    return item;
  }
}
