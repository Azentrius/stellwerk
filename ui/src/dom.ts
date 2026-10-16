// Small DOM helpers. Text from hook data only ever goes in as text, never as HTML.
//
// SPDX-License-Identifier: Apache-2.0

import { ICONS, type IconName } from './icons.ts';
import { splitCode, type Problem, type State } from './states.ts';

const SVG = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing`);
  return node as T;
}

/** An icon of the design system, as large as the text next to it and in its colour. */
export function icon(name: IconName, className = 'az-icon'): SVGSVGElement {
  const [viewBox, d] = ICONS[name];
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

/** A state as the design system's label: tint, icon and word say the same. */
export function label(state: State): HTMLSpanElement {
  const node = el('span', state.tone === 'neutral' ? 'az-label' : `az-label az-label--${state.tone}`);
  if (state.icon) node.append(icon(state.icon));
  node.append(state.text);
  return node;
}

/** An error as the design system's alert: what happened as its title, how to fix it below. */
export function alert(problem: Problem): HTMLDivElement {
  const node = el('div', 'az-alert az-alert--danger');
  node.setAttribute('role', 'alert');
  const mark = el('span', 'az-alert__icon');
  mark.append(icon('exclamation-circle'));
  const body = el('p', 'az-alert__body');
  for (const part of splitCode(problem.fix)) body.append(part.code ? el('code', undefined, part.text) : part.text);
  node.append(mark, el('p', 'az-alert__title', problem.title), body);
  return node;
}

/**
 * An entry of the agents, answers and pull request lists: the name in bold and a time on top, the details
 * and the state below. With `entry--short` the stylesheet puts it all in one line.
 */
export function entry(className: string, name: string, time: string, details: string, state: State): HTMLLIElement {
  const item = el('li', `entry ${className}`);
  const top = el('span', 'entry__line');
  top.append(el('span', 'entry__name', name), el('span', 'entry__time', time));
  const bottom = el('span', 'entry__line');
  bottom.append(el('span', 'entry__details', details), label(state));
  item.append(top, bottom);
  return item;
}
