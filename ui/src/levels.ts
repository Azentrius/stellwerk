// How full a meter is, as its colour says it: grey while there is room, attention from 80 %, red from
// 90 %. The same for an agent's context (the app compacts it at about 97 %) and a plan's limits. Pure, so
// the tests can use it.
//
// SPDX-License-Identifier: Apache-2.0

/** From this share on a meter needs attention. */
export const ATTENTION_PERCENT = 80;
/** From this share on a meter is red: little is left. */
export const CRITICAL_PERCENT = 90;

export function meterTone(percent: number | null): 'neutral' | 'warning' | 'danger' {
  if (percent === null || percent < ATTENTION_PERCENT) return 'neutral';
  return percent < CRITICAL_PERCENT ? 'warning' : 'danger';
}
