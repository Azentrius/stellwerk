// The display's pages side by side, left of the status column: a swipe goes to the next one or the one
// before, and they snap in place. It is the browser's own scrolling, so a swipe up or down still scrolls the
// lists. The arrow keys left and right do the same. A row of tabs in the status column, an icon for each
// page, says which page shows, and a tap on one goes there; on another page the first one's tab carries how
// much waits there. The row stays where it is however many pages there are. A page out of view takes no
// focus and no taps.
//
// SPDX-License-Identifier: Apache-2.0

import { el, icon } from './dom.ts';
import type { Texts } from './i18n.ts';
import type { IconName } from './icons.ts';
import type { PageName } from './paging.ts';

/** Each page's icon on its tab. */
const PAGE_ICONS: Record<PageName, IconName> = { agents: 'robot', calendar: 'calendar-alt' };

export class Pages {
  private readonly container: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly elements: Record<PageName, HTMLElement>;
  private shown: PageName[] = ['agents'];
  private current = 0;
  private tabNodes: HTMLButtonElement[] = [];
  private badge = el('span', 'page-tab__badge');

  constructor(container: HTMLElement, tabs: HTMLElement, elements: Record<PageName, HTMLElement>) {
    this.container = container;
    this.tabs = tabs;
    this.elements = elements;
    container.addEventListener('scrollend', () => this.settle());
    window.addEventListener('resize', () => this.place('instant'));
    document.addEventListener('keydown', (event) => {
      if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (this.shown.length < 2) return;
      event.preventDefault();
      this.go(this.current + (event.key === 'ArrowRight' ? 1 : -1));
    });
  }

  /** The page that shows. */
  get page(): PageName {
    return this.shown[this.current] ?? 'agents';
  }

  /** Which pages there are, their names, and how much waits on the first one. */
  show(names: PageName[], texts: Texts['pages'], waiting: number): void {
    if (names.join() !== this.shown.join()) {
      const was = this.page;
      this.shown = names;
      // With tabs the pages are their panels; one page alone is a region.
      for (const [name, page] of Object.entries(this.elements) as [PageName, HTMLElement][]) {
        page.hidden = !names.includes(name);
        page.setAttribute('role', names.length > 1 ? 'tabpanel' : 'region');
      }
      this.current = Math.max(0, names.indexOf(was));
      this.tabNodes = names.map((name, i) => {
        const tab = el('button', 'page-tab');
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', this.elements[name].id);
        tab.append(icon(PAGE_ICONS[name]));
        tab.addEventListener('click', () => this.go(i));
        return tab;
      });
      this.tabs.replaceChildren(...this.tabNodes);
      this.tabs.hidden = names.length < 2;
      this.place('instant');
    }
    this.tabs.setAttribute('aria-label', texts.title);
    for (const [name, page] of Object.entries(this.elements) as [PageName, HTMLElement][]) page.setAttribute('aria-label', texts[name]);
    // Only on another page: on the first one, what waits is in view.
    const count = this.current !== 0 && waiting > 0 ? String(waiting) : '';
    this.tabNodes.forEach((tab, i) => {
      const name = texts[this.shown[i]!];
      const label = i === 0 && count ? `${name}: ${texts.waiting(waiting)}` : name;
      tab.title = label;
      tab.setAttribute('aria-label', label);
    });
    if (this.badge.textContent !== count) this.badge.textContent = count;
    const first = this.tabNodes[0];
    if (first && count && this.badge.parentElement !== first) first.append(this.badge);
    else if (!count) this.badge.remove();
    this.mark();
  }

  /** Goes to a page by its place, smoothly unless told otherwise. */
  go(index: number, behavior: ScrollBehavior = 'smooth'): void {
    this.current = Math.min(Math.max(0, index), this.shown.length - 1);
    this.mark();
    this.place(matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior);
  }

  /** Back to the first page, at once: what waits there should show without delay. */
  home(): void {
    if (this.current !== 0 || this.container.scrollLeft !== 0) this.go(0, 'instant');
  }

  private place(behavior: ScrollBehavior): void {
    const left = this.current * this.container.clientWidth;
    if (Math.abs(this.container.scrollLeft - left) < 1) return this.settle();
    this.container.scrollTo({ left, behavior });
    // An instant move may not end in a scrollend.
    if (behavior === 'instant') this.settle();
  }

  /** The tab of the page that shows is the selected one, and the only one the Tab key reaches. */
  private mark(): void {
    this.tabNodes.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === this.current));
      tab.tabIndex = i === this.current ? 0 : -1;
    });
  }

  /** Where the scrolling came to rest is the page that shows; the others take no focus and no taps. */
  private settle(): void {
    const width = this.container.clientWidth;
    if (width > 0) this.current = Math.min(Math.max(0, Math.round(this.container.scrollLeft / width)), this.shown.length - 1);
    this.shown.forEach((name, i) => {
      this.elements[name].inert = i !== this.current;
    });
    this.mark();
    if (this.current === 0) this.badge.remove();
    this.container.dataset.page = this.page;
  }
}
