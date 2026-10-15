// The list of open pull requests: what the hub asks GitHub, how it reads the answers, and how it fails.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GitHubWatcher, summarizeRuns } from '../src/hub/github.ts';

const TOKEN = `github_pat_${'x'.repeat(40)}`;
const SHA = (n: number) => String(n).repeat(40).slice(0, 40);

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A stand-in for GitHub: answers by path (without the query) and records every call. */
function fakeGitHub(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  let down = false;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (down) throw new TypeError('fetch failed');
    const route = routes[new URL(url).pathname];
    if (route === undefined) return new Response('{}', { status: 404 });
    if (typeof route === 'number') return new Response('{}', { status: route });
    return new Response(JSON.stringify(route), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls, routes, setDown: (value: boolean) => (down = value) };
}

const pull = (number: number, sha: string, updated: string, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Change ${number}`,
  draft: false,
  updated_at: updated,
  user: { login: 'stefan-azentrius' },
  head: { sha },
  ...extra,
});

function standardRoutes(): Record<string, unknown> {
  return {
    '/orgs/acme/repos': [{ name: 'api' }, { name: 'web' }, { name: 'old', archived: true }],
    '/repos/acme/api/pulls': [pull(1, SHA(1), '2026-10-15T10:00:00Z')],
    '/repos/acme/web/pulls': [pull(2, SHA(2), '2026-10-15T12:00:00Z', { draft: true, user: { login: 'dependabot[bot]' } })],
    '/repos/acme/old/pulls': [pull(9, SHA(9), '2026-10-15T13:00:00Z')],
    '/repos/acme/api/actions/runs': { workflow_runs: [{ status: 'completed', conclusion: 'success' }] },
    '/repos/acme/web/actions/runs': { workflow_runs: [{ status: 'in_progress', conclusion: null }] },
  };
}

function watcher(fake: ReturnType<typeof fakeGitHub>, log: string[] = []) {
  return new GitHubWatcher({ owner: 'acme', token: TOKEN, intervalMs: 60_000, fetch: fake.fetch, now: () => 1000, log: (l) => log.push(l) });
}

describe('the pull request list', () => {
  test('holds the open pull requests of active repositories, newest first, with their checks', async () => {
    const fake = fakeGitHub(standardRoutes());
    const w = watcher(fake);
    await w.poll();
    assert.equal(w.problem, null);
    assert.equal(w.syncedAt, 1000);
    assert.deepEqual(w.pullRequests, [
      { repo: 'web', number: 2, title: 'Change 2', author: 'dependabot[bot]', draft: true, updatedAt: Date.parse('2026-10-15T12:00:00Z'), checks: 'pending' },
      { repo: 'api', number: 1, title: 'Change 1', author: 'stefan-azentrius', draft: false, updatedAt: Date.parse('2026-10-15T10:00:00Z'), checks: 'passing' },
    ]);
    assert.ok(!fake.calls.some((c) => c.url.includes('/repos/acme/old/')), 'archived repositories are not asked');
  });

  test('asks api.github.com only, with the token as bearer, without following redirects', async () => {
    const fake = fakeGitHub(standardRoutes());
    await watcher(fake).poll();
    assert.ok(fake.calls.length > 0);
    for (const call of fake.calls) {
      assert.ok(call.url.startsWith('https://api.github.com/'), call.url);
      const headers = call.init?.headers as Record<string, string>;
      assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
      assert.equal(call.init?.redirect, 'error');
    }
    assert.ok(fake.calls.some((c) => c.url.endsWith(`/repos/acme/api/actions/runs?head_sha=${SHA(1)}&per_page=50`)));
  });

  test('falls back to a user when the owner is no organisation', async () => {
    const routes = standardRoutes();
    routes['/users/acme/repos'] = routes['/orgs/acme/repos'];
    delete routes['/orgs/acme/repos'];
    const w = watcher(fakeGitHub(routes));
    await w.poll();
    assert.equal(w.problem, null);
    assert.equal(w.pullRequests.length, 2);
  });

  test('a failed round keeps the last list and says why, once per problem', async () => {
    const fake = fakeGitHub(standardRoutes());
    const log: string[] = [];
    const w = watcher(fake, log);
    await w.poll();
    fake.routes['/orgs/acme/repos'] = 401;
    await w.poll();
    await w.poll();
    assert.equal(w.problem, 'rejected');
    assert.equal(w.pullRequests.length, 2, 'the last list stays');
    assert.equal(w.syncedAt, 1000);
    assert.equal(log.filter((l) => /rejected/.test(l)).length, 1);
    assert.doesNotMatch(log.join('\n'), new RegExp(TOKEN));

    fake.routes['/orgs/acme/repos'] = standardRoutes()['/orgs/acme/repos'];
    await w.poll();
    assert.equal(w.problem, null);
    assert.match(log.at(-1) ?? '', /reachable again/);
  });

  test('names the problem: rejected, forbidden, not found, unreachable, unexpected', async () => {
    for (const [status, problem] of [[401, 'rejected'], [403, 'forbidden'], [500, 'unexpected']] as const) {
      const routes = standardRoutes();
      routes['/orgs/acme/repos'] = status;
      const w = watcher(fakeGitHub(routes));
      await w.poll();
      assert.equal(w.problem, problem, String(status));
    }
    const missing = standardRoutes();
    delete missing['/orgs/acme/repos'];
    const w404 = watcher(fakeGitHub(missing));
    await w404.poll();
    assert.equal(w404.problem, 'not-found');

    const down = fakeGitHub(standardRoutes());
    down.setDown(true);
    const wDown = watcher(down);
    await wDown.poll();
    assert.equal(wDown.problem, 'unreachable');

    const odd = standardRoutes();
    odd['/repos/acme/api/pulls'] = [{ ...pull(1, 'not-a-sha', '2026-10-15T10:00:00Z') }];
    const wOdd = watcher(fakeGitHub(odd));
    await wOdd.poll();
    assert.equal(wOdd.problem, 'unexpected');
  });

  test('long titles are shortened', async () => {
    const routes = standardRoutes();
    routes['/repos/acme/api/pulls'] = [pull(1, SHA(1), '2026-10-15T10:00:00Z', { title: 'x'.repeat(300) })];
    const w = watcher(fakeGitHub(routes));
    await w.poll();
    assert.equal(w.pullRequests.find((pr) => pr.number === 1)?.title.length, 201);
  });

  test('a round still running is not started twice', async () => {
    const fake = fakeGitHub(standardRoutes());
    const w = watcher(fake);
    await Promise.all([w.poll(), w.poll()]);
    assert.equal(fake.calls.filter((c) => c.url.includes('/orgs/acme/repos')).length, 1);
  });
});

describe('checks of a pull request', () => {
  const run = (status: string | null, conclusion: string | null) => ({ status, conclusion });

  test('are summed up from the Actions runs of its head commit', () => {
    assert.equal(summarizeRuns([]), 'none');
    assert.equal(summarizeRuns([run('completed', 'success'), run('completed', 'skipped')]), 'passing');
    assert.equal(summarizeRuns([run('completed', 'success'), run('queued', null)]), 'pending');
    assert.equal(summarizeRuns([run('completed', 'action_required')]), 'pending');
    assert.equal(summarizeRuns([run('completed', 'success'), run('completed', 'failure')]), 'failing');
    assert.equal(summarizeRuns([run('completed', 'cancelled')]), 'failing');
    assert.equal(summarizeRuns([run('completed', 'timed_out')]), 'failing');
  });
});
