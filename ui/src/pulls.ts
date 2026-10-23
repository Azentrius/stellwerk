// Open pull requests of the configured owner, one line each: the state of its Actions runs as an icon
// (passed, failed, running; none leaves the place empty), the title, repository and number, author and
// draft, and how long ago it was updated. Most recently updated first (the hub sorts them). A tap opens it
// in the default browser.
//
// SPDX-License-Identifier: Apache-2.0

import type { PullRequestView } from '../../src/shared/protocol.js';
import { entry } from './dom.ts';
import type { Texts } from './i18n.ts';
import { checksState } from './states.ts';
import type { TapList } from './taps.ts';
import { ago } from './time.ts';

/** The key of a pull request in its list, which a tap hands back. */
export const pullKey = (pr: Pick<PullRequestView, 'repo' | 'number'>) => `${pr.repo}#${pr.number}`;

export function renderPulls(list: HTMLElement, taps: TapList, pulls: PullRequestView[], now: number, texts: Texts): void {
  taps.render(
    list,
    pulls.map((pr) => {
      const author = pr.author.replace(/\[bot\]$/, '');
      const details = [`${pr.repo} #${pr.number}`, author, pr.draft ? texts.draft : ''].filter(Boolean).join(' · ');
      const fresh = entry('pull entry--short', pr.title, ago(now - pr.updatedAt, texts), details, checksState(pr.checks, texts), {
        iconOnly: true,
      });
      return { key: pullKey(pr), fresh, tappable: true, hint: texts.openPull };
    }),
  );
}
