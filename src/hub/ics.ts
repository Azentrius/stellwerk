// Calendars and task lists in iCalendar's text format (RFC 5545), as a calendar's subscription link or the
// export of a Nextcloud list gives them. Read strictly and only as far as the display needs: the events in a
// window of time, with their time zones, repetitions and exceptions, and the open tasks. What it does not
// know (a time zone it cannot place, a repetition beyond the common ones) it notes, so the hub can say so
// once in its log; such an event is taken in the computer's own zone, or once at its start. Without the
// network and without the DOM, so the tests can use it.
//
// SPDX-License-Identifier: Apache-2.0

/** An event in the window: its start and end as instants; an all-day one from midnight to midnight here. */
export interface IcsEvent {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
}

/** An open task: its due date, if it has one (an all-day one at midnight here), and its priority 1 to 9. */
export interface IcsTask {
  title: string;
  due: number | null;
  dueAllDay: boolean;
  priority: number | null;
}

export interface IcsCalendar {
  /** The events that touch the window, by start. */
  events: IcsEvent[];
  /** The open tasks, in the order of the file. */
  tasks: IcsTask[];
  /** Time zones it could not place: such times are taken in the computer's own zone. */
  unknownZones: string[];
  /** Events whose repetition it does not follow: shown once at their start. */
  unknownRules: number;
}

/** Longer titles are cut; a title is typed by hand. */
const MAX_TITLE = 200;
/** At most this many events and tasks of one calendar are taken. */
export const MAX_ITEMS = 2000;
/** A repetition is followed through at most this many periods (days, weeks, months, years). */
const MAX_PERIODS = 50_000;
const DAY_MS = 86_400_000;

// ---------- lines and properties ----------

interface Property {
  name: string;
  params: Map<string, string>;
  value: string;
}

interface Component {
  name: string;
  properties: Property[];
}

/**
 * The property of a content line: `NAME;PARAM=value;PARAM="quoted":value`. Null for a line that is not one.
 */
export function parseProperty(line: string): Property | null {
  const name = /^[A-Za-z0-9-]+/.exec(line);
  if (!name) return null;
  let i = name[0].length;
  const params = new Map<string, string>();
  while (line[i] === ';') {
    i++;
    const key = /^[A-Za-z0-9-]+=/.exec(line.slice(i));
    if (!key) return null;
    i += key[0].length;
    const values: string[] = [];
    for (;;) {
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1);
        if (close < 0) return null;
        values.push(line.slice(i + 1, close));
        i = close + 1;
      } else {
        const plain = /^[^";:,]*/.exec(line.slice(i))![0];
        values.push(plain);
        i += plain.length;
      }
      if (line[i] !== ',') break;
      i++;
    }
    params.set(key[0].slice(0, -1).toUpperCase(), values.join(','));
  }
  if (line[i] !== ':') return null;
  return { name: name[0].toUpperCase(), params, value: line.slice(i + 1) };
}

/**
 * The events, tasks and time zones of a calendar file, each with its own properties (not those of a
 * component inside it, such as an alarm). Null when the text is no complete iCalendar: one that was cut
 * off on the way is not shown half.
 */
function components(text: string): { items: Component[]; zones: Map<string, string> } | null {
  // Lines are folded with a line break and one space or tab.
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) unfolded[unfolded.length - 1] += line.slice(1);
    else if (line !== '') unfolded.push(line);
  }
  if (unfolded[0]?.toUpperCase() !== 'BEGIN:VCALENDAR') return null;
  const stack: Component[] = [];
  const items: Component[] = [];
  const zones = new Map<string, string>();
  let ended = false;
  for (const line of unfolded) {
    if (ended) return null;
    const property = parseProperty(line);
    if (!property) return null;
    if (property.name === 'BEGIN') {
      stack.push({ name: property.value.toUpperCase(), properties: [] });
      continue;
    }
    if (property.name === 'END') {
      const done = stack.pop();
      if (!done || done.name !== property.value.toUpperCase()) return null;
      const parent = stack.at(-1)?.name;
      if (parent === 'VCALENDAR' && (done.name === 'VEVENT' || done.name === 'VTODO')) items.push(done);
      if (parent === 'VCALENDAR' && done.name === 'VTIMEZONE') {
        const id = done.properties.find((p) => p.name === 'TZID')?.value;
        const location = done.properties.find((p) => p.name === 'X-LIC-LOCATION')?.value;
        if (id && location) zones.set(id, location);
      }
      if (stack.length === 0) ended = true;
      continue;
    }
    stack.at(-1)?.properties.push(property);
  }
  return ended ? { items, zones } : null;
}

