// Open pull requests of the configured owner, one line each: a signal for the Actions runs (green passed,
// red failed, ring still running, grey none), the title, repository and number, author, and how long ago
// it was updated. Most recently updated first (the hub sorts them).
//
// SPDX-License-Identifier: Apache-2.0

import type { GitHubView, PullRequestView } from '../../src/shared/protocol.js';
import { el } from './dom.ts';
import type { Texts } from './i18n.ts';
import { ago } from './time.ts';

export function renderPulls(list: HTMLElement, pulls: PullRequestView[], now: number, texts: Texts): void {
  list.replaceChildren(
    ...pulls.map((pr) => {
      const item = el('li', `pull pull--${pr.checks}`);
      const signal = el('span', `signal signal--checks-${pr.checks}`);
      signal.title = texts.checks[pr.checks];
      const author = pr.author.replace(/\[bot\]$/, '');
      const detail = [`${pr.repo} #${pr.number}`, author, pr.draft ? texts.draft : ''].filter(Boolean).join(' · ');
      item.append(signal, el('span', 'pull__title', pr.title), el('span', 'pull__detail', detail), el('span', 'pull__age', ago(now - pr.updatedAt, texts)));
      return item;
    }),
  );
}

/** The line in the status column: when GitHub was last asked, or why it failed. Empty without a token. */
export function githubLine(github: GitHubView | null, now: number, texts: Texts): { text: string; problem: boolean } | null {
  if (!github) return null;
  if (github.problem) return { text: texts.github.problem[github.problem], problem: true };
  if (github.syncedAt === null) return { text: texts.github.asking, problem: false };
  return { text: texts.github.synced(ago(now - github.syncedAt, texts)), problem: false };
}
