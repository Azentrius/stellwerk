// The calendar page's order of things: the days with their events, the event running now and the next one,
// and when a task is due. Days are those of this computer, from midnight to midnight. Without the DOM, so
// the tests can use it.
//
// SPDX-License-Identifier: Apache-2.0

import type { EventView, TaskView } from '../../src/shared/protocol.js';

const DAY_MS = 86_400_000;

/** Midnight of the day an instant lies in, here. */
export function midnightOf(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The midnight `n` days after the one given, here (a day with a change of the clock is not 24 h long). */
function daysLater(midnight: number, n: number): number {
  const d = new Date(midnight);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/** How many days lie between two midnights here. */
function daysBetween(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS);
}

export interface AgendaDay {
  /** Midnight of the day. */
  day: number;
  /** All-day events first, then by start. */
  events: EventView[];
}

/**
 * The days from today on that have events, each with every event that touches it: one of several days, or
 * one that runs over midnight, on each of its days.
 */
export function agendaDays(events: EventView[], now: number, days = 7): AgendaDay[] {
  const today = midnightOf(now);
  const result: AgendaDay[] = [];
  for (let i = 0; i < days; i++) {
    const day = daysLater(today, i);
    const next = daysLater(today, i + 1);
    const on = events.filter((e) => (e.start === e.end ? e.start >= day && e.start < next : e.start < next && e.end > day));
    if (on.length === 0) continue;
    on.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.end - b.end);
    result.push({ day, events: on });
  }
  return result;
}

/** The timed events running now, and the next timed one to start; all-day events are neither. */
export function nowAndNext(events: EventView[], now: number): { current: EventView[]; next: EventView | null } {
  const timed = events.filter((e) => !e.allDay);
  return {
    current: timed.filter((e) => e.start <= now && now < e.end),
    next: timed.filter((e) => e.start > now).sort((a, b) => a.start - b.start)[0] ?? null,
  };
}

/** Which day an instant is from today here: 0 today, 1 tomorrow, -1 yesterday. */
export function dayFromToday(ms: number, now: number): number {
  return daysBetween(midnightOf(now), midnightOf(ms));
}

export type Due = { kind: 'none' } | { kind: 'overdue'; days: number } | { kind: 'today' | 'tomorrow' | 'later'; at: number; allDay: boolean };

/** When a task is due: an all-day one is due until the end of its day, a timed one until its time. */
export function dueOf(task: TaskView, now: number): Due {
  if (task.due === null) return { kind: 'none' };
  const day = dayFromToday(task.due, now);
  const passed = task.dueAllDay ? day < 0 : task.due < now;
  if (passed) return { kind: 'overdue', days: Math.max(1, -day) };
  return { kind: day === 0 ? 'today' : day === 1 ? 'tomorrow' : 'later', at: task.due, allDay: task.dueAllDay };
}
