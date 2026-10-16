// Open pull requests of the configured owner, one line each: the title, repository and number, author and
// draft, the state of its Actions runs (passed, failed, running, none), and how long ago it was updated.
// Most recently updated first (the hub sorts them).
//
// SPDX-License-Identifier: Apache-2.0

import type { GitHubView, PullRequestView } from '../../src/shared/protocol.js';
import { entry } from './dom.ts';
import type { Texts } from './i18n.ts';
import { checksState } from './states.ts';
import { ago } from './time.ts';

export function renderPulls(list: HTMLElement, pulls: PullRequestView[], now: number, texts: Texts): void {
  list.replaceChildren(
    ...pulls.map((pr) => {
      const author = pr.author.replace(/\[bot\]$/, '');
      const details = [`${pr.repo} #${pr.number}`, author, pr.draft ? texts.draft : ''].filter(Boolean).join(' · ');
      return entry('pull entry--short', pr.title, ago(now - pr.updatedAt, texts), details, checksState(pr.checks, texts));
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
