// Dependabot's pull requests make way: those of one repository stand behind one line ("4 dependency
// updates"), so the ones by people stand out. The line has the worst checks of its pull requests and their
// conflicts, and the time of the newest; a tap opens it and shows them below it, and it closes again by
// itself a while after the last touch (fold.ts). A repository with only one keeps it as a line of its own.
// Without the DOM, so the tests can use it.
//
// SPDX-License-Identifier: Apache-2.0

import type { ChecksState, PullRequestView } from '../../src/shared/protocol.js';

/** The author of Dependabot's pull requests. */
export const DEPENDABOT = 'dependabot[bot]';

export interface UpdatesLine {
  repo: string;
  /** In the order the hub gave them: most recently updated first. */
  pulls: PullRequestView[];
  checks: ChecksState;
  conflict: boolean;
  updatedAt: number;
}

export type PullLine = { pull: PullRequestView } | { updates: UpdatesLine };

/** Worst first: one failed run makes the line fail, one still going makes it run. */
const WORST: ChecksState[] = ['failing', 'pending', 'passing', 'none'];

/**
 * The lines of the list, each where its newest pull request stands (the hub sorts most recently updated
 * first).
 */
export function pullLines(pulls: PullRequestView[]): PullLine[] {
  const updates = new Map<string, PullRequestView[]>();
  for (const pr of pulls) if (pr.author === DEPENDABOT) updates.set(pr.repo, [...(updates.get(pr.repo) ?? []), pr]);
  const lines: PullLine[] = [];
  const placed = new Set<string>();
  for (const pr of pulls) {
    const group = pr.author === DEPENDABOT ? updates.get(pr.repo)! : [];
    if (group.length < 2) {
      lines.push({ pull: pr });
      continue;
    }
    if (placed.has(pr.repo)) continue;
    placed.add(pr.repo);
    lines.push({
      updates: {
        repo: pr.repo,
        pulls: group,
        checks: WORST.find((checks) => group.some((p) => p.checks === checks)) ?? 'none',
        conflict: group.some((p) => p.conflict),
        updatedAt: Math.max(...group.map((p) => p.updatedAt)),
      },
    });
  }
  return lines;
}
