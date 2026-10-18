// The usage of the plans' limits, as the status column shows it below the hardware: per provider a title
// with how old the values are, and one row per limit, shortest window first, with when its window starts
// again; coloured by levels.ts. A window whose reset time has passed has started again and counts from
// zero. A model's own limit ("Fable") shows only once it needs attention, so the column stays short. Pure,
// so the tests can use it; the rows are drawn in hardware.ts.
//
// SPDX-License-Identifier: Apache-2.0

import type { PlanLimit, PlanView } from '../../src/shared/protocol.js';
import type { Texts } from './i18n.ts';
import { ATTENTION_PERCENT } from './levels.ts';
import { clock } from './time.ts';

const DAY_MS = 24 * 3_600_000;

/** The limits to show as of now: whole percent from 0 to 100, nothing used in a window that started again. */
export function currentLimits(plan: PlanView, now: number): PlanLimit[] {
  return plan.limits
    .map((limit): PlanLimit => {
      const restarted = limit.resetsAt !== null && limit.resetsAt <= now;
      return {
        ...limit,
        used: restarted ? 0 : Math.min(100, Math.max(0, Math.round(limit.used))),
        resetsAt: restarted ? null : limit.resetsAt,
      };
    })
    .filter((limit) => limit.model === undefined || limit.used >= ATTENTION_PERCENT);
}

/** The row's name: the window ("5 h", "Week"), or the model whose own limit it is. */
export function limitName(limit: PlanLimit, texts: Texts): string {
  return limit.model ?? texts.planWindow(limit.windowMinutes);
}

/** When the window starts again, short: the time within a day, the weekday after that. */
export function resetText(resetsAt: number | null, now: number, texts: Texts): string {
  if (resetsAt === null) return '';
  return texts.resets(resetsAt - now < DAY_MS ? clock(resetsAt) : texts.weekday(resetsAt));
}
