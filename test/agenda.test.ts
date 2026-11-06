// The calendar page's order of things, and the pages: which there are, and when the display goes back to
// the first.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CalendarView, EventView, PermissionView, SessionView, StateMessage, TaskView } from '../src/shared/protocol.js';
import { agendaDays, dayFromToday, dueOf, nowAndNext } from '../ui/src/agenda.ts';
import { Home, pagesOf, waitingKeys } from '../ui/src/paging.ts';

/** Friday, 6 November 2026, here. */
const at = (d: number, h = 0, mi = 0) => new Date(2026, 10, d, h, mi).getTime();
const NOW = at(6, 12);
const event = (title: string, start: number, end: number, allDay = false): EventView => ({ source: 'Work', title, start, end, allDay });
const task = (due: number | null, dueAllDay: boolean): TaskView => ({ source: 'Tasks', title: 't', due, dueAllDay, priority: null });

describe('the agenda', () => {
  test('the days from today that have events; all-day first, then by start; one over midnight on both days', () => {
    const days = agendaDays(
      [
        event('Late', at(6, 22), at(7, 1)),
        event('Lunch', at(6, 12), at(6, 13)),
        event('Holiday', at(9), at(11), true),
        event('Morning', at(6, 9), at(6, 10)),
        event('Fair', at(6), at(7), true),
        event('Reminder', at(8, 10), at(8, 10)),
      ],
      NOW,
    );
    assert.deepEqual(
      days.map((d) => [new Date(d.day).getDate(), d.events.map((e) => e.title)]),
      [
        [6, ['Fair', 'Morning', 'Lunch', 'Late']],
        [7, ['Late']],
        [8, ['Reminder']],
        [9, ['Holiday']],
        [10, ['Holiday']],
      ],
    );
  });

  test('now: the timed events running; next: the next timed one to start; all-day ones are neither', () => {
    const list = [event('All day', at(6), at(7), true), event('Running', at(6, 11), at(6, 13)), event('Later', at(6, 15), at(6, 16)), event('Soon', at(6, 12, 30), at(6, 13))];
    const { current, next } = nowAndNext(list, NOW);
    assert.deepEqual(current.map((e) => e.title), ['Running']);
    assert.equal(next?.title, 'Soon');
    assert.deepEqual(nowAndNext([event('Done', at(6, 9), at(6, 10))], NOW), { current: [], next: null });
  });

  test('which day from today: yesterday, today, tomorrow, across a change of the clock', () => {
    assert.equal(dayFromToday(at(5, 23), NOW), -1);
    assert.equal(dayFromToday(at(6, 0), NOW), 0);
    assert.equal(dayFromToday(at(7, 23, 59), NOW), 1);
    assert.equal(dayFromToday(new Date(2026, 9, 26, 12).getTime(), new Date(2026, 9, 24, 12).getTime()), 2, 'the day of the change is 25 h long');
  });

  test('a task is due: overdue by days, today, tomorrow, later; an all-day one until the end of its day', () => {
    assert.deepEqual(dueOf(task(null, false), NOW), { kind: 'none' });
    assert.deepEqual(dueOf(task(at(4), true), NOW), { kind: 'overdue', days: 2 });
    assert.deepEqual(dueOf(task(at(6), true), NOW), { kind: 'today', at: at(6), allDay: true }, 'due today: not overdue at noon');
    assert.deepEqual(dueOf(task(at(6, 9), false), NOW), { kind: 'overdue', days: 1 }, 'its time has passed this morning');
    assert.deepEqual(dueOf(task(at(6, 15), false), NOW), { kind: 'today', at: at(6, 15), allDay: false });
    assert.deepEqual(dueOf(task(at(7), true), NOW), { kind: 'tomorrow', at: at(7), allDay: true });
    assert.deepEqual(dueOf(task(at(12), true), NOW), { kind: 'later', at: at(12), allDay: true });
  });
});

describe('the pages', () => {
  const calendar: CalendarView = { events: [], tasks: [], updatedAt: null, problems: [] };
  const state = (parts: Partial<StateMessage>): StateMessage => ({ calendar: null, issues: null, permissions: [], sessions: [], ...parts }) as StateMessage;

  test('the agents always; the calendar page with a calendar or the issues assigned to me', () => {
    assert.deepEqual(pagesOf(null), ['agents']);
    assert.deepEqual(pagesOf(state({})), ['agents']);
    assert.deepEqual(pagesOf(state({ calendar })), ['agents', 'calendar']);
    assert.deepEqual(pagesOf(state({ issues: [] })), ['agents', 'calendar']);
  });

  test('something new that waits takes the display back to the first page; the same again does not', () => {
    const request = (id: string, outcome: PermissionView['outcome'] = null) => ({ id, outcome }) as PermissionView;
    const asking = { id: 's1', status: 'waiting', waitingFor: 'question', waitingSince: 5 } as SessionView;
    const home = new Home();
    assert.equal(home.update(waitingKeys(state({}))), false);
    assert.equal(home.update(waitingKeys(state({ permissions: [request('r1')] }))), true, 'a new request');
    assert.equal(home.update(waitingKeys(state({ permissions: [request('r1')] }))), false, 'still the same: one may swipe away');
    assert.equal(home.update(waitingKeys(state({ permissions: [request('r1', 'allowed')] }))), false, 'a decided one is nothing new');
    assert.equal(home.update(waitingKeys(state({ sessions: [asking] }))), true, 'an answer due in the app');
    assert.equal(home.update(waitingKeys(state({ sessions: [{ ...asking, waitingSince: 9 }] }))), true, 'the same session waiting anew');
  });
});
