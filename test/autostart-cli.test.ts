// `stellwerk autostart uninstall` as a user runs it: the real command line in a process of its own, with
// Windows made up by test/support/fake-windows.ts (tasks and faults of their query; every program it would
// start is written down, none runs). Only a task Task Scheduler reports as missing is left out; one it
// cannot read stops the command before anything is removed.
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
import type { Call, FakeWindows, TaskFault } from './support/fake-windows.ts';

const CLI = path.join(import.meta.dirname, '..', 'src', 'cli.ts');
const FAKE = pathToFileURL(path.join(import.meta.dirname, 'support', 'fake-windows.ts')).href;
const ACCESS_DENIED = -2147024891;

/** Runs `stellwerk autostart uninstall --yes` against the made-up Windows. */
async function uninstall(tasks: Record<string, string>, faults?: Record<string, TaskFault>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-autostart-cli-'));
  try {
    const fake: FakeWindows = { screens: [], tasks, faults, hub: { running: false }, calls: path.join(dir, 'calls.jsonl') };
    fs.writeFileSync(fake.calls, '');
    const child = spawn(process.execPath, ['--import', FAKE, CLI, 'autostart', 'uninstall', '--yes'], {
      env: { ...process.env, APPDATA: path.join(dir, 'roaming'), LOCALAPPDATA: path.join(dir, 'local'), STELLWERK_FAKE_WINDOWS: JSON.stringify(fake) },
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
    const calls = fs
      .readFileSync(fake.calls, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Call);
    const deleted = calls.filter((c) => c.command === 'schtasks' && c.args[0] === '/Delete').map((c) => c.args[c.args.indexOf('/TN') + 1]);
    return { status, output, deleted };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('stellwerk autostart uninstall', { concurrency: true }, () => {
  test('removes the tasks that are there', async () => {
    const both = await uninstall({ [HUB_TASK]: '<Task/>', [DISPLAY_TASK]: '<Task/>' });
    assert.equal(both.status, 0, both.output);
    assert.deepEqual(both.deleted, [HUB_TASK, DISPLAY_TASK]);
    assert.match(both.output, /Removed\./);
    const one = await uninstall({ [HUB_TASK]: '<Task/>' });
    assert.equal(one.status, 0, one.output);
    assert.deepEqual(one.deleted, [HUB_TASK], 'the one Task Scheduler reports as missing is left out');
  });

  test('says so when Task Scheduler reports both as missing, in whatever language schtasks answers', async () => {
    const none = await uninstall({});
    assert.equal(none.status, 0, none.output);
    assert.match(none.output, /There are no Stellwerk tasks/);
    assert.deepEqual(none.deleted, []);
  });

  test('a task Task Scheduler cannot read stops it before anything is removed, instead of counting as missing', async () => {
    const tasks = { [HUB_TASK]: '<Task/>', [DISPLAY_TASK]: '<Task/>' };
    const denied = await uninstall(tasks, { [DISPLAY_TASK]: { query: 'FEHLER: Zugriff verweigert', code: ACCESS_DENIED } });
    assert.equal(denied.status, 1, denied.output);
    assert.match(denied.output, /Task Scheduler could not read the task "Stellwerk display": FEHLER: Zugriff verweigert \(code 0x80070005\)/);
    assert.deepEqual(denied.deleted, [], 'not even the hub task, which could be read');
    assert.doesNotMatch(denied.output, /There are no Stellwerk tasks/);
    const silent = await uninstall({}, { [HUB_TASK]: { query: 'FEHLER: Unbekannter Fehler', powershell: 'Die Aufgabenplanung antwortet nicht.' } });
    assert.equal(silent.status, 1, silent.output);
    assert.match(silent.output, /could not read the task "Stellwerk hub"/);
    assert.deepEqual(silent.deleted, []);
  });
});
