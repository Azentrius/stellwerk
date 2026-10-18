// How full an agent's context is, as the meter in front of it shows it: whole percent from 0 to 100, over
// a thin line. Grey while there is room; attention once it nears the end, where the app compacts. Pure, so
// the tests can use it; the meter itself is drawn in agents.ts.
//
// SPDX-License-Identifier: Apache-2.0

import type { ContextUsage } from '../../src/shared/protocol.js';

/** From this share on the meter needs attention. */
export const CONTEXT_FULL = 80;

/** How full, in whole percent from 0 to 100; null when not known. */
export function contextPercent(usage: ContextUsage | null): number | null {
  if (!usage || usage.size <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((usage.used / usage.size) * 100)));
}
