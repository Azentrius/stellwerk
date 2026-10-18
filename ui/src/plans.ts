// The usage of the plans' limits, as the status column shows it below the hardware: per provider a title
// and one row per limit, shortest window first, with when its window starts again. A window whose reset
// time has passed has started again and counts from zero. Pure, so the tests can use it; the rows are
// drawn in hardware.ts.
//
// SPDX-License-Identifier: Apache-2.0

import type { PlanLimit, PlanView } from '../../src/shared/protocol.js';
import type { Texts } from './i18n.ts';
import { clock } from './time.ts';

/** From this share of a limit on, its row needs attention. */
export const PLAN_FULL = 80;
const DAY_MS = 24 * 3_600_000;

/** A limit as of now: whole percent from 0 to 100, and nothing used in a window that started again. */
export function currentLimits(plan: PlanView, now: number): PlanLimit[] {
  return plan.limits.map(({ used, windowMinutes, resetsAt }) =>
    resetsAt !== null && resetsAt <= now
      ? { used: 0, windowMinutes, resetsAt: null }
      : { used: Math.min(100, Math.max(0, Math.round(used))), windowMinutes, resetsAt },
  );
}

/** When the window starts again, short: the time within a day, the weekday after that. */
export function resetText(resetsAt: number | null, now: number, texts: Texts): string {
  if (resetsAt === null) return '';
  return texts.resets(resetsAt - now < DAY_MS ? clock(resetsAt) : texts.weekday(resetsAt));
}
