// Calendars and task lists in iCalendar's format: what the hub takes of them, and what it refuses.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseProperty, parseRule, readCalendar, zoneOf } from '../src/hub/ics.ts';

/** A calendar file with these lines inside, with the line breaks iCalendar uses. */
const cal = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...lines, 'END:VCALENDAR', ''].join('\r\n');
const event = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const WIDE = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2028, 0, 1) };
const read = (text: string, window = WIDE) => {
  const result = readCalendar(text, window);
  assert.ok(result, 'an iCalendar');
  return result;
};
const starts = (text: string, window = WIDE) => read(text, window).events.map((e) => e.start);
/** Midnight of a date on this computer, where all-day events and dates lie. */
const midnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe('the file', () => {
  test('is taken only whole: no iCalendar, one cut off or one that does not close what it opens is none', () => {
    assert.equal(readCalendar('<html>not a calendar</html>', WIDE), null);
    assert.equal(readCalendar(cal(...event('DTSTART:20261106T100000Z')).replace('END:VCALENDAR', ''), WIDE), null, 'cut off');
    assert.equal(readCalendar(cal('BEGIN:VEVENT', 'DTSTART:20261106T100000Z', 'END:VTODO'), WIDE), null);
    assert.equal(readCalendar(cal('this is no content line'), WIDE), null);
    assert.deepEqual(read(cal()).events, []);
  });

  test('folded lines are joined; escaped commas, semicolons and line breaks are read; quoted parameters too', () => {
    const text = cal(...event('DTSTART;TZID="Europe/Berlin":20261106T090000', 'SUMMARY:Review\\, plan\\; and\\n', ' ship it'));
    const [one] = read(text).events;
    assert.equal(one?.title, 'Review, plan; and ship it');
    assert.equal(one?.start, Date.UTC(2026, 10, 6, 8));
    assert.deepEqual(parseProperty('DTSTART;TZID="a;b:c":1'), { name: 'DTSTART', params: new Map([['TZID', 'a;b:c']]), value: '1' });
  });

  test("an alarm inside an event does not change the event's title", () => {
    const text = cal(...event('DTSTART:20261106T100000Z', 'SUMMARY:Main', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'SUMMARY:Alarm', 'TRIGGER:-PT15M', 'END:VALARM'));
    assert.equal(read(text).events[0]?.title, 'Main');
  });

  test('long titles are cut, an event without one has an empty title', () => {
    const [long, none] = read(cal(...event('DTSTART:20261106T100000Z', `SUMMARY:${'x'.repeat(300)}`), ...event('DTSTART:20261106T110000Z'))).events;
    assert.equal(long?.title.length, 201);
    assert.equal(none?.title, '');
  });
});

