// Open pull requests of the configured owner, one line each: the state of its Actions runs as an icon
// (passed, failed, running; none leaves the place empty), "Draft" in front of the title of a draft, which is
// quieter, the repository, number and author, a conflict with its base, and how long ago it was updated.
// Most recently updated first (the hub sorts them). A tap opens it in the default browser. Dependabot's of
// one repository stand behind one line, which a tap opens (updates.ts).
//
// SPDX-License-Identifier: Apache-2.0

import type { PullRequestView } from '../../src/shared/protocol.js';
import { entry, icon, label } from './dom.ts';
import type { Texts } from './i18n.ts';
import { checksState, state } from './states.ts';
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
    fresh.querySelector('.entry__name')!.prepend(icon(open ? 'angle-down' : 'angle-right'));
    if (conflict) fresh.lastElementChild!.append(label(state('warning', texts.conflict)));
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
  if (pr.draft) {
    const draft = label(state('neutral', texts.draft));
    draft.classList.add('pull__draft');
    fresh.querySelector('.entry__name')!.before(draft);
  }
  if (pr.conflict) fresh.lastElementChild!.append(label(state('warning', texts.conflict)));
  return { key: pullKey(pr), fresh, tappable: true, hint: texts.openPull };
}
