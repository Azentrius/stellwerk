// The calendars and task lists: what the hub asks their links, what it keeps, how it fails, and that a link
// never shows anywhere.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { CalendarWatcher, MAX_CALENDAR_BYTES, calendarAddress, calendarWindow, type CalendarSource } from '../src/hub/calendar.ts';
import { readCalendarSources, removeCalendarSource, saveCalendarSource } from '../src/token.ts';

const SECRET = 'q7Xn2pV9sLk4';
const WORK: CalendarSource = { name: 'Work', url: `https://outlook.example/owa/calendar/${SECRET}/calendar.ics` };
const TASKS: CalendarSource = { name: 'Tasks', url: 'https://cloud.example/remote.php/dav/calendars/stefan/tasks/?export', user: 'stefan', password: 'app-password-1' };
/** Friday, 6 November 2026, noon here. */
const NOW = new Date(2026, 10, 6, 12).getTime();
const local = (d: number, h = 0, mi = 0) => new Date(2026, 10, d, h, mi).getTime();
const stamp = (d: number, h: number) => `202611${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}0000`;

const cal = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n');
const vevent = (title: string, start: string, end: string) => ['BEGIN:VEVENT', `SUMMARY:${title}`, `DTSTART:${start}`, `DTEND:${end}`, 'END:VEVENT'];
const vtodo = (title: string, ...more: string[]) => ['BEGIN:VTODO', `SUMMARY:${title}`, ...more, 'END:VTODO'];

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A stand-in for the calendars' servers: an answer by link, which may be a Response, a status or throw. */
function fakeServers(answers: Record<string, string | number | (() => Response)>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const answer = answers[url];
    if (answer === undefined) return new Response('', { status: 404 });
    if (typeof answer === 'function') return answer();
    if (typeof answer === 'number') return new Response('', { status: answer });
    return new Response(answer, { status: 200, headers: { 'Content-Type': 'text/calendar' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls, answers };
}

function watcher(fake: ReturnType<typeof fakeServers>, log: string[] = [], sources = [WORK, TASKS]) {
  return new CalendarWatcher({ sources, intervalMs: 300_000, fetch: fake.fetch, now: () => NOW, log: (line) => log.push(line) });
}

const workCalendar = cal(
  ...vevent('Yesterday, done', stamp(5, 9), stamp(5, 10)),
  ...vevent('Overnight', stamp(5, 22), stamp(6, 2)),
  ...vevent('Standup', stamp(6, 9), '20261106T091500'),
  ...vevent('Next week, too far', stamp(13, 9), stamp(13, 10)),
  'BEGIN:VEVENT',
  'SUMMARY:Holiday',
  'DTSTART;VALUE=DATE:20261109',
  'DTEND;VALUE=DATE:20261110',
  'LOCATION:Somewhere private',
  'DESCRIPTION:Not for the display',
  'END:VEVENT',
);
const taskList = cal(
  ...vtodo('Someday'),
  ...vtodo('Tomorrow', 'DUE;VALUE=DATE:20261107', 'PRIORITY:5'),
  ...vtodo('Overdue', 'DUE;VALUE=DATE:20261104'),
  ...vtodo('Today, urgent', 'DUE;VALUE=DATE:20261106', 'PRIORITY:1'),
  ...vtodo('Done', 'STATUS:COMPLETED'),
);

describe('the calendars', () => {
  test("today's and the next six days' events of all calendars by start, and the open tasks, overdue first", async () => {
    const fake = fakeServers({ [WORK.url]: workCalendar, [TASKS.url]: taskList });
    const w = watcher(fake);
    await w.poll();
    const view = w.view();
    assert.deepEqual(view.problems, []);
    assert.equal(view.updatedAt, NOW);
    assert.deepEqual(
      view.events.map((e) => [e.source, e.title, e.allDay]),
      [
        ['Work', 'Overnight', false],
        ['Work', 'Standup', false],
        ['Work', 'Holiday', true],
      ],
      'yesterday left out, an event running into today kept, next week left out',
    );
    assert.deepEqual(Object.keys(view.events[2]!).sort(), ['allDay', 'end', 'source', 'start', 'title'], 'no place, no description');
    assert.deepEqual(view.events[2]!.start, local(9));
    assert.deepEqual(
      view.tasks.map((t) => [t.source, t.title]),
      [
        ['Tasks', 'Overdue'],
        ['Tasks', 'Today, urgent'],
        ['Tasks', 'Tomorrow'],
        ['Tasks', 'Someday'],
      ],
    );
  });

  test('asks the links only, GET without redirects; the app password only goes to its own list', async () => {
    const fake = fakeServers({ [WORK.url]: workCalendar, [TASKS.url]: taskList });
    await watcher(fake).poll();
    assert.deepEqual(fake.calls.map((c) => c.url).sort(), [WORK.url, TASKS.url].sort());
    for (const call of fake.calls) {
      assert.equal(call.init?.redirect, 'error');
      assert.equal(call.init?.method ?? 'GET', 'GET');
      assert.equal((call.init?.headers as Record<string, string>).Accept, 'text/calendar');
    }
    const auth = (url: string) => (fake.calls.find((c) => c.url === url)?.init?.headers as Record<string, string>).Authorization;
    assert.equal(auth(WORK.url), undefined);
    assert.equal(auth(TASKS.url), `Basic ${Buffer.from('stefan:app-password-1').toString('base64')}`);
  });

  test('a failed question keeps what the calendar gave, says why once, and again when it answers; never the link', async () => {
    const fake = fakeServers({ [WORK.url]: workCalendar, [TASKS.url]: taskList });
    const log: string[] = [];
    const w = watcher(fake, log);
    await w.poll();
    fake.answers[WORK.url] = 401;
    await w.poll();
    await w.poll();
    const view = w.view();
    assert.deepEqual(view.problems, [{ source: 'Work', problem: 'rejected' }]);
    assert.equal(view.events.length, 3, 'the events of before stay');
    assert.equal(log.filter((l) => l.includes('answered 401')).length, 1, log.join('\n'));
    assert.match(log.find((l) => l.includes('401'))!, /^Calendar "Work": the link or the app password was turned down\. .* The link answered 401\.$/);
    fake.answers[WORK.url] = workCalendar;
    await w.poll();
    assert.deepEqual(w.view().problems, []);
    assert.equal(log.at(-1), 'Calendar "Work" answers again.');
    const everything = JSON.stringify(w.view()) + log.join('\n');
    for (const secret of [SECRET, 'app-password-1', 'outlook.example', 'Somewhere private', 'Not for the display']) assert.ok(!everything.includes(secret), secret);
  });

  test('names the problem: turned down, gone, an odd answer, too large, no answer, out of time', async () => {
    const cases: [string | number | (() => Response), string, RegExp][] = [
      [403, 'rejected', /answered 403\./],
      [410, 'not-found', /answered 410\./],
      [500, 'unexpected', /answered 500\./],
      ['<html>login</html>', 'unexpected', /gave no complete iCalendar\./],
      [() => new Response('x', { status: 200, headers: { 'Content-Length': String(MAX_CALENDAR_BYTES + 1) } }), 'unexpected', /gave more than 2 MB\./],
      [() => new Response('x'.repeat(MAX_CALENDAR_BYTES + 1), { status: 200 }), 'unexpected', /gave more than 2 MB\./],
      [
        () => {
          throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) });
        },
        'unreachable',
        /got no answer \(ENOTFOUND\)\./,
      ],
      [
        () => {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        },
        'unreachable',
        /timed out after 15 s\./,
      ],
    ];
    for (const [answer, problem, line] of cases) {
      const log: string[] = [];
      const w = watcher(fakeServers({ [WORK.url]: answer }), log, [WORK]);
      await w.poll();
      assert.deepEqual(w.view().problems, [{ source: 'Work', problem }], String(line));
      assert.match(log.join('\n'), line);
    }
  });

  test("time zones it does not know are named once in the log, and taken as this computer's", async () => {
    const odd = cal('BEGIN:VEVENT', 'SUMMARY:Far away', 'DTSTART;TZID=Mars Standard Time:20261106T150000', 'END:VEVENT');
    const log: string[] = [];
    const w = watcher(fakeServers({ [WORK.url]: odd }), log, [WORK]);
    await w.poll();
    await w.poll();
    assert.equal(w.view().events[0]?.start, local(6, 15));
    assert.deepEqual(
      log.filter((l) => l.includes('Mars')),
      ['Calendar "Work": time zones it does not know, taken as this computer\'s: Mars Standard Time.'],
    );
  });

  test('the window is today here and the next six days', () => {
    assert.deepEqual(calendarWindow(NOW), { from: local(6), to: local(13) });
  });
});