describe('times and zones', () => {
  test('UTC, a named zone, Windows and Outlook names, a prefixed name; an unknown zone is taken here and named', () => {
    const at = (tzid: string) => read(cal(...event(`DTSTART;TZID=${tzid}:20261106T090000`)));
    assert.equal(read(cal(...event('DTSTART:20261106T090000Z'))).events[0]?.start, Date.UTC(2026, 10, 6, 9));
    for (const tzid of ['Europe/Berlin', 'W. Europe Standard Time', '"(UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien"', '/mozilla.org/20050126_1/Europe/Berlin']) {
      assert.equal(at(tzid).events[0]?.start, Date.UTC(2026, 10, 6, 8), tzid);
      assert.deepEqual(at(tzid).unknownZones, []);
    }
    assert.equal(at('America/New_York').events[0]?.start, Date.UTC(2026, 10, 6, 14), 'New York is back on standard time');
    const unknown = at('Mars Standard Time');
    assert.equal(unknown.events[0]?.start, new Date(2026, 10, 6, 9).getTime());
    assert.deepEqual(unknown.unknownZones, ['Mars Standard Time']);
    assert.equal(read(cal(...event('DTSTART:20261106T090000'))).events[0]?.start, new Date(2026, 10, 6, 9).getTime(), 'floating: here');
  });

  test("a zone defined in the file by its location; Windows names map to zones the computer knows", () => {
    const text = cal('BEGIN:VTIMEZONE', 'TZID:Custom Zone', 'X-LIC-LOCATION:Europe/Berlin', 'END:VTIMEZONE', ...event('DTSTART;TZID=Custom Zone:20261106T090000'));
    assert.equal(read(text).events[0]?.start, Date.UTC(2026, 10, 6, 8));
    assert.equal(zoneOf('Tokyo Standard Time'), 'Asia/Tokyo');
    assert.equal(zoneOf('Pacific Standard Time'), 'America/Los_Angeles');
    assert.equal(zoneOf('nowhere'), null);
  });

  test('around a change of the clock: a skipped time is taken with the offset before, a doubled one at its first', () => {
    const at = (wall: string) => read(cal(...event(`DTSTART;TZID=Europe/Berlin:${wall}`))).events[0]?.start;
    assert.equal(at('20260329T023000'), Date.UTC(2026, 2, 29, 1, 30), '02:30 does not exist: 03:30 summer time');
    assert.equal(at('20261025T023000'), Date.UTC(2026, 9, 25, 0, 30), '02:30 twice: the first, in summer time');
    assert.equal(at('20261025T013000'), Date.UTC(2026, 9, 24, 23, 30));
    assert.equal(at('20261025T033000'), Date.UTC(2026, 9, 25, 2, 30));
  });

  test('a repetition keeps its time of day across the change: 09:00 in summer and in winter', () => {
    const text = cal(...event('DTSTART;TZID=Europe/Berlin:20261019T090000', 'RRULE:FREQ=WEEKLY;COUNT=3'));
    assert.deepEqual(starts(text), [Date.UTC(2026, 9, 19, 7), Date.UTC(2026, 9, 26, 8), Date.UTC(2026, 10, 2, 8)]);
  });

  test('the end: DTEND, DURATION, or none (an instant)', () => {
    const [ends, lasts, none] = read(
      cal(
        ...event('DTSTART:20261106T100000Z', 'DTEND:20261106T110000Z'),
        ...event('DTSTART:20261106T120000Z', 'DURATION:PT1H30M'),
        ...event('DTSTART:20261106T150000Z'),
      ),
    ).events;
    assert.equal(ends?.end, Date.UTC(2026, 10, 6, 11));
    assert.equal(lasts?.end, Date.UTC(2026, 10, 6, 13, 30));
    assert.equal(none?.end, none?.start);
  });

  test('all-day events run from midnight to midnight here, the end day not included; without an end one day', () => {
    const [three, one] = read(cal(...event('DTSTART;VALUE=DATE:20261109', 'DTEND;VALUE=DATE:20261112', 'SUMMARY:Trip'), ...event('DTSTART;VALUE=DATE:20261113'))).events;
    assert.deepEqual(three, { title: 'Trip', start: midnight(2026, 11, 9), end: midnight(2026, 11, 12), allDay: true });
    assert.deepEqual([one?.start, one?.end, one?.allDay], [midnight(2026, 11, 13), midnight(2026, 11, 14), true]);
  });

  test('only what touches the window: an event that ended before or starts after it is left out', () => {
    const text = cal(
      ...event('DTSTART:20261101T100000Z', 'DTEND:20261101T110000Z', 'SUMMARY:before'),
      ...event('DTSTART:20261105T230000Z', 'DTEND:20261106T010000Z', 'SUMMARY:across'),
      ...event('DTSTART:20261106T100000Z', 'SUMMARY:inside'),
      ...event('DTSTART:20261108T000000Z', 'SUMMARY:after'),
    );
    const window = { from: Date.UTC(2026, 10, 6), to: Date.UTC(2026, 10, 8) };
    assert.deepEqual(read(text, window).events.map((e) => e.title), ['across', 'inside']);
  });
});