/** A text value: `\n` a line break, `\,` `\;` `\\` the character itself; here in one line, cut when long. */
function text(value: string): string {
  const plain = value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c)).replace(/\s+/g, ' ').trim();
  return plain.length > MAX_TITLE ? `${plain.slice(0, MAX_TITLE)}…` : plain;
}

// ---------- dates, times and zones ----------

/** A date and a time of day as written, without a zone. */
interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** Where a written time lies: UTC (…Z), a time zone, or the computer's own zone (no zone, or one not known). */
type Zone = { kind: 'utc' } | { kind: 'zone'; name: string } | { kind: 'local' };

/** A DATE or DATE-TIME value with its zone. */
interface Stamp {
  wall: Wall;
  date: boolean;
  zone: Zone;
}

/** The days since 1970-01-01 of a date. */
function dayNumber(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function dateOf(day: number): { y: number; m: number; d: number } {
  const date = new Date(day * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** 0 for Sunday to 6 for Saturday. */
function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const knownZones = new Map<string, boolean>();
/** Whether the computer knows a time zone by this name (Europe/Berlin, UTC …). */
function isZone(name: string): boolean {
  let known = knownZones.get(name);
  if (known === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: name });
      known = true;
    } catch {
      known = false;
    }
    knownZones.set(name, known);
  }
  return known;
}

/** Windows' names of time zones, as Outlook writes them, and the zone each stands for (from CLDR). */
const WINDOWS_ZONES: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'GTB Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Helsinki',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Egypt Standard Time': 'Africa/Cairo',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'Singapore Standard Time': 'Asia/Singapore',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'W. Australia Standard Time': 'Australia/Perth',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Atlantic Standard Time': 'America/Halifax',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Canada Central Standard Time': 'America/Regina',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Buenos_Aires',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC',
};

/** Outlook.com also names zones by their offset and cities: "(UTC+01:00) Amsterdam, Berlin, Bern …". */
const CITY_ZONES: [RegExp, string][] = [
  [/\bBerlin\b/, 'Europe/Berlin'],
  [/\b(Brussels|Brüssel|Paris|Madrid|Kopenhagen|Copenhagen)\b/, 'Europe/Paris'],
  [/\b(Belgrad|Belgrade|Budapest|Prag|Prague)\b/, 'Europe/Budapest'],
  [/\b(Sarajevo|Warschau|Warsaw|Zagreb)\b/, 'Europe/Warsaw'],
  [/\b(Dublin|Edinburgh|Lissabon|Lisbon|London)\b/, 'Europe/London'],
  [/\b(Athen|Athens|Bukarest|Bucharest)\b/, 'Europe/Bucharest'],
  [/\b(Helsinki|Kiew|Kyiv|Riga|Sofia|Tallinn|Vilnius)\b/, 'Europe/Helsinki'],
  [/\b(Moskau|Moscow)\b/, 'Europe/Moscow'],
  [/Eastern Time/, 'America/New_York'],
  [/Central Time/, 'America/Chicago'],
  [/Mountain Time/, 'America/Denver'],
  [/Pacific Time/, 'America/Los_Angeles'],
];

/**
 * The time zone a TZID stands for: a name the computer knows, the location its definition in the file
 * names, a Windows name, a known name at its end (/mozilla.org/…/Europe/Berlin) or a city in it; null when
 * none fits.
 */
