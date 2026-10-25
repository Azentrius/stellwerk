// The hardware values: LibreHardwareMonitor's settings file, which values the hub picks from data.json,
// how it asks (only 127.0.0.1:8085, with the password from the settings) and how it fails.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  HardwareKeeper,
  HardwareWatcher,
  RESTART_AFTER_MS,
  RESTART_EVERY_MS,
  STARTING_MS,
  LHM_URL,
  appSettingsXml,
  lhmAuthorization,
  parseAppSettings,
  pickValues,
  readSensors,
  sensorNumber,
} from '../src/hub/hardware.ts';

const sensor = (id: string, name: string, type: string, raw: string) => ({
  id: 0,
  Text: name,
  Min: '',
  Value: raw,
  Max: '',
  SensorId: id,
  Type: type,
  RawMin: '',
  RawValue: raw,
  RawMax: '',
  ImageURL: 'images/transparent.png',
  Children: [],
});
const node = (text: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 0,
  Text: text,
  Min: '',
  Value: '',
  Max: '',
  ImageURL: 'images_icon/computer.png',
  Children: children,
  ...extra,
});

/** data.json of a laptop with an Intel processor, the graphics built in and an Nvidia card, on a German Windows. */
function laptop() {
  return node('Sensor', [
    node('DEV-LAPTOP', [
      node('12th Gen Intel Core i7-12700H', [
        node('Load', [sensor('/intelcpu/0/load/0', 'CPU Total', 'Load', '23,4 %'), sensor('/intelcpu/0/load/1', 'CPU Core Max', 'Load', '80,0 %')]),
        node('Temperatures', [
          sensor('/intelcpu/0/temperature/0', 'CPU Core #1', 'Temperature', '70,0 °C'),
          sensor('/intelcpu/0/temperature/13', 'CPU Package', 'Temperature', '61,0 °C'),
          sensor('/intelcpu/0/temperature/14', 'Core Max', 'Temperature', '72,0 °C'),
        ]),
      ], { HardwareId: '/intelcpu/0' }),
      node('Total Memory', [
        node('Load', [sensor('/ram/load/0', 'Memory', 'Load', '45,2 %')]),
        node('Data', [sensor('/ram/data/0', 'Memory Used', 'Data', '14,3 GB'), sensor('/ram/data/1', 'Memory Available', 'Data', '17,4 GB')]),
      ], { HardwareId: '/ram' }),
      node('Virtual Memory', [node('Load', [sensor('/vram/load/1', 'Memory', 'Load', '60,0 %')])], { HardwareId: '/vram' }),
      node('Intel(R) UHD Graphics', [node('Load', [sensor('/gpu-intel-integrated/%5C%5C%3F/load/0', 'D3D 3D', 'Load', '5,0 %')])], {
        HardwareId: '/gpu-intel-integrated/%5C%5C%3F',
      }),
      node('NVIDIA GeForce RTX 3080 Ti Laptop GPU', [
        node('Temperatures', [
          sensor('/gpu-nvidia/0/temperature/0', 'GPU Core', 'Temperature', '48,0 °C'),
          sensor('/gpu-nvidia/0/temperature/2', 'GPU Hot Spot', 'Temperature', '55,0 °C'),
        ]),
        node('Load', [sensor('/gpu-nvidia/0/load/0', 'GPU Core', 'Load', '3,0 %'), sensor('/gpu-nvidia/0/load/3', 'GPU Memory', 'Load', '10,0 %')]),
      ], { HardwareId: '/gpu-nvidia/0' }),
    ]),
  ]);
}

const LAPTOP_VALUES = {
  cpu: { load: 23.4, temperature: 61 },
  gpu: { load: 3, temperature: 48 },
  memory: { load: 45.2, used: 14.3, total: 31.7 },
};

