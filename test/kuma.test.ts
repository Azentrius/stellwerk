// Uptime Kuma's monitors: what the hub reads from /metrics, how it asks (only /metrics at the address set
// up, the API key as the password, no redirects), since when a monitor fails, also over a restart of the
// hub, and how asking fails.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { uptimeKumaAddress } from '../src/config.ts';
import { RESUME_WITHIN_MS, UptimeKumaWatcher, parseSample, readMonitors } from '../src/hub/kuma.ts';

const URL_ = 'http://192.0.2.10:3001';
const KEY = `uk3_${'aB3-_'.repeat(8)}`;
const HEADER = '# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)\n# TYPE monitor_status gauge\n';

type Line = [id: number, name: string, status: number, type?: string];

/** /metrics as Uptime Kuma 2.x answers it, with other metrics around the monitors' status. */
function metrics(lines: Line[]): string {
  const labels = (id: number, name: string, type: string) =>
    `monitor_id="${id}",monitor_name="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}",monitor_type="${type}",` +
    'monitor_url="https://example.com",monitor_hostname="null",monitor_port="null"';
  return (
    '# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.\n# TYPE process_cpu_user_seconds_total counter\n' +
    'process_cpu_user_seconds_total 12.5\n' +
    '# HELP monitor_response_time Monitor Response Time (ms)\n# TYPE monitor_response_time gauge\n' +
    lines.map(([id, name, , type = 'http']) => `monitor_response_time{${labels(id, name, type)}} 42`).join('\n') +
    `\n${HEADER}` +
    lines.map(([id, name, status, type = 'http']) => `monitor_status{${labels(id, name, type)}} ${status}`).join('\n') +
    '\n'
  );
}

describe("reading Uptime Kuma's /metrics", () => {
  test('id, name and status of each monitor; other metrics and labels are left alone', () => {
    assert.deepEqual(
      readMonitors(metrics([[1, 'Server - web', 1], [2, 'Backup - web', 0, 'push'], [3, 'Shop', 2], [4, 'Docs', 3]])),
      [
        { id: '1', name: 'Server - web', status: 'up' },
        { id: '2', name: 'Backup - web', status: 'down' },
        { id: '3', name: 'Shop', status: 'pending' },
        { id: '4', name: 'Docs', status: 'maintenance' },
      ],
    );
    // Tags come as labels in front of the monitor's own.
    const tagged = `${HEADER}monitor_status{env="prod",team="",monitor_id="7",monitor_name="Tagged",monitor_type="http"} 1\n`;
    assert.deepEqual(readMonitors(tagged), [{ id: '7', name: 'Tagged', status: 'up' }]);
  });

  test('names keep their quotes, backslashes and characters; very long ones are cut', () => {
    assert.deepEqual(readMonitors(metrics([[1, 'Say "hi" \\ Grüße', 1]]))?.[0]?.name, 'Say "hi" \\ Grüße');
    assert.equal(readMonitors(metrics([[1, 'x'.repeat(300), 1]]))?.[0]?.name, `${'x'.repeat(200)}…`);
  });

  test('group monitors are left out, unknown values skipped, the last line of a monitor counts', () => {
    const text = `${metrics([[1, 'Group', 0, 'group'], [2, 'Odd', 7], [3, 'Half', 0.5]])}monitor_status{monitor_id="4",monitor_name="Twice",monitor_type="http"} 0\nmonitor_status{monitor_id="4",monitor_name="Twice",monitor_type="http"} 1\n`;
    assert.deepEqual(readMonitors(text), [{ id: '4', name: 'Twice', status: 'up' }]);
  });

  test('no monitors is an empty list; anything that is not these metrics is refused', () => {
    assert.deepEqual(readMonitors(HEADER), []);
    assert.equal(readMonitors('<!DOCTYPE html><html>Uptime Kuma</html>'), null);
    assert.equal(readMonitors('monitor_status{monitor_id="1",monitor_name="x"} 1\n'), null, 'without its TYPE line');
    assert.equal(readMonitors(`${HEADER}monitor_status{monitor_id="1"} 1\n`), null, 'without a name');
    assert.equal(readMonitors(`${HEADER}monitor_status{monitor_id="1",monitor_name="x} 1\n`), null, 'a broken label');
  });

  test("a sample's labels and value, in Prometheus' text format", () => {
    const sample = (text: string) => {
      const parsed = parseSample(text);
      return parsed && { labels: Object.fromEntries(parsed.labels), value: parsed.value };
    };
    assert.deepEqual(sample('{a="b",c="d \\"e\\" \\\\ \\n"} 1'), { labels: { a: 'b', c: 'd "e" \\ \n' }, value: 1 });
    assert.deepEqual(sample('{a="b",} 0 1700000000000'), { labels: { a: 'b' }, value: 0 }, 'a trailing comma and a time stamp');
    for (const broken of ['{a=b} 1', '{a="b"}', '{a="b"} x', '{a="b\\x"} 1', '{a="b"', 'a="b"} 1', '{1a="b"} 1', '{a="b" c="d"} 1']) {
      assert.equal(parseSample(broken), null, broken);
    }
  });
});