export function zoneOf(tzid: string, defined: Map<string, string> = new Map()): string | null {
  const id = tzid.trim();
  if (isZone(id)) return id;
  const location = defined.get(tzid);
  if (location && isZone(location)) return location;
  const windows = WINDOWS_ZONES[id];
  if (windows && isZone(windows)) return windows;
  const tail = /([A-Za-z_]+\/[A-Za-z_-]+(?:\/[A-Za-z_-]+)?)$/.exec(id)?.[1];
  if (tail && isZone(tail)) return tail;
  for (const [city, zone] of CITY_ZONES) if (city.test(id) && isZone(zone)) return zone;
  return null;
}

const formats = new Map<string, Intl.DateTimeFormat>();
/** How far a zone's clock is ahead of UTC at an instant, in milliseconds. */
function offsetIn(zone: string, at: number): number {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formats.set(zone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(at).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour) % 24;
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant of a written time in its zone. As RFC 5545 says: a time the clock skips when it is put forward
 * is taken with the offset before the change (02:30 becomes 03:30), one it shows twice when it is put back
 * is the first of the two.
 */
function instant(wall: Wall, zone: Zone): number {
  if (zone.kind === 'utc') return Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.mi, wall.s);
  if (zone.kind === 'local') return new Date(wall.y, wall.m - 1, wall.d, wall.h, wall.mi, wall.s).getTime();
  const asUtc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.mi, wall.s);
  // The offsets half a day before and after: a change of the clock lies between them, or none does.
  const before = offsetIn(zone.name, asUtc - DAY_MS / 2);
  const after = offsetIn(zone.name, asUtc + DAY_MS / 2);
  const withBefore = asUtc - before;
  const withAfter = asUtc - after;
  const fitsBefore = offsetIn(zone.name, withBefore) === before;
  const fitsAfter = offsetIn(zone.name, withAfter) === after;
  if (fitsBefore && fitsAfter) return Math.min(withBefore, withAfter);
  if (fitsAfter) return withAfter;
  return withBefore;
}

/** Midnight of a date on this computer: all-day events and dates are days here. */
function localMidnight(day: number): number {
  const { y, m, d } = dateOf(day);
  return new Date(y, m - 1, d).getTime();
}

/** Reads DATE and DATE-TIME values with their zones; notes zones it cannot place. */
class Stamps {
  readonly unknown = new Set<string>();
  private readonly defined: Map<string, string>;

  constructor(defined: Map<string, string>) {
    this.defined = defined;
  }

  /** One value: 20261106, 20261106T090000, 20261106T080000Z; null for anything else. */
  read(value: string, params: Map<string, string>): Stamp | null {
    const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (date) {
      const wall = { y: Number(date[1]), m: Number(date[2]), d: Number(date[3]), h: 0, mi: 0, s: 0 };
      return valid(wall) ? { wall, date: true, zone: { kind: 'local' } } : null;
    }
    const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
    if (!time) return null;
    const wall = { y: Number(time[1]), m: Number(time[2]), d: Number(time[3]), h: Number(time[4]), mi: Number(time[5]), s: Number(time[6]) };
    if (!valid(wall)) return null;
    if (time[7]) return { wall, date: false, zone: { kind: 'utc' } };
    const tzid = params.get('TZID');
    if (tzid === undefined) return { wall, date: false, zone: { kind: 'local' } };
    const zone = zoneOf(tzid, this.defined);
    if (zone === null) this.unknown.add(tzid.slice(0, 100));
    return { wall, date: false, zone: zone === null ? { kind: 'local' } : { kind: 'zone', name: zone } };
  }

  /** All values of a list property (EXDATE, RDATE): comma-separated, each with the property's zone. */
  list(property: Property): Stamp[] {
    return property.value
      .split(',')
      .map((value) => this.read(value, property.params))
      .filter((stamp): stamp is Stamp => stamp !== null);
  }
}

