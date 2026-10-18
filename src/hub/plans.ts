// How much of each plan's usage limits is used. Codex records its limits in every token_count entry of its
// transcripts, and the context reader passes them on from there. The hub keeps the newest values per
// provider and remembers them in a file of its own, so the display has them again after a restart, before
// the next Codex event.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { PlanView, Provider } from '../shared/protocol.js';

const PROVIDERS: readonly Provider[] = ['claude', 'codex'];

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
