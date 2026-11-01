// Dependabot's pull requests of a repository behind one line: which ones, where it stands, what it shows.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PullRequestView } from '../src/shared/protocol.js';
import { DEPENDABOT, pullLines } from '../ui/src/updates.ts';

const pull = (repo: string, number: number, updatedAt: number, extra: Partial<PullRequestView> = {}): PullRequestView => ({
  repo,
  number,
  title: `Change ${number}`,
  author: 'stefan-azentrius',
  draft: false,
  updatedAt,
  checks: 'passing',
  conflict: false,
  ...extra,
});
const bot = (repo: string, number: number, updatedAt: number, extra: Partial<PullRequestView> = {}) => pull(repo, number, updatedAt, { author: DEPENDABOT, ...extra });

/** The lines as short words: a pull request as repo#number, an updates line as repo[numbers]. */
const shape = (pulls: PullRequestView[]) =>
  pullLines(pulls).map((line) => ('pull' in line ? `${line.pull.repo}#${line.pull.number}` : `${line.updates.repo}[${line.updates.pulls.map((p) => p.number).join(',')}]`));

test("a repository's Dependabot pull requests stand behind one line, where the newest of them stands", () => {
  // Most recently updated first, as the hub sends them.
  const pulls = [bot('sanctum', 26, 9), bot('sanctum', 25, 8), pull('sanctum', 23, 7), bot('sanctum', 24, 6), bot('web', 4, 5), pull('lautwerk', 52, 4), bot('sanctum', 2, 3)];
  assert.deepEqual(shape(pulls), ['sanctum[26,25,24,2]', 'sanctum#23', 'web#4', 'lautwerk#52']);
});

test('one alone keeps its own line; other bots and people are never put together', () => {
  const pulls = [bot('web', 4, 5), pull('web', 3, 4, { author: 'renovate[bot]' }), pull('web', 2, 3, { author: 'renovate[bot]' }), pull('web', 1, 2)];
  assert.deepEqual(shape(pulls), ['web#4', 'web#3', 'web#2', 'web#1']);
  assert.deepEqual(shape([]), []);
});

test('the line has the worst checks, any conflict and the time of the newest', () => {
  const line = (pulls: PullRequestView[]) => {
    const [first] = pullLines(pulls);
    assert.ok(first && 'updates' in first);
    return first.updates;
  };
  const a = line([bot('api', 3, 30, { checks: 'passing' }), bot('api', 2, 20, { checks: 'failing' }), bot('api', 1, 10, { checks: 'pending' })]);
  assert.equal(a.checks, 'failing');
  assert.equal(a.conflict, false);
  assert.equal(a.updatedAt, 30);
  assert.equal(line([bot('api', 2, 20, { checks: 'none' }), bot('api', 1, 10, { checks: 'pending' })]).checks, 'pending');
  assert.equal(line([bot('api', 2, 20, { checks: 'none' }), bot('api', 1, 10, { checks: 'passing' })]).checks, 'passing');
  assert.equal(line([bot('api', 2, 20, { checks: 'none' }), bot('api', 1, 10, { checks: 'none' })]).checks, 'none');
  assert.equal(line([bot('api', 2, 20), bot('api', 1, 10, { conflict: true })]).conflict, true);
});