function valid(wall: Wall): boolean {
  return (
    wall.y >= 1900 &&
    wall.y <= 2200 &&
    wall.m >= 1 &&
    wall.m <= 12 &&
    wall.d >= 1 &&
    wall.d <= daysInMonth(wall.y, wall.m) &&
    wall.h <= 23 &&
    wall.mi <= 59 &&
    wall.s <= 60
  );
}

/** The instant of a stamp; a date at midnight here. */
function instantOf(stamp: Stamp): number {
  return stamp.date ? localMidnight(dayNumber(stamp.wall.y, stamp.wall.m, stamp.wall.d)) : instant(stamp.wall, stamp.zone);
}

/** A DURATION (P1D, PT1H30M, P1W, -PT15M) as days and milliseconds; null for anything else. */
function duration(value: string): { days: number; ms: number } | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match || value.endsWith('P') || value.endsWith('T')) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const days = (Number(match[2] ?? 0) * 7 + Number(match[3] ?? 0)) * sign;
  const ms = ((Number(match[4] ?? 0) * 60 + Number(match[5] ?? 0)) * 60 + Number(match[6] ?? 0)) * 1000 * sign;
  return { days, ms };
}

// ---------- repetitions ----------

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: string | null;
  /** n: the n-th of the month (negative: from its end), 0 for every one. */
  byDay: { n: number; weekday: number }[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  weekStart: number;
}

/**
 * An RRULE, as far as Stellwerk follows it: FREQ daily to yearly, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY,
 * BYMONTH, BYSETPOS (monthly and yearly) and WKST. Null for anything else, such as hourly repetitions,
 * BYWEEKNO or a yearly BYDAY without BYMONTH.
 */
export function parseRule(value: string): Rule | null {
  const parts = new Map<string, string>();
  for (const part of value.split(';')) {
    const [key, val] = part.split('=');
    if (!key || val === undefined || parts.has(key.toUpperCase())) return null;
    parts.set(key.toUpperCase(), val.toUpperCase());
  }
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  const known = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST']);
  if ([...parts.keys()].some((key) => !known.has(key))) return null;
  const numbers = (key: string, min: number, max: number): number[] | null => {
    const raw = parts.get(key);
    if (raw === undefined) return [];
    const list = raw.split(',').map(Number);
    return list.every((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) >= min && Math.abs(n) <= max) ? list : null;
  };
  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1;
  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : null;
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return null;
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null;
  if (count !== null && parts.has('UNTIL')) return null;
  const byDay: Rule['byDay'] = [];
  for (const entry of parts.get('BYDAY')?.split(',') ?? []) {
    const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(entry);
    if (!match) return null;
    const n = match[1] ? Number(match[1]) : 0;
    if (Math.abs(n) > 53) return null;
    byDay.push({ n, weekday: WEEKDAYS.indexOf(match[2]!) });
  }
  const byMonthDay = numbers('BYMONTHDAY', 1, 31);
  const byMonth = numbers('BYMONTH', 1, 12);
  const bySetPos = numbers('BYSETPOS', 1, 366);
  if (!byMonthDay || !byMonth || !bySetPos || byMonth.some((m) => m < 0)) return null;
  const weekStart = parts.has('WKST') ? WEEKDAYS.indexOf(parts.get('WKST')!) : 1;
  if (weekStart < 0) return null;
  // Ordinals of weekdays only within a month; BYSETPOS only on a month's days.
  if (byDay.some((d) => d.n !== 0) && freq !== 'MONTHLY' && !(freq === 'YEARLY' && byMonth.length > 0)) return null;
  if (bySetPos.length > 0 && freq !== 'MONTHLY' && !(freq === 'YEARLY' && byMonth.length > 0)) return null;
  if (freq === 'YEARLY' && byMonth.length === 0 && (byDay.length > 0 || byMonthDay.length > 0)) return null;
  if (freq === 'WEEKLY' && byMonthDay.length > 0) return null;
  return { freq, interval, count, until: parts.get('UNTIL') ?? null, byDay, byMonthDay, byMonth, bySetPos, weekStart };
}

