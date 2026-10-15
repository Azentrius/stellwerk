// The list of open pull requests. Every few minutes the hub asks api.github.com, and nothing else, with
// a read-only fine-grained token: the owner's repositories, their open pull requests, and for each the
// Actions runs on its head commit. Every answer is checked before it is used; a failed round keeps the
// last list and says why.
//
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import type { ChecksState, GitHubProblem, GitHubView, PullRequestView } from '../shared/protocol.js';

export const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TITLE = 200;
/** Questions for the checks of several pull requests at the same time. */
const PARALLEL = 4;

const repositories = z.array(
  z.object({ name: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), archived: z.boolean().optional(), disabled: z.boolean().optional() }),
);
const pulls = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string(),
    draft: z.boolean().optional(),
    updated_at: z.string(),
    user: z.object({ login: z.string().max(100) }).nullable().optional(),
    head: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
  }),
);
const runs = z.object({
  workflow_runs: z.array(z.object({ status: z.string().nullable(), conclusion: z.string().nullable() })),
});

type Run = z.infer<typeof runs>['workflow_runs'][number];

const FAILED = new Set(['failure', 'timed_out', 'startup_failure', 'cancelled']);

/**
 * Any run still going or waiting for approval: pending; otherwise any failed: failing; otherwise passing;
 * no runs at all: none.
 */
export function summarizeRuns(list: Run[]): ChecksState {
  if (list.length === 0) return 'none';
  if (list.some((run) => run.status !== 'completed' || run.conclusion === 'action_required')) return 'pending';
  if (list.some((run) => FAILED.has(run.conclusion ?? ''))) return 'failing';
  return 'passing';
}

class GitHubFailure extends Error {
  readonly problem: GitHubProblem;
  readonly status: number | null;
  constructor(problem: GitHubProblem, status: number | null = null) {
    super(problem);
    this.problem = problem;
    this.status = status;
  }
}

export interface GitHubWatcherOptions {
  owner: string;
  token: string;
  intervalMs: number;
  /** For tests; the global fetch otherwise. */
  fetch?: typeof fetch;
  now?: () => number;
  onChange?: () => void;
  log?: (line: string) => void;
}

export class GitHubWatcher {
  pullRequests: PullRequestView[] = [];
  syncedAt: number | null = null;
  problem: GitHubProblem | null = null;
  private readonly options: GitHubWatcherOptions;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;

  constructor(options: GitHubWatcherOptions) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  view(): GitHubView {
    return { owner: this.options.owner, syncedAt: this.syncedAt, problem: this.problem };
  }

  /** One round; a round still running is not started twice. */
  poll(): Promise<void> {
    this.polling ??= this.round().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async round(): Promise<void> {
    const before = this.problem;
    try {
      const found: Array<{ view: PullRequestView; sha: string }> = [];
      for (const repo of await this.repositories()) {
        const list = await this.get(`/repos/${this.owner}/${encodeURIComponent(repo)}/pulls?state=open&per_page=50`, pulls);
        for (const pr of list) {
          found.push({
            sha: pr.head.sha,
            view: {
              repo,
              number: pr.number,
              title: pr.title.length > MAX_TITLE ? `${pr.title.slice(0, MAX_TITLE)}…` : pr.title,
              author: pr.user?.login ?? '',
              draft: pr.draft ?? false,
              updatedAt: Date.parse(pr.updated_at) || 0,
              checks: 'none',
            },
          });
        }
      }
      for (let i = 0; i < found.length; i += PARALLEL) {
        await Promise.all(
          found.slice(i, i + PARALLEL).map(async (item) => {
            const path = `/repos/${this.owner}/${encodeURIComponent(item.view.repo)}/actions/runs?head_sha=${item.sha}&per_page=50`;
            item.view.checks = summarizeRuns((await this.get(path, runs)).workflow_runs);
          }),
        );
      }
      this.pullRequests = found.map((item) => item.view).sort((a, b) => b.updatedAt - a.updatedAt);
      this.syncedAt = this.now();
      this.problem = null;
      if (before !== null) this.options.log?.('GitHub: reachable again.');
    } catch (err) {
      this.problem = err instanceof GitHubFailure ? err.problem : 'unreachable';
      // Once per new problem, not every round.
      if (this.problem !== before) this.options.log?.(`GitHub: ${describeProblem(this.problem)}`);
    } finally {
      this.options.onChange?.();
    }
  }

  private get owner(): string {
    return encodeURIComponent(this.options.owner);
  }

  /** The owner's repositories that are neither archived nor disabled; an organisation or else a user. */
  private async repositories(): Promise<string[]> {
    let list: z.infer<typeof repositories>;
    try {
      list = await this.get(`/orgs/${this.owner}/repos?type=all&per_page=100`, repositories);
    } catch (err) {
      if (!(err instanceof GitHubFailure) || err.status !== 404) throw err;
      list = await this.get(`/users/${this.owner}/repos?type=owner&per_page=100`, repositories);
    }
    return list.filter((repo) => !repo.archived && !repo.disabled).map((repo) => repo.name);
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetch(`${GITHUB_API}${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.options.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'stellwerk',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GitHubFailure('unreachable');
    }
    if (!response.ok) {
      const problem: GitHubProblem =
        response.status === 401 ? 'rejected' : response.status === 403 ? 'forbidden' : response.status === 404 ? 'not-found' : 'unexpected';
      throw new GitHubFailure(problem, response.status);
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new GitHubFailure('unexpected', response.status);
    return parsed.data;
  }
}

export function describeProblem(problem: GitHubProblem): string {
  switch (problem) {
    case 'rejected':
      return 'the token was rejected (401). Create a new one and run "stellwerk github token" again.';
    case 'forbidden':
      return 'no access, or the rate limit is reached (403). The token needs "Pull requests: Read" and "Actions: Read".';
    case 'not-found':
      return 'owner not found, or the token has no access to it (404).';
    case 'unreachable':
      return 'api.github.com is not reachable.';
    case 'unexpected':
      return 'unexpected answer from api.github.com.';
  }
}
