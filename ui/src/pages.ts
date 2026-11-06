// The display's pages side by side, left of the status column: a swipe goes to the next one or the one
// before, and they snap in place. It is the browser's own scrolling, so a swipe up or down still scrolls the
// lists. The arrow keys left and right do the same. Dots at the foot say which page shows; on another page
// the first one's dot carries how much waits there. A page out of view takes no focus and no taps.
//
// SPDX-License-Identifier: Apache-2.0

import { el } from './dom.ts';
import type { PageName } from './paging.ts';

export class Pages {
  private readonly container: HTMLElement;
  private readonly dots: HTMLElement;
  private readonly elements: Record<PageName, HTMLElement>;
  private shown: PageName[] = ['agents'];
  private current = 0;
  private dotNodes: HTMLElement[] = [];
  private badge = el('span', 'page-dots__badge');

  constructor(container: HTMLElement, dots: HTMLElement, elements: Record<PageName, HTMLElement>) {
    this.container = container;
    this.dots = dots;
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
  show(names: PageName[], labels: Record<PageName, string>, waiting: number, waitingLabel: (n: number) => string): void {
    if (names.join() !== this.shown.join()) {
      const was = this.page;
      this.shown = names;
      for (const [name, page] of Object.entries(this.elements) as [PageName, HTMLElement][]) page.hidden = !names.includes(name);
      this.current = Math.max(0, names.indexOf(was));
      this.dotNodes = names.map(() => el('span', 'page-dots__dot'));
      this.dots.replaceChildren(...this.dotNodes);
      this.dots.hidden = names.length < 2;
      this.place('instant');
    }
    for (const [name, page] of Object.entries(this.elements) as [PageName, HTMLElement][]) page.setAttribute('aria-label', labels[name]);
    this.dotNodes.forEach((dot, i) => {
      dot.classList.toggle('page-dots__dot--current', i === this.current);
      dot.title = labels[this.shown[i]!];
    });
    // Only on another page: on the first one, what waits is in view.
    const count = this.current !== 0 && waiting > 0 ? String(waiting) : '';
    if (this.badge.textContent !== count) this.badge.textContent = count;
    this.badge.title = count ? waitingLabel(waiting) : '';
    const first = this.dotNodes[0];
    if (first && count && this.badge.parentElement !== first) first.append(this.badge);
    else if (!count) this.badge.remove();
    this.dots.classList.toggle('page-dots--waiting', count !== '');
  }

  /** Goes to a page by its place, smoothly unless told otherwise. */
  go(index: number, behavior: ScrollBehavior = 'smooth'): void {
    this.current = Math.min(Math.max(0, index), this.shown.length - 1);
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

  /** Where the scrolling came to rest is the page that shows; the others take no focus and no taps. */
  private settle(): void {
    const width = this.container.clientWidth;
    if (width > 0) this.current = Math.min(Math.max(0, Math.round(this.container.scrollLeft / width)), this.shown.length - 1);
    this.shown.forEach((name, i) => {
      this.elements[name].inert = i !== this.current;
    });
    this.dotNodes.forEach((dot, i) => dot.classList.toggle('page-dots__dot--current', i === this.current));
    if (this.current === 0) this.badge.remove();
    this.container.dataset.page = this.page;
  }
}