/** The days of a month the rule picks, in order. */
function monthDays(y: number, m: number, rule: Rule, startDay: number): number[] {
  const length = daysInMonth(y, m);
  const first = dayNumber(y, m, 1);
  let days: number[] | null = null;
  if (rule.byMonthDay.length > 0) days = rule.byMonthDay.map((n) => (n > 0 ? n : length + 1 + n)).filter((n) => n >= 1 && n <= length);
  if (rule.byDay.length > 0) {
    const picked = new Set<number>();
    for (const { n, weekday: wd } of rule.byDay) {
      const all: number[] = [];
      for (let d = 1; d <= length; d++) if (weekday(first + d - 1) === wd) all.push(d);
      if (n === 0) all.forEach((d) => picked.add(d));
      else {
        const d = n > 0 ? all[n - 1] : all[all.length + n];
        if (d !== undefined) picked.add(d);
      }
    }
    days = days === null ? [...picked] : days.filter((d) => picked.has(d));
  }
  if (days === null) {
    const { d } = dateOf(startDay);
    days = d <= length ? [d] : [];
  }
  days = [...new Set(days)].sort((a, b) => a - b);
  if (rule.bySetPos.length > 0) {
    const set = days;
    days = rule.bySetPos.map((p) => (p > 0 ? set[p - 1] : set[set.length + p])).filter((d): d is number => d !== undefined);
    days = [...new Set(days)].sort((a, b) => a - b);
  }
  return days.map((d) => first + d - 1);
}

/**
 * The days a rule repeats on, from its first day on, in order and without end: the first day itself first
 * (it always counts), then each later day the rule picks. The caller stops at COUNT, UNTIL or the window.
 */
function* repetitionDays(rule: Rule, startDay: number): Generator<number> {
  yield startDay;
  const start = dateOf(startDay);
  const inMonths = (day: number) => rule.byMonth.length === 0 || rule.byMonth.includes(dateOf(day).m);
  for (let k = 0; k < MAX_PERIODS; k++) {
    let days: number[];
    if (rule.freq === 'DAILY') {
      const day = startDay + k * rule.interval;
      const ok =
        inMonths(day) &&
        (rule.byMonthDay.length === 0 || monthDays(dateOf(day).y, dateOf(day).m, { ...rule, byDay: [], bySetPos: [] }, day).includes(day)) &&
        (rule.byDay.length === 0 || rule.byDay.some((d) => d.weekday === weekday(day)));
      days = ok ? [day] : [];
    } else if (rule.freq === 'WEEKLY') {
      const weekFirst = startDay - ((weekday(startDay) - rule.weekStart + 7) % 7) + 7 * k * rule.interval;
      const weekdays = rule.byDay.length > 0 ? rule.byDay.map((d) => d.weekday) : [weekday(startDay)];
      days = [...new Set(weekdays.map((wd) => weekFirst + ((wd - rule.weekStart + 7) % 7)))].sort((a, b) => a - b).filter(inMonths);
    } else if (rule.freq === 'MONTHLY') {
      const months = start.m - 1 + k * rule.interval;
      const y = start.y + Math.floor(months / 12);
      const m = (months % 12) + 1;
      days = rule.byMonth.length > 0 && !rule.byMonth.includes(m) ? [] : monthDays(y, m, rule, startDay);
    } else {
      const y = start.y + k * rule.interval;
      const months = rule.byMonth.length > 0 ? [...rule.byMonth].sort((a, b) => a - b) : [start.m];
      days = months.flatMap((m) =>
        rule.byDay.length > 0 || rule.byMonthDay.length > 0 ? monthDays(y, m, rule, startDay) : start.d <= daysInMonth(y, m) ? [dayNumber(y, m, start.d)] : [],
      );
    }
    for (const day of days) if (day > startDay) yield day;
  }
}

// ---------- events and tasks ----------