describe('a calendar as set up', () => {
  test('its link: https, a webcal link as https; no other scheme, no user or password in it', () => {
    assert.equal(calendarAddress('https://calendar.google.com/calendar/ical/x/private-abc/basic.ics'), 'https://calendar.google.com/calendar/ical/x/private-abc/basic.ics');
    assert.equal(calendarAddress('webcal://p01-caldav.icloud.com/published/2/abc'), 'https://p01-caldav.icloud.com/published/2/abc');
    assert.equal(calendarAddress('  https://cloud.example/remote.php/dav/calendars/u/tasks/?export '), 'https://cloud.example/remote.php/dav/calendars/u/tasks/?export');
    for (const bad of ['http://calendar.example/a.ics', 'https://user:pw@calendar.example/a.ics', 'https://calendar.example/a.ics#x', 'file:///C:/a.ics', 'not a link', '']) {
      assert.equal(calendarAddress(bad), null, bad);
    }
  });

  test('is kept readable by the user only, replaced by name, and forgotten; the file goes with the last', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-calendars-')), 'calendars.json');
    assert.deepEqual(readCalendarSources(file), []);
    saveCalendarSource(file, WORK);
    saveCalendarSource(file, TASKS);
    const moved = { ...WORK, url: 'https://outlook.example/owa/calendar/other/calendar.ics' };
    saveCalendarSource(file, { ...moved, name: 'work' });
    assert.deepEqual(readCalendarSources(file), [{ ...moved, name: 'work' }, TASKS], 'same name in any case: replaced in its place');
    assert.equal(removeCalendarSource(file, 'nope'), false);
    assert.equal(removeCalendarSource(file, 'WORK'), true);
    assert.deepEqual(readCalendarSources(file), [TASKS]);
    assert.equal(removeCalendarSource(file, 'Tasks'), true);
    assert.equal(fs.existsSync(file), false);
    fs.writeFileSync(file, JSON.stringify([{ name: 'x', url: 'http://plain.example/a.ics' }]));
    assert.throws(() => readCalendarSources(file), /does not hold Stellwerk's calendars/);
  });
});
