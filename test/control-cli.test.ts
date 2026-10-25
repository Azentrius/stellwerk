// `stellwerk start | stop | restart` as a user runs them: the real command line in a process of its own,
// with Windows made up by test/support/fake-windows.ts (tasks, the hub as a socket; every program it would
// start is written down, none runs). The order of the tasks, and LibreHardwareMonitor's task ended with
// Stellwerk.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DISPLAY_TASK, HUB_TASK } from '../src/setup/autostart.ts';
import { HARDWARE_TASK } from '../src/setup/hardware.ts';
import type { Call, FakeWindows } from './support/fake-windows.ts';

const CLI = path.join(import.meta.dirname, '..', 'src', 'cli.ts');
const FAKE = pathToFileURL(path.join(import.meta.dirname, 'support', 'fake-windows.ts')).href;

/** Runs `stellwerk <command>` against the made-up Windows; what it printed, its status and the task actions. */
async function control(
  command: 'start' | 'stop' | 'restart',
  windows: { tasks: string[]; hub?: FakeWindows['hub']; hardwareMonitor?: boolean },
): Promise<{ status: number | null; output: string; actions: string[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-control-cli-'));
  try {
    const fake: FakeWindows = {
      screens: [],
      tasks: Object.fromEntries(windows.tasks.map((name) => [name, '<Task/>'])),
      hub: windows.hub,
      calls: path.join(dir, 'calls.jsonl'),
    };
    fs.writeFileSync(fake.calls, '');
    const roaming = path.join(dir, 'roaming');
    fs.mkdirSync(path.join(roaming, 'stellwerk'), { recursive: true });
    fs.writeFileSync(path.join(roaming, 'stellwerk', 'config.json'), JSON.stringify({ hardwareMonitor: windows.hardwareMonitor ?? false }));
    const result = await new Promise<{ status: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', FAKE, CLI, command], {
        env: { ...process.env, APPDATA: roaming, LOCALAPPDATA: path.join(dir, 'local'), STELLWERK_FAKE_WINDOWS: JSON.stringify(fake) },
      });
      let output = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
      const timer = setTimeout(() => child.kill(), 45_000);
      child.on('error', reject);
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ status, output });
      });
    });
    const calls = fs
      .readFileSync(fake.calls, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Call);
    const actions = calls
      .filter((c) => c.command === 'schtasks' && (c.args[0] === '/End' || c.args[0] === '/Run'))
      .map((c) => `${c.args[0]} ${c.args[c.args.indexOf('/TN') + 1]}`);
    return { ...result, actions };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ALL = [HUB_TASK, DISPLAY_TASK, HARDWARE_TASK];

describe('stellwerk start | stop | restart', { concurrency: true }, () => {
  test('start runs the hub, waits until it answers, then the display; the hub itself runs LibreHardwareMonitor', async () => {
    const outcome = await control('start', { tasks: ALL, hub: { running: false }, hardwareMonitor: true });
    assert.equal(outcome.status, 0, outcome.output);
    assert.deepEqual(outcome.actions, [`/Run ${HUB_TASK}`, `/Run ${DISPLAY_TASK}`]);
    assert.match(outcome.output, /Stellwerk runs on 127\.0\.0\.1:\d+, the display opens, LibreHardwareMonitor starts with the hub\./);
  });

  test('start leaves a hub that runs already, and opens the display', async () => {
    const outcome = await control('start', { tasks: [HUB_TASK, DISPLAY_TASK] });
    assert.equal(outcome.status, 0, outcome.output);
    assert.deepEqual(outcome.actions, [`/Run ${DISPLAY_TASK}`]);
  });

  test('stop ends the display, the hub and then LibreHardwareMonitor, in this order', async () => {
    const outcome = await control('stop', { tasks: ALL, hardwareMonitor: true });
    assert.equal(outcome.status, 0, outcome.output);
    assert.deepEqual(outcome.actions, [`/End ${DISPLAY_TASK}`, `/End ${HUB_TASK}`, `/End ${HARDWARE_TASK}`]);
    assert.match(outcome.output, /Stellwerk stopped/);
  });

  test('restart stops all, then starts the hub and the display again', async () => {
    const outcome = await control('restart', { tasks: ALL, hardwareMonitor: true });
    assert.equal(outcome.status, 0, outcome.output);
    assert.deepEqual(outcome.actions, [`/End ${DISPLAY_TASK}`, `/End ${HUB_TASK}`, `/End ${HARDWARE_TASK}`, `/Run ${HUB_TASK}`, `/Run ${DISPLAY_TASK}`]);
  });

  test('without the hardware monitor set up, its task is left alone; without a display task, only the hub', async () => {
    const outcome = await control('restart', { tasks: [HUB_TASK, HARDWARE_TASK] });
    assert.equal(outcome.status, 0, outcome.output);
    assert.deepEqual(outcome.actions, [`/End ${HUB_TASK}`, `/Run ${HUB_TASK}`]);
  });

  test('without the hub task it says how to set Stellwerk up, and changes nothing', async () => {
    const outcome = await control('start', { tasks: [] });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, /The task "Stellwerk hub" is missing\. Set Stellwerk up first: stellwerk autostart install/);
    assert.deepEqual(outcome.actions, []);
  });

  test('a hub that does not follow its task stops it with a hint, before the display would start again', async () => {
    const outcome = await control('restart', { tasks: ALL, hub: { endsWithTask: false }, hardwareMonitor: true });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, /A hub not started by its task still listens/);
    assert.ok(!outcome.actions.some((a) => a.startsWith('/Run')));
  });
});