interface EventParts {
  uid: string | null;
  title: string;
  start: Stamp;
  /** An all-day event's length in days; a timed one's in milliseconds. */
  length: { days: number } | { ms: number };
  rule: Rule | null;
  /** The event repeats in a way Stellwerk does not follow. */
  unknownRule: boolean;
  extra: Stamp[];
  except: Stamp[];
  recurrenceId: Stamp | null;
  cancelled: boolean;
}

function eventParts(item: Component, stamps: Stamps): EventParts | null {
  const one = (name: string) => item.properties.find((p) => p.name === name);
  const all = (name: string) => item.properties.filter((p) => p.name === name);
  const dtstart = one('DTSTART');
  const start = dtstart ? stamps.read(dtstart.value, dtstart.params) : null;
  if (!start) return null;
  const dtend = one('DTEND');
  const end = dtend ? stamps.read(dtend.value, dtend.params) : null;
  const span = one('DURATION') ? duration(one('DURATION')!.value) : null;
  let length: EventParts['length'];
  if (start.date) {
    const startDay = dayNumber(start.wall.y, start.wall.m, start.wall.d);
    const days = end ? dayNumber(end.wall.y, end.wall.m, end.wall.d) - startDay : span ? span.days + Math.floor(span.ms / DAY_MS) : 1;
    length = { days: Math.max(1, days) };
  } else {
    const at = instantOf(start);
    const ms = end ? instantOf(end) - at : span ? span.days * DAY_MS + span.ms : 0;
    length = { ms: Math.max(0, ms) };
  }
  const rrule = one('RRULE');
  const rule = rrule ? parseRule(rrule.value) : null;
  const recurrence = one('RECURRENCE-ID');
  return {
    uid: one('UID')?.value ?? null,
    title: text(one('SUMMARY')?.value ?? ''),
    start,
    length,
    rule,
    unknownRule: rrule !== undefined && rule === null,
    extra: all('RDATE').flatMap((p) => (p.params.get('VALUE') === 'PERIOD' ? [] : stamps.list(p))),
    except: all('EXDATE').flatMap((p) => stamps.list(p)),
    recurrenceId: recurrence ? stamps.read(recurrence.value, recurrence.params) : null,
    cancelled: one('STATUS')?.value.toUpperCase() === 'CANCELLED',
  };
}

/** An event that starts at `at` (an all-day one on `day`). */
function eventAt(parts: EventParts, at: number, day: number | null): IcsEvent {
  if ('days' in parts.length) {
    const first = day ?? 0;
    return { title: parts.title, start: localMidnight(first), end: localMidnight(first + parts.length.days), allDay: true };
  }
  return { title: parts.title, start: at, end: at + parts.length.ms, allDay: false };
}

/** Which start an occurrence has, to match exceptions and changed occurrences: its day, or its instant. */
function keyOf(stamp: Stamp, allDay: boolean): number {
  return allDay ? dayNumber(stamp.wall.y, stamp.wall.m, stamp.wall.d) : instantOf(stamp);
}

/** The occurrences of a repeating event that touch the window. */
function occurrences(parts: EventParts, skip: Set<number>, window: { from: number; to: number }, out: IcsEvent[]): void {
  const rule = parts.rule!;
  const allDay = parts.start.date;
  const { wall } = parts.start;
  const startDay = dayNumber(wall.y, wall.m, wall.d);
  let until: number | null = null;
  if (rule.until !== null) {
    const stamp = new Stamps(new Map()).read(rule.until, new Map());
    if (stamp === null) return;
    // A date as UNTIL ends with that day; a time without a zone is in the event's zone.
    until = allDay
      ? dayNumber(stamp.wall.y, stamp.wall.m, stamp.wall.d)
      : stamp.date
        ? instant({ ...stamp.wall, h: 23, mi: 59, s: 59 }, parts.start.zone)
        : instant(stamp.wall, stamp.zone.kind === 'utc' ? stamp.zone : parts.start.zone);
  }
  let counted = 0;
  for (const day of repetitionDays(rule, startDay)) {
    if (rule.count !== null && counted >= rule.count) break;
    counted++;
    const date = dateOf(day);
    const at = allDay ? localMidnight(day) : instant({ ...wall, y: date.y, m: date.m, d: date.d }, parts.start.zone);
    if (until !== null && (allDay ? day : at) > until) break;
    if (at >= window.to) break;
    if (skip.has(allDay ? day : at)) continue;
    const event = eventAt(parts, at, allDay ? day : null);
    if (event.end > window.from || (event.end === event.start && event.start >= window.from)) out.push(event);
    if (out.length > MAX_ITEMS) return;
  }
}

