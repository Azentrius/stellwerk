// Open pull requests of the configured owner, one line each: the state of its Actions runs as an icon
// (passed, failed, running; none leaves the place empty), marks in front of the title (a conflict with its
// base, a draft, whose title is quieter), the repository, number and author, and how long ago it was
// updated. Most recently updated first (the hub sorts them). A tap opens it in the default browser.
// Dependabot's of one repository stand behind one line, which a tap opens (updates.ts).
//
// SPDX-License-Identifier: Apache-2.0

import type { PullRequestView } from '../../src/shared/protocol.js';
import { el, entry, icon } from './dom.ts';
import type { Texts } from './i18n.ts';
import type { IconName } from './icons.ts';
import { checksState } from './states.ts';
import type { TapEntry, TapList } from './taps.ts';
import { ago } from './time.ts';
import { pullLines } from './updates.ts';

/** The key of a pull request in its list, which a tap hands back. */
export const pullKey = (pr: Pick<PullRequestView, 'repo' | 'number'>) => `${pr.repo}#${pr.number}`;

const UPDATES = 'updates:';
/** The key of a repository's line of Dependabot's pull requests (a repository's name has no colon). */
export const updatesKey = (repo: string) => `${UPDATES}${repo}`;
/** The repository of an updates line's key; null for a pull request's. */
export const updatesRepo = (key: string) => (key.startsWith(UPDATES) ? key.slice(UPDATES.length) : null);

/** `isOpen` says whether a repository's updates line is open. */
export function renderPulls(
  list: HTMLElement,
  taps: TapList,
  pulls: PullRequestView[],
  isOpen: (repo: string) => boolean,
  now: number,
  texts: Texts,
): void {
  const entries: TapEntry[] = [];
  for (const line of pullLines(pulls)) {
    if ('pull' in line) {
      entries.push(pullEntry(line.pull, false, now, texts));
      continue;
    }
    const { repo, pulls: updates, checks, conflict, updatedAt } = line.updates;
    const open = isOpen(repo);
    const fresh = entry('pull pull--updates entry--short', texts.updates(updates.length), ago(now - updatedAt, texts), `${repo} · dependabot`, checksState(checks, texts), {
      iconOnly: true,
    });
    const name = fresh.querySelector('.entry__name')!;
    if (conflict) name.prepend(mark('exclamation-triangle', 'warning', texts.conflict));
    name.prepend(icon(open ? 'angle-down' : 'angle-right'));
    entries.push({ key: updatesKey(repo), fresh, tappable: true, hint: open ? texts.hideUpdates : texts.showUpdates, expanded: open });
    if (open) entries.push(...updates.map((pr) => pullEntry(pr, true, now, texts)));
  }
  taps.render(list, entries);
}

/** A pull request's line; `nested` below its updates line. */
function pullEntry(pr: PullRequestView, nested: boolean, now: number, texts: Texts): TapEntry {
  const author = pr.author.replace(/\[bot\]$/, '');
  const className = `pull entry--short${pr.draft ? ' pull--draft' : ''}${nested ? ' pull--nested' : ''}`;
  const fresh = entry(className, pr.title, ago(now - pr.updatedAt, texts), `${pr.repo} #${pr.number} · ${author}`, checksState(pr.checks, texts), {
    iconOnly: true,
  });
  const name = fresh.querySelector('.entry__name')!;
  if (pr.draft) name.prepend(mark('pencil-alt', 'neutral', texts.draft));
  if (pr.conflict) name.prepend(mark('exclamation-triangle', 'warning', texts.conflict));
  return { key: pullKey(pr), fresh, tappable: true, hint: texts.openPull };
}

/** A mark in front of a title, an icon alone; its word is its name for screen readers. */
function mark(name: IconName, tone: 'neutral' | 'warning', text: string): HTMLSpanElement {
  const node = el('span', `pull__mark pull__mark--${tone}`);
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', text);
  node.append(icon(name));
  return node;
}