describe('repetitions', () => {
  test('weekly on two days, counted from the first', () => {
    const text = cal(...event('DTSTART:20261102T090000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4'));
    assert.deepEqual(starts(text), [Date.UTC(2026, 10, 2, 9), Date.UTC(2026, 10, 4, 9), Date.UTC(2026, 10, 9, 9), Date.UTC(2026, 10, 11, 9)]);
  });

  test('every other day until a day, that day included', () => {
    const text = cal(...event('DTSTART:20261101T080000Z', 'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261107T080000Z'));
    assert.deepEqual(starts(text), [1, 3, 5, 7].map((d) => Date.UTC(2026, 10, d, 8)));
  });

  test('monthly on the last Friday, on the last working day, and on the 31st (only months that have one)', () => {
    const lastFriday = cal(...event('DTSTART;TZID=Europe/Berlin:20261030T100000', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3'));
    assert.deepEqual(starts(lastFriday), [Date.UTC(2026, 9, 30, 9), Date.UTC(2026, 10, 27, 9), Date.UTC(2026, 11, 25, 9)]);
    const lastWorkday = cal(...event('DTSTART:20261030T160000Z', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3'));
    assert.deepEqual(starts(lastWorkday), [Date.UTC(2026, 9, 30, 16), Date.UTC(2026, 10, 30, 16), Date.UTC(2026, 11, 31, 16)]);
    const thirtyFirst = cal(...event('DTSTART:20261031T120000Z', 'RRULE:FREQ=MONTHLY;COUNT=3'));
    assert.deepEqual(starts(thirtyFirst), [Date.UTC(2026, 9, 31, 12), Date.UTC(2026, 11, 31, 12), Date.UTC(2027, 0, 31, 12)]);
  });

  test('a yearly birthday from long ago shows in this year', () => {
    const text = cal(...event('DTSTART;VALUE=DATE:19900312', 'RRULE:FREQ=YEARLY', 'SUMMARY:Birthday'));
    const window = { from: Date.UTC(2027, 2, 1), to: Date.UTC(2027, 3, 1) };
    assert.deepEqual(read(text, window).events, [{ title: 'Birthday', start: midnight(2027, 3, 12), end: midnight(2027, 3, 13), allDay: true }]);
  });

  test('yearly in given months on the n-th weekday: the second Sunday of May', () => {
    const text = cal(...event('DTSTART;VALUE=DATE:20270509', 'RRULE:FREQ=YEARLY;BYMONTH=5;BYDAY=2SU;COUNT=2'));
    assert.deepEqual(starts(text, { from: Date.UTC(2027, 0, 1), to: Date.UTC(2029, 0, 1) }), [midnight(2027, 5, 9), midnight(2028, 5, 14)]);
  });

  test('an excluded occurrence goes, a moved one stands where it went, a cancelled one goes', () => {
    const text = cal(
      ...event('UID:weekly-1', 'DTSTART:20261102T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE:20261109T090000Z', 'SUMMARY:Base'),
      ...event('UID:weekly-1', 'RECURRENCE-ID:20261116T090000Z', 'DTSTART:20261117T140000Z', 'SUMMARY:Moved'),
      ...event('UID:weekly-1', 'RECURRENCE-ID:20261123T090000Z', 'DTSTART:20261123T090000Z', 'STATUS:CANCELLED'),
    );
    assert.deepEqual(read(text).events.map((e) => [e.title, e.start]), [
      ['Base', Date.UTC(2026, 10, 2, 9)],
      ['Moved', Date.UTC(2026, 10, 17, 14)],
    ]);
  });

  test('additional dates (RDATE) are taken too; a cancelled event not at all', () => {
    const text = cal(
      ...event('DTSTART:20261102T090000Z', 'RDATE:20261105T090000Z,20261106T090000Z', 'SUMMARY:Extra'),
      ...event('DTSTART:20261103T090000Z', 'STATUS:CANCELLED', 'SUMMARY:Gone'),
    );
    assert.deepEqual(read(text).events.map((e) => [e.title, e.start]), [2, 5, 6].map((d) => ['Extra', Date.UTC(2026, 10, d, 9)]));
  });

  test('a repetition Stellwerk does not follow shows once at its start, and is counted', () => {
    const result = read(cal(...event('DTSTART:20261106T100000Z', 'RRULE:FREQ=HOURLY;COUNT=3')));
    assert.deepEqual(result.events.map((e) => e.start), [Date.UTC(2026, 10, 6, 10)]);
    assert.equal(result.unknownRules, 1);
  });

  test('rules Stellwerk follows, and the ones it does not', () => {
    assert.ok(parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;WKST=SU'));
    assert.ok(parseRule('FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=12'));
    for (const rule of ['FREQ=HOURLY', 'FREQ=WEEKLY;BYWEEKNO=3', 'FREQ=DAILY;COUNT=3;UNTIL=20261231', 'FREQ=YEARLY;BYDAY=20MO', 'FREQ=WEEKLY;BYDAY=2MO', 'FREQ=DAILY;INTERVAL=0', 'BYDAY=MO']) {
      assert.equal(parseRule(rule), null, rule);
    }
  });
});

describe('tasks', () => {
  test('the open ones with their due date and priority; done, cancelled and complete ones are left out', () => {
    const text = cal(
      'BEGIN:VTODO',
      'SUMMARY:Pay the invoice',
      'DUE;VALUE=DATE:20261110',
      'PRIORITY:1',
      'END:VTODO',
      'BEGIN:VTODO',
      'SUMMARY:Call back',
      'DUE;TZID=Europe/Berlin:20261107T150000',
      'PRIORITY:0',
      'END:VTODO',
      'BEGIN:VTODO',
      'SUMMARY:Someday',
      'END:VTODO',
      'BEGIN:VTODO',
      'SUMMARY:Done',
      'STATUS:COMPLETED',
      'END:VTODO',
      'BEGIN:VTODO',
      'SUMMARY:Also done',
      'COMPLETED:20261101T100000Z',
      'END:VTODO',
      'BEGIN:VTODO',
      'SUMMARY:Dropped',
      'STATUS:CANCELLED',
      'END:VTODO',
      'BEGIN:VTODO',
      'SUMMARY:Full',
      'PERCENT-COMPLETE:100',
      'END:VTODO',
    );
    assert.deepEqual(read(text).tasks, [
      { title: 'Pay the invoice', due: midnight(2026, 11, 10), dueAllDay: true, priority: 1 },
      { title: 'Call back', due: Date.UTC(2026, 10, 7, 14), dueAllDay: false, priority: null },
      { title: 'Someday', due: null, dueAllDay: false, priority: null },
    ]);
  });
});