describe('LibreHardwareMonitor settings file', () => {
  test('is read as it writes it and written the same way, values escaped', () => {
    const written = '﻿<?xml version="1.0" encoding="utf-8"?>\r\n<configuration>\r\n  <appSettings>\r\n' +
      '    <add key="listenerPort" value="8085" />\r\n    <add key="note" value="a &amp; &quot;b&quot; &lt;c&gt; &#xA;" />\r\n' +
      '  </appSettings>\r\n</configuration>';
    const settings = parseAppSettings(written);
    assert.deepEqual([...settings], [['listenerPort', '8085'], ['note', 'a & "b" <c> \n']]);
    assert.deepEqual([...parseAppSettings(appSettingsXml(settings))], [...settings]);
  });

  test('gives the Basic authorization only when the password check is on', () => {
    assert.equal(lhmAuthorization(new Map([['authenticationEnabled', 'false']])), null);
    const settings = new Map([
      ['authenticationEnabled', 'true'],
      ['authenticationUserName', 'stellwerk'],
      ['authenticationPassword', 'abc123'],
    ]);
    assert.equal(lhmAuthorization(settings), `Basic ${Buffer.from('stellwerk:abc123').toString('base64')}`);
  });
});

describe('the values from data.json', () => {
  test('numbers are read with a decimal comma or point; anything else is no value', () => {
    assert.equal(sensorNumber('45,5 °C'), 45.5);
    assert.equal(sensorNumber('12.0 %'), 12);
    assert.equal(sensorNumber('-3,0 °C'), -3);
    assert.equal(sensorNumber(' °C'), null);
    assert.equal(sensorNumber(''), null);
    assert.equal(sensorNumber(undefined), null);
  });

  test('processor, the separate graphics card before the built-in one, memory', () => {
    const sensors = readSensors(laptop());
    assert.ok(sensors);
    assert.deepEqual(pickValues(sensors), LAPTOP_VALUES);
  });

  test('an AMD processor reports its temperature as Tctl/Tdie; missing parts are null', () => {
    const data = node('Sensor', [
      node('PC', [
        node('AMD Ryzen 7 7700X', [
          node('Load', [sensor('/amdcpu/0/load/0', 'CPU Total', 'Load', '7.5 %')]),
          node('Temperatures', [sensor('/amdcpu/0/temperature/2', 'Core (Tctl/Tdie)', 'Temperature', '65.5 °C')]),
        ], { HardwareId: '/amdcpu/0' }),
      ]),
    ]);
    assert.deepEqual(pickValues(readSensors(data)!), { cpu: { load: 7.5, temperature: 65.5 }, gpu: null, memory: null });
  });

  test('a sensor without a value is skipped (processor temperatures without the driver)', () => {
    const data = node('Sensor', [
      node('PC', [
        node('CPU', [
          node('Load', [sensor('/intelcpu/0/load/0', 'CPU Total', 'Load', '10,0 %')]),
          node('Temperatures', [sensor('/intelcpu/0/temperature/13', 'CPU Package', 'Temperature', ' °C')]),
        ]),
        node('iGPU', [node('Load', [sensor('/gpu-intel-integrated/x/load/0', 'GPU Core', 'Load', '2,0 %')])]),
      ]),
    ]);
    assert.deepEqual(pickValues(readSensors(data)!), { cpu: { load: 10, temperature: null }, gpu: { load: 2, temperature: null }, memory: null });
  });

  test('something that is not a sensor tree is refused', () => {
    assert.equal(readSensors({ Text: 'x' }), null);
    assert.equal(readSensors([]), null);
    assert.equal(readSensors(node('Sensor', [{ Text: 1, Children: [] }])), null);
  });
});

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A stand-in for LibreHardwareMonitor's web server: answers with what `next` gives, records every call. */
function fakeLhm(next: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return next(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const authorization = (call: Call) => (call.init?.headers as Record<string, string>).Authorization;

function settingsFile(password: string | null): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-lhm-')), 'LibreHardwareMonitor.config');
  if (password !== null) writeSettings(file, password);
  return file;
}

function writeSettings(file: string, password: string): void {
  const settings = new Map([
    ['authenticationEnabled', 'true'],
    ['authenticationUserName', 'stellwerk'],
    ['authenticationPassword', password],
  ]);
  fs.writeFileSync(file, appSettingsXml(settings));
}

const basic = (password: string) => `Basic ${Buffer.from(`stellwerk:${password}`).toString('base64')}`;

describe('asking LibreHardwareMonitor', () => {
  test('asks only for data.json on 127.0.0.1:8085, with the password from the settings, no redirects', async () => {
    const fake = fakeLhm(() => json(laptop()));
    const w = new HardwareWatcher({ settingsFile: settingsFile('first'), intervalMs: 5000, fetch: fake.fetch, now: () => 1000 });
    await w.poll();
    assert.equal(LHM_URL, 'http://127.0.0.1:8085/data.json');
    assert.deepEqual(w.view(), { values: LAPTOP_VALUES, updatedAt: 1000, problem: null });
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]!.url, LHM_URL);
    assert.equal(fake.calls[0]!.init?.redirect, 'error');
    assert.equal(authorization(fake.calls[0]!), basic('first'));
  });

  test('without a settings file it asks without a password', async () => {
    const fake = fakeLhm(() => json(laptop()));
    await new HardwareWatcher({ settingsFile: settingsFile(null), intervalMs: 5000, fetch: fake.fetch }).poll();
    assert.equal(authorization(fake.calls[0]!), undefined);
  });

  test('turned away, it reads the password again (it changes with each start of LibreHardwareMonitor)', async () => {
    const file = settingsFile('first');
    let accepted = 'first';
    const fake = fakeLhm((call) => (authorization(call) === basic(accepted) ? json(laptop()) : new Response('', { status: 401 })));
    const w = new HardwareWatcher({ settingsFile: file, intervalMs: 5000, fetch: fake.fetch });
    await w.poll();
    assert.equal(w.problem, null);
    accepted = 'second';
    writeSettings(file, 'second');
    await w.poll();
    assert.equal(w.problem, null);
    assert.deepEqual(fake.calls.map(authorization), [basic('first'), basic('first'), basic('second')]);
  });

  test('a password still refused is reported once, and the values go away', async () => {
    const log: string[] = [];
    let refuse = false;
    const fake = fakeLhm(() => (refuse ? new Response('', { status: 401 }) : json(laptop())));
    const w = new HardwareWatcher({ settingsFile: settingsFile('pw'), intervalMs: 5000, fetch: fake.fetch, log: (l) => log.push(l) });
    await w.poll();
    refuse = true;
    await w.poll();
    await w.poll();
    assert.deepEqual(w.view(), { values: null, updatedAt: w.updatedAt, problem: 'rejected' });
    assert.equal(log.length, 1);
    assert.match(log[0]!, /password/);
  });

  test('not running, then running again: one message each', async () => {
    const log: string[] = [];
    let running = false;
    const fetch = (async () => {
      if (!running) throw new TypeError('fetch failed');
      return json(laptop());
    }) as typeof globalThis.fetch;
    const w = new HardwareWatcher({ settingsFile: settingsFile(null), intervalMs: 5000, fetch, log: (l) => log.push(l) });
    await w.poll();
    await w.poll();
    assert.equal(w.problem, 'not-running');
    running = true;
    await w.poll();
    assert.equal(w.problem, null);
    assert.equal(log.length, 2);
    assert.match(log[0]!, /does not answer/);
    assert.match(log[1]!, /answers again/);
  });

  test('an answer that is not a sensor tree is unexpected', async () => {
    for (const answer of [() => new Response('not json', { status: 200 }), () => json({ hello: 'world' }), () => new Response('', { status: 500 })]) {
      const w = new HardwareWatcher({ settingsFile: settingsFile(null), intervalMs: 5000, fetch: fakeLhm(answer).fetch });
      await w.poll();
      assert.equal(w.problem, 'unexpected');
      assert.equal(w.values, null);
    }
  });

  test('tells the hub only about changes', async () => {
    let changes = 0;
    let load = '10,0 %';
    const data = () =>
      node('Sensor', [node('PC', [node('CPU', [node('Load', [sensor('/intelcpu/0/load/0', 'CPU Total', 'Load', load)])])])]);
    const w = new HardwareWatcher({
      settingsFile: settingsFile(null),
      intervalMs: 5000,
      fetch: fakeLhm(() => json(data())).fetch,
      onChange: () => changes++,
    });
    await w.poll();
    await w.poll();
    assert.equal(changes, 1);
    load = '11,0 %';
    await w.poll();
    assert.equal(changes, 2);
  });
});