describe("Uptime Kuma's address", () => {
  test('http or https, a host and a port; kept without the slash', () => {
    assert.equal(uptimeKumaAddress('http://192.0.2.10:3001'), 'http://192.0.2.10:3001');
    assert.equal(uptimeKumaAddress('http://192.0.2.10:3001/'), 'http://192.0.2.10:3001');
    assert.equal(uptimeKumaAddress('https://status.example.com'), 'https://status.example.com');
  });

  test('no other scheme, no user, path, query or fragment', () => {
    for (const value of ['ftp://192.0.2.10', 'http://user:pw@192.0.2.10:3001', 'http://192.0.2.10:3001/metrics', 'http://x/?a=1', 'http://x/#f', 'file:///C:/x', '192.0.2.10:3001', '']) {
      assert.equal(uptimeKumaAddress(value), null, value);
    }
  });
});

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A stand-in for Uptime Kuma: answers with what `next` gives and notes every call. */
function fakeKuma(next: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return next(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const answer = (lines: Line[]) => new Response(metrics(lines), { status: 200, headers: { 'Content-Type': 'text/plain' } });

describe('asking Uptime Kuma', () => {
  test('asks only /metrics at its address, with the API key as the password, no redirects', async () => {
    const fake = fakeKuma(() => answer([[1, 'Server', 1]]));
    const w = new UptimeKumaWatcher({ url: URL_, key: KEY, intervalMs: 60_000, fetch: fake.fetch, now: () => 1000 });
    await w.poll();
    assert.deepEqual(w.view(), { monitors: { failing: [], up: 1, maintenance: 0 }, updatedAt: 1000, problem: null });
    assert.deepEqual(fake.calls.map((c) => c.url), ['http://192.0.2.10:3001/metrics']);
    assert.equal(fake.calls[0]!.init?.redirect, 'error');
    const headers = fake.calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Basic ${Buffer.from(`stellwerk:${KEY}`).toString('base64')}`);
  });

  test('counts what works and lists what fails: down first, the most recent first, since when it is seen so', async () => {
    let now = 1000;
    let lines: Line[] = [[1, 'Alpha', 1], [2, 'Bravo', 0], [3, 'Charlie', 2], [4, 'Delta', 3]];
    const w = new UptimeKumaWatcher({ url: URL_, key: KEY, intervalMs: 60_000, fetch: fakeKuma(() => answer(lines)).fetch, now: () => now });
    await w.poll();
    // Already failing at the first answer: the hub did not see it start.
    assert.deepEqual(w.monitors, {
      failing: [
        { id: '2', name: 'Bravo', status: 'down', since: null },
        { id: '3', name: 'Charlie', status: 'pending', since: null },
      ],
      up: 1,
      maintenance: 1,
    });
    now = 2000;
    lines = [[1, 'Alpha', 0], [2, 'Bravo', 0], [3, 'Charlie', 2], [4, 'Delta', 3]];
    await w.poll();
    assert.deepEqual(w.monitors?.failing, [
      { id: '1', name: 'Alpha', status: 'down', since: 2000 },
      { id: '2', name: 'Bravo', status: 'down', since: null },
      { id: '3', name: 'Charlie', status: 'pending', since: null },
    ]);
    now = 3000;
    lines = [[1, 'Alpha', 0], [2, 'Bravo', 1], [3, 'Charlie', 0], [5, 'Echo', 2]];
    await w.poll();
    assert.deepEqual(w.monitors, {
      failing: [
        { id: '3', name: 'Charlie', status: 'down', since: 3000 },
        { id: '1', name: 'Alpha', status: 'down', since: 2000 },
        { id: '5', name: 'Echo', status: 'pending', since: 3000 },
      ],
      up: 1,
      maintenance: 0,
    });
  });

  test('what changed while Uptime Kuma did not answer has no time', async () => {
    let now = 1000;
    let reachable = true;
    let lines: Line[] = [[1, 'Alpha', 1], [2, 'Bravo', 0]];
    const fetch = (async () => {
      if (!reachable) throw new TypeError('fetch failed');
      return answer(lines);
    }) as typeof globalThis.fetch;
    const w = new UptimeKumaWatcher({ url: URL_, key: KEY, intervalMs: 60_000, fetch, now: () => now });
    await w.poll();
    now = 2000;
    reachable = false;
    await w.poll();
    assert.deepEqual(w.view(), { monitors: null, updatedAt: 1000, problem: 'unreachable' });
    now = 3000;
    reachable = true;
    lines = [[1, 'Alpha', 0], [2, 'Bravo', 0]];
    await w.poll();
    assert.deepEqual(w.monitors?.failing, [
      { id: '1', name: 'Alpha', status: 'down', since: null },
      { id: '2', name: 'Bravo', status: 'down', since: null },
    ]);
  });

  test('a key turned down is reported once, never with the key; the monitors go away', async () => {
    const log: string[] = [];
    let refuse = false;
    const fake = fakeKuma(() => (refuse ? new Response('Unauthorized', { status: 401 }) : answer([[1, 'Alpha', 1]])));
    const w = new UptimeKumaWatcher({ url: URL_, key: KEY, intervalMs: 60_000, fetch: fake.fetch, log: (l) => log.push(l) });
    await w.poll();
    refuse = true;
    await w.poll();
    await w.poll();
    assert.equal(w.problem, 'rejected');
    assert.equal(w.monitors, null);
    refuse = false;
    await w.poll();
    assert.equal(w.problem, null);
    assert.equal(log.length, 2);
    assert.match(log[0]!, /^Uptime Kuma turned the API key down \(401\)/);
    assert.match(log[1]!, /answers again/);
    assert.doesNotMatch(log.join('\n'), new RegExp(KEY));
  });

  test('not reachable, an error page or something else than its metrics', async () => {
    const cases: Array<[() => Response | Promise<Response>, string]> = [
      [() => Promise.reject(new TypeError('fetch failed')), 'unreachable'],
      [() => new Response('', { status: 500 }), 'unexpected'],
      [() => new Response('<!DOCTYPE html><html></html>', { status: 200 }), 'unexpected'],
    ];
    for (const [next, problem] of cases) {
      const w = new UptimeKumaWatcher({ url: URL_, key: KEY, intervalMs: 60_000, fetch: fakeKuma(next).fetch });
      await w.poll();
      assert.equal(w.problem, problem);
      assert.equal(w.monitors, null);
    }
  });

  test('tells the hub after every round, so the display knows when it was asked', async () => {
    let changes = 0;
    const w = new UptimeKumaWatcher({ url: URL_, key: KEY, intervalMs: 60_000, fetch: fakeKuma(() => answer([[1, 'A', 1]])).fetch, onChange: () => changes++ });
    await w.poll();
    await w.poll();
    assert.equal(changes, 2);
  });
});

describe('since when, over a restart of the hub', () => {
  const stateFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-kuma-')), 'stellwerk', 'uptime-kuma.json');
  /** A run of the hub: a watcher with the state file and the monitors Uptime Kuma answers. */
  function run(file: string, lines: () => Line[], now: () => number, options: { url?: string; log?: (line: string) => void } = {}) {
    const w = new UptimeKumaWatcher({
      url: options.url ?? URL_,
      key: KEY,
      intervalMs: 60_000,
      stateFile: file,
      fetch: fakeKuma(() => answer(lines())).fetch,
      now,
      log: options.log,
    });
    w.load();
    return w;
  }
  /** The last run: Alpha, Bravo and Charlie fail since 2000; Delta was failing before it started. */
  async function lastRun(file: string) {
    let now = 1000;
    let lines: Line[] = [[1, 'Alpha', 1], [2, 'Bravo', 1], [3, 'Charlie', 1], [4, 'Delta', 0], [5, 'Echo', 3]];
    const w = run(file, () => lines, () => now);
    await w.poll();
    now = 2000;
    lines = [[1, 'Alpha', 0], [2, 'Bravo', 2], [3, 'Charlie', 0], [4, 'Delta', 0], [5, 'Echo', 3]];
    await w.poll();
    await w.flush();
  }

  test('only the times of failing monitors are kept: by id, without names', async () => {
    const file = stateFile();
    await lastRun(file);
    const text = fs.readFileSync(file, 'utf8');
    assert.deepEqual(JSON.parse(text), {
      url: URL_,
      at: 2000,
      failing: [
        { id: '1', status: 'down', since: 2000 },
        { id: '2', status: 'pending', since: 2000 },
        { id: '3', status: 'down', since: 2000 },
      ],
    });
    assert.doesNotMatch(text, /Alpha|Bravo|Charlie|Delta|Echo/);
    assert.doesNotMatch(text, new RegExp(KEY));
  });

  test('a restart a short while later keeps the time of what still fails the same way', async () => {
    const file = stateFile();
    await lastRun(file);
    let now = 2000 + RESUME_WITHIN_MS;
    let lines: Line[] = [[1, 'Alpha', 0], [2, 'Bravo', 0], [3, 'Charlie', 1], [4, 'Delta', 0], [5, 'Echo', 3]];
    const w = run(file, () => lines, () => now);
    await w.poll();
    assert.deepEqual(w.monitors?.failing, [
      // Still down: since 2000, as the last run saw it.
      { id: '1', name: 'Alpha', status: 'down', since: 2000 },
      // From pending to down while the hub was away: the hub did not see when.
      { id: '2', name: 'Bravo', status: 'down', since: null },
      // Already failing when the last run started: still no time.
      { id: '4', name: 'Delta', status: 'down', since: null },
    ]);
    // From then on as always: a change seen now happened since the last answer.
    now += 60_000;
    lines = [[1, 'Alpha', 0], [2, 'Bravo', 0], [3, 'Charlie', 0], [4, 'Delta', 0], [5, 'Echo', 3]];
    await w.poll();
    assert.deepEqual(w.monitors?.failing.find((m) => m.name === 'Charlie'), { id: '3', name: 'Charlie', status: 'down', since: now });
    await w.flush();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).at, now);
  });

  test("after a longer break, or for another Uptime Kuma, the last run's times are not taken", async () => {
    const lines = (): Line[] => [[1, 'Alpha', 0]];
    const file = stateFile();
    await lastRun(file);
    const late = run(file, lines, () => 2000 + RESUME_WITHIN_MS + 1);
    await late.poll();
    assert.deepEqual(late.monitors?.failing, [{ id: '1', name: 'Alpha', status: 'down', since: null }]);
    await late.flush();

    const other = stateFile();
    await lastRun(other);
    const elsewhere = run(other, lines, () => 3000, { url: 'http://192.0.2.11:3001' });
    await elsewhere.poll();
    assert.deepEqual(elsewhere.monitors?.failing, [{ id: '1', name: 'Alpha', status: 'down', since: null }]);
    await elsewhere.flush();
  });

  test('a broken file is reported and written again; a missing one is no message', async () => {
    const file = stateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ url: URL_, at: 'yesterday', failing: [] }));
    const log: string[] = [];
    const w = run(file, () => [[1, 'Alpha', 0]], () => 5000, { log: (line) => log.push(line) });
    await w.poll();
    await w.flush();
    assert.equal(log.length, 1);
    assert.match(log[0]!, /is not readable; it is written again/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { url: URL_, at: 5000, failing: [] });

    const quiet: string[] = [];
    run(stateFile(), () => [], () => 5000, { log: (line) => quiet.push(line) });
    assert.deepEqual(quiet, []);
  });

  test('a file that cannot be written is reported once, and the monitors still show', async () => {
    // A folder where the file should be.
    const file = stateFile();
    fs.mkdirSync(file, { recursive: true });
    const log: string[] = [];
    const w = run(file, () => [[1, 'Alpha', 0]], () => 5000, { log: (line) => log.push(line) });
    await w.poll();
    await w.poll();
    await w.flush();
    assert.equal(log.length, 1);
    assert.match(log[0]!, /^Uptime Kuma: /);
    assert.deepEqual(w.monitors?.failing, [{ id: '1', name: 'Alpha', status: 'down', since: null }]);
  });
});