/**
 * The events of a calendar file that touch the window, and its open tasks; null when the text is no
 * complete iCalendar.
 */
export function readCalendar(content: string, window: { from: number; to: number }): IcsCalendar | null {
  const parsed = components(content);
  if (!parsed) return null;
  const stamps = new Stamps(parsed.zones);
  const events: IcsEvent[] = [];
  const tasks: IcsTask[] = [];
  let unknownRules = 0;
  const masters: EventParts[] = [];
  const changed = new Map<string, EventParts[]>();
  const touches = (event: IcsEvent) => event.start < window.to && (event.end > window.from || (event.end === event.start && event.start >= window.from));

  for (const item of parsed.items) {
    if (item.name === 'VTODO') {
      if (tasks.length < MAX_ITEMS) {
        const task = taskOf(item, stamps);
        if (task) tasks.push(task);
      }
      continue;
    }
    const parts = eventParts(item, stamps);
    if (!parts) continue;
    if (parts.recurrenceId !== null && parts.uid !== null) changed.set(parts.uid, [...(changed.get(parts.uid) ?? []), parts]);
    else masters.push(parts);
  }

  for (const parts of masters) {
    if (parts.cancelled) continue;
    const allDay = parts.start.date;
    // Exceptions, and occurrences changed or cancelled on their own, leave the repetition.
    const skip = new Set(parts.except.map((stamp) => keyOf(stamp, allDay)));
    for (const one of parts.uid !== null ? (changed.get(parts.uid) ?? []) : []) skip.add(keyOf(one.recurrenceId!, allDay));
    if (parts.unknownRule) unknownRules++;
    if (parts.rule) occurrences(parts, skip, window, events);
    else {
      const event = eventAt(parts, instantOf(parts.start), allDay ? keyOf(parts.start, true) : null);
      if (touches(event)) events.push(event);
    }
    for (const stamp of parts.extra) {
      const key = keyOf(stamp, allDay);
      if (skip.has(key)) continue;
      const event = eventAt(parts, instantOf(stamp), allDay ? key : null);
      if (touches(event)) events.push(event);
    }
    if (events.length > MAX_ITEMS) break;
  }
  for (const list of changed.values()) {
    for (const parts of list) {
      if (parts.cancelled) continue;
      const event = eventAt(parts, instantOf(parts.start), parts.start.date ? keyOf(parts.start, true) : null);
      if (touches(event)) events.push(event);
    }
  }
  events.sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
  return { events: events.slice(0, MAX_ITEMS), tasks, unknownZones: [...stamps.unknown], unknownRules };
}

/** An open task; null for a done or cancelled one. */
function taskOf(item: Component, stamps: Stamps): IcsTask | null {
  const one = (name: string) => item.properties.find((p) => p.name === name);
  const status = one('STATUS')?.value.toUpperCase();
  if (status === 'COMPLETED' || status === 'CANCELLED' || one('COMPLETED') || one('PERCENT-COMPLETE')?.value === '100') return null;
  const dueProperty = one('DUE');
  const due = dueProperty ? stamps.read(dueProperty.value, dueProperty.params) : null;
  const priority = Number(one('PRIORITY')?.value ?? 0);
  return {
    title: text(one('SUMMARY')?.value ?? ''),
    due: due ? instantOf(due) : null,
    dueAllDay: due?.date ?? false,
    priority: Number.isInteger(priority) && priority >= 1 && priority <= 9 ? priority : null,
  };
}
