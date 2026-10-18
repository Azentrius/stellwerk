// How much of each plan's usage limits is used. Two local sources, no connection to anywhere:
//
// - Codex records its limits in every token_count entry of its transcripts; the context reader passes
//   them on from there.
// - The Claude desktop app gives its sessions a tool that reports the account's limits (`get_usage`).
//   When a session calls it, the PostToolUse hook carries the answer, and the hub takes the limits from it.
//
// The hub keeps the newest values per provider and remembers them in a file of its own, so the display has
// them again after a restart.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { PlanLimit, PlanView, Provider } from '../shared/protocol.js';

const PROVIDERS: readonly Provider[] = ['claude', 'codex'];
/** A model with a limit of its own, as the app names it ("Fable"). */
const MODEL_NAME = /^[A-Za-z0-9 ._-]{1,40}$/;

/** The desktop app's tool that reports the account's plan limits (and the calling session's context). */
export const CLAUDE_USAGE_TOOL = 'mcp__ccd_session_mgmt__get_usage';

const usageAnswer = z.object({
  plan: z.object({
    status: z.string().max(50),
    windows: z
      .array(z.object({ label: z.string().max(100), percentUsed: z.number(), resetsAt: z.string().max(50).nullish() }))
      .max(10)
      .default([]),
  }),
});

/**
 * The plan's limits from a PostToolUse of the app's usage tool, whose answer is JSON in a text block:
 * {plan: {status, windows: [{label: "5-hour limit" | "Weekly · all models" | "Weekly · Fable", percentUsed,
 * resetsAt}]}}. Anything else of the answer (the session's context) is not kept.
 */
export function claudePlanOfHook(body: unknown, at: number): PlanView | null {
  if (typeof body !== 'object' || body === null) return null;
  const { hook_event_name: event, tool_name: tool, tool_response: response } = body as Record<string, unknown>;
  if (event !== 'PostToolUse' || tool !== CLAUDE_USAGE_TOOL) return null;
  const parsed = usageAnswer.safeParse(answerOf(response));
  if (!parsed.success || parsed.data.plan.status !== 'ok') return null;
  const limits = parsed.data.plan.windows
    .flatMap(claudeLimit)
    .sort((a, b) => a.windowMinutes - b.windowMinutes || Number(a.model !== undefined) - Number(b.model !== undefined));
  return limits.length > 0 ? { provider: 'claude', limits, recordedAt: at } : null;
}

/** A tool's answer as the hook carries it: text blocks with JSON in them, or the value itself. */
function answerOf(response: unknown): unknown {
  const blocks = Array.isArray(response) ? response : [response];
  for (const block of blocks) {
    const text = typeof block === 'string' ? block : (block as { type?: unknown; text?: unknown } | null)?.text;
    if (typeof text !== 'string') continue;
    try {
      return JSON.parse(text);
    } catch {}
  }
  return Array.isArray(response) ? null : response;
}

/** One window by its label: the five hours, the week of all models, or the week of one model. */
function claudeLimit(window: { label: string; percentUsed: number; resetsAt?: string | null }): PlanLimit[] {
  const [kind = '', scope] = window.label.split('·').map((part) => part.trim());
  const windowMinutes = /5.?hour/i.test(kind) ? 300 : /week/i.test(kind) ? 10_080 : null;
  if (windowMinutes === null || !Number.isFinite(window.percentUsed)) return [];
  const model = scope && !/^all models$/i.test(scope) ? scope : undefined;
  if (model !== undefined && !MODEL_NAME.test(model)) return [];
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  return [
    {
      used: Math.min(100, Math.max(0, window.percentUsed)),
      windowMinutes,
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
      ...(model !== undefined ? { model } : {}),
    },
  ];
}

const storedPlans = z
  .array(
    z.object({
      provider: z.enum(['claude', 'codex']),
      limits: z
        .array(
          z.object({
            used: z.number().min(0).max(100),
            windowMinutes: z.number().int().positive(),
            resetsAt: z.number().nonnegative().nullable(),
            model: z.string().regex(MODEL_NAME).optional(),
          }),
        )
        .min(1)
        .max(4),
      recordedAt: z.number().nonnegative(),
    }),
  )
  .max(PROVIDERS.length);

export class PlanBook {
  /** Where the values are remembered; null keeps them in memory only. */
  readonly file: string | null;
  private readonly plans = new Map<Provider, PlanView>();
  private readonly log: (line: string) => void;
  private queue: Promise<void> = Promise.resolve();

  constructor(file: string | null, log: (line: string) => void = () => {}) {
    this.file = file;
    this.log = log;
  }

  /** Takes the values remembered by the last run; a missing or broken file leaves the book empty. */
  load(): void {
    if (!this.file) return;
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return;
    }
    let stored: z.infer<typeof storedPlans>;
    try {
      stored = storedPlans.parse(JSON.parse(text));
    } catch {
      this.log(`Plans: ${this.file} is not readable; it is written again with the next values.`);
      return;
    }
    for (const plan of stored) this.plans.set(plan.provider, plan);
  }

  /** Newer values of a provider replace the ones kept; true when they did. */
  offer(plan: PlanView): boolean {
    const kept = this.plans.get(plan.provider);
    if (kept && kept.recordedAt >= plan.recordedAt) return false;
    this.plans.set(plan.provider, plan);
    this.save();
    return true;
  }

  /** One entry per provider with values, in a fixed order. */
  view(): PlanView[] {
    return PROVIDERS.flatMap((provider) => this.plans.get(provider) ?? []);
  }

  /** Waits for the writes started so far (tests, closing). */
  flush(): Promise<void> {
    return this.queue;
  }

  private save(): void {
    const file = this.file;
    if (!file) return;
    const text = `${JSON.stringify(this.view())}\n`;
    // One write after the other, so the last values are the ones that stay.
    this.queue = this.queue
      .then(async () => {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, text, { encoding: 'utf8', mode: 0o600 });
      })
      .catch((err: Error) => this.log(`Plans: ${err.message}`));
  }
}