describe('LibreHardwareMonitor runs while the hub runs', () => {
  /** Its task, written down: each run and end, with the time. */
  function recordedTask(at: () => number) {
    const calls: string[] = [];
    return { calls, task: { run: () => void calls.push(`run ${at()}`), end: () => void calls.push(`end ${at()}`) } };
  }

  test('started with the hub, starting until it answers, ended with the hub', async () => {
    let now = 0;
    let running = false;
    const { calls, task } = recordedTask(() => now);
    const fetch = (async () => {
      if (!running) throw new TypeError('fetch failed');
      return json(laptop());
    }) as typeof globalThis.fetch;
    const log: string[] = [];
    const w = new HardwareWatcher({ settingsFile: settingsFile(null), intervalMs: 3_600_000, fetch, now: () => now, task, log: (l) => log.push(l) });
    w.start();
    await w.poll();
    assert.deepEqual(calls, ['run 0'], 'its task runs when the hub starts');
    assert.deepEqual(w.view(), { values: null, updatedAt: null, problem: null, starting: true }, 'starting: no problem to show yet');
    now = 20_000;
    running = true;
    await w.poll();
    assert.equal(w.view().starting, undefined);
    assert.ok(w.values);
    w.stop();
    assert.deepEqual(calls, ['run 0', 'end 20000'], 'ended when the hub stops');
    assert.ok(log.some((l) => /started with the hub/.test(l)));
    assert.ok(!log.some((l) => /does not answer/.test(l)), 'starting is no problem in the log either');
  });

  test('not answering for a minute, it runs again, at most every two minutes; a refused password does not', async () => {
    let now = 0;
    let answer: 'yes' | 'down' | 'refused' = 'yes';
    const { calls, task } = recordedTask(() => now);
    const fetch = (async () => {
      if (answer === 'down') throw new TypeError('fetch failed');
      if (answer === 'refused') return new Response('', { status: 401 });
      return json(laptop());
    }) as typeof globalThis.fetch;
    const w = new HardwareWatcher({ settingsFile: settingsFile('pw'), intervalMs: 3_600_000, fetch, now: () => now, task });
    w.start();
    await w.poll();
    now = 30_000;
    await w.poll();
    assert.deepEqual(calls, ['run 0']);
    answer = 'down';
    const at = async (t: number) => {
      now = t;
      await w.poll();
    };
    await at(60_000);
    assert.equal(w.problem, 'not-running', 'after it answered, a gap is a problem at once');
    await at(89_000);
    assert.deepEqual(calls, ['run 0'], 'not before a minute without an answer');
    await at(130_000);
    assert.deepEqual(calls, ['run 0', 'run 130000'], 'a minute after its last answer, two after its last run');
    assert.equal(w.view().starting, true, 'then it is starting again');
    await at(200_000);
    assert.deepEqual(calls, ['run 0', 'run 130000'], 'not again within two minutes');
    await at(250_000);
    assert.deepEqual(calls, ['run 0', 'run 130000', 'run 250000']);
    answer = 'refused';
    await at(400_000);
    await at(600_000);
    assert.equal(w.problem, 'rejected');
    assert.deepEqual(calls, ['run 0', 'run 130000', 'run 250000'], 'running it again would not help a refused password');
    w.stop();
  });

  test('a task that cannot be run or ended is only logged; without a task nothing is run', async () => {
    const log: string[] = [];
    const failing = {
      run: () => {
        throw new Error('FEHLER: Zugriff verweigert');
      },
      end: () => {
        throw new Error('FEHLER: nicht gefunden');
      },
    };
    const fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;
    const w = new HardwareWatcher({ settingsFile: settingsFile(null), intervalMs: 3_600_000, fetch, task: failing, log: (l) => log.push(l) });
    w.start();
    await w.poll();
    w.stop();
    assert.ok(log.some((l) => /could not be run: FEHLER: Zugriff verweigert/.test(l)));
    assert.ok(log.some((l) => /could not be ended: FEHLER: nicht gefunden/.test(l)));
    const plain = new HardwareWatcher({ settingsFile: settingsFile(null), intervalMs: 3_600_000, fetch });
    plain.start();
    await plain.poll();
    plain.stop();
    assert.equal(plain.problem, 'not-running', 'without a task, not answering is a problem at once');
  });

  test('the timing: starting for 45 s, again after a minute, at most every two minutes', () => {
    assert.deepEqual([STARTING_MS, RESTART_AFTER_MS, RESTART_EVERY_MS], [45_000, 60_000, 120_000]);
    const keeper = new HardwareKeeper({ run: () => {}, end: () => {} });
    keeper.begin(0);
    assert.equal(keeper.starting(44_999), true);
    assert.equal(keeper.starting(45_000), false);
    keeper.noted(true, false, 10_000);
    assert.equal(keeper.starting(11_000), false, 'once it answered, it is no longer starting');
  });
});
