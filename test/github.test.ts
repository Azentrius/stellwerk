// The list of open pull requests: what the hub asks GitHub, how it reads the answers, and how it fails.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GitHubWatcher, MAX_PAGES, nextPage, summarizeRuns } from '../src/hub/github.ts';

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
    assert.ok(fake.calls.some((c) => c.url.endsWith(`/repos/acme/api/actions/runs?head_sha=${SHA(1)}&per_page=100`)));
  });

  test("falls back to a user, with the private repositories the token may see, kept to that owner", async () => {
    const routes = standardRoutes();
    // Public ones only, as GitHub documents for this endpoint.
    routes['/users/acme/repos'] = [{ name: 'api' }, { name: 'old', archived: true }];
    // What the token may see: private ones of this owner, and others' it collaborates on.
    routes['/user/repos'] = [
      { name: 'web', private: true, owner: { login: 'Acme' } },
      { name: 'api', owner: { login: 'acme' } },
      { name: 'theirs', private: true, owner: { login: 'someone-else' } },
    ];
    routes['/repos/acme/theirs/pulls'] = [pull(7, SHA(7), '2026-10-15T14:00:00Z')];
    delete routes['/orgs/acme/repos'];
    const fake = fakeGitHub(routes);
    const w = watcher(fake);
    await w.poll();
    assert.equal(w.problem, null);
    assert.deepEqual(w.pullRequests.map((p) => p.repo).sort(), ['api', 'web'], 'the private one is there, the foreign one is not');
    assert.ok(!fake.calls.some((c) => c.url.includes('/repos/acme/theirs/')));
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

describe('lists over several pages', () => {
  /** GitHub with pages: each route is a list of pages, linked by "next" as GitHub does. */
  function pagedGitHub(routes: Record<string, unknown[]>, options: { nextHost?: string; failPage?: [string, number] } = {}) {
    const calls: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      const pages = routes[url.pathname];
      if (!pages) return new Response('{}', { status: 404 });
      const page = Number(url.searchParams.get('page') ?? '1');
      if (options.failPage && options.failPage[0] === url.pathname && options.failPage[1] === page) return new Response('{}', { status: 500 });
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (page < pages.length) {
        const next = new URL(url);
        if (options.nextHost) next.host = options.nextHost;
        next.searchParams.set('page', String(page + 1));
        headers.set('Link', `<${next}>; rel="next", <${url.origin}${url.pathname}?page=${pages.length}>; rel="last"`);
      }
      return new Response(JSON.stringify(pages[page - 1]), { status: 200, headers });
    }) as typeof globalThis.fetch;
    return { fetch, calls };
  }
  const watch = (fake: { fetch: typeof fetch }, log: string[] = []) =>
    new GitHubWatcher({ owner: 'acme', token: TOKEN, intervalMs: 60_000, fetch: fake.fetch, now: () => 1000, log: (l) => log.push(l) });

  test('repositories, pull requests and runs are read to the last page; a failed run on page 2 counts', async () => {
    const fake = pagedGitHub({
      '/orgs/acme/repos': [[{ name: 'api' }], [{ name: 'web' }]],
      '/repos/acme/api/pulls': [[pull(1, SHA(1), '2026-10-15T10:00:00Z')], [pull(3, SHA(3), '2026-10-15T11:00:00Z')]],
      '/repos/acme/web/pulls': [[pull(2, SHA(2), '2026-10-15T12:00:00Z')]],
      '/repos/acme/api/actions/runs': [
        { workflow_runs: [{ status: 'completed', conclusion: 'success' }] },
        { workflow_runs: [{ status: 'completed', conclusion: 'failure' }] },
      ],
      '/repos/acme/web/actions/runs': [{ workflow_runs: [{ status: 'completed', conclusion: 'success' }] }],
    });
    const w = watch(fake);
    await w.poll();
    assert.equal(w.problem, null);
    assert.deepEqual(w.pullRequests.map((p) => [p.repo, p.number, p.checks]), [
      ['web', 2, 'passing'],
      ['api', 3, 'failing'],
      ['api', 1, 'failing'],
    ]);
  });

  test('a "next" link to another host is not followed, so the token goes nowhere else', async () => {
    const fake = pagedGitHub({ '/orgs/acme/repos': [[{ name: 'api' }], [{ name: 'web' }]] }, { nextHost: 'evil.example' });
    const log: string[] = [];
    const w = watch(fake, log);
    await w.poll();
    assert.equal(w.problem, 'unexpected');
    assert.ok(fake.calls.every((url) => url.startsWith('https://api.github.com/')), fake.calls.join(' '));
  });

  test('a failure on a later page fails the round and keeps the last complete list', async () => {
    const routes = {
      '/orgs/acme/repos': [[{ name: 'api' }]],
      '/repos/acme/api/pulls': [[pull(1, SHA(1), '2026-10-15T10:00:00Z')], [pull(3, SHA(3), '2026-10-15T11:00:00Z')]],
      '/repos/acme/api/actions/runs': [{ workflow_runs: [] }],
    };
    const good = pagedGitHub(routes);
    const w = new GitHubWatcher({ owner: 'acme', token: TOKEN, intervalMs: 60_000, fetch: good.fetch, now: () => 1000 });
    await w.poll();
    assert.equal(w.pullRequests.length, 2);
    const failing = pagedGitHub(routes, { failPage: ['/repos/acme/api/pulls', 2] });
    (w as unknown as { fetch: typeof fetch }).fetch = failing.fetch;
    await w.poll();
    assert.equal(w.problem, 'unexpected');
    assert.equal(w.pullRequests.length, 2, 'the list from before, not a shortened one');
  });

  test(`more than ${MAX_PAGES} pages is a problem of its own, not a shortened list`, async () => {
    const pages = Array.from({ length: MAX_PAGES + 1 }, (_, i) => [{ name: `repo${i}` }]);
    const fake = pagedGitHub({ '/orgs/acme/repos': pages });
    const log: string[] = [];
    const w = watch(fake, log);
    await w.poll();
    assert.equal(w.problem, 'too-many');
    assert.equal(fake.calls.length, MAX_PAGES);
    assert.ok(log.some((l) => l.includes(`more than ${MAX_PAGES} pages`)));
  });

  test('the "next" link is read as GitHub writes it, and only on api.github.com', () => {
    const next = 'https://api.github.com/orgs/acme/repos?per_page=100&page=2';
    assert.equal(nextPage(`<${next}>; rel="next", <https://api.github.com/orgs/acme/repos?page=5>; rel="last"`), next);
    assert.equal(nextPage(`<https://api.github.com/x?page=1>; rel="prev", <${next}>; rel="next"`), next);
    assert.equal(nextPage(`<${next}>; rel="next last"`), next);
    assert.equal(nextPage('<https://api.github.com/x?page=1>; rel="prev"'), null, 'the last page');
    assert.equal(nextPage(null), null);
    assert.equal(nextPage('<https://evil.example/x?page=2>; rel="next"'), undefined);
    assert.equal(nextPage('<http://api.github.com/x?page=2>; rel="next"'), undefined);
    assert.equal(nextPage('<https://api.github.com.evil.example/x>; rel="next"'), undefined);
    assert.equal(nextPage('<https://user:pw@api.github.com/x>; rel="next"'), undefined);
    assert.equal(nextPage('<not a url>; rel="next"'), undefined);
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
