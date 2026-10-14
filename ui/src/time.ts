// Times as the display shows them.
//
// SPDX-License-Identifier: Apache-2.0

import type { Texts } from './i18n.ts';

/** Wall clock, hours and minutes. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** A running duration: 0:42, 12:05, 1:02:05. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** How long ago: "vor 3 s", "vor 4 min", "vor 2 h". */
export function ago(ms: number, texts: Texts): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 2) return texts.justNow;
  if (seconds < 60) return texts.ago(seconds, 's');
  if (seconds < 3600) return texts.ago(Math.floor(seconds / 60), 'min');
  return texts.ago(Math.floor(seconds / 3600), 'h');
}
