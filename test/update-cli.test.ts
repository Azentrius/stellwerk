// `stellwerk update` as a user runs it: the real command line in a process of its own, with a made-up
// release, temporary folders and Windows made up by test/support/fake-windows.ts (screens and tasks; every
// program it would start is written down, none runs, no task changes). Which screen the new version's
// setup gets, and that a screen that cannot be told stops the update before anything changes.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DISPLAY_TASK, HUB_TASK, displayTask, taskXml, type Screen } from '../src/setup/autostart.ts';
import { zip } from '../tools/package.ts';
import type { Call, FakeWindows } from './support/fake-windows.ts';

const ROOT = path.join(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const FAKE = pathToFileURL(path.join(import.meta.dirname, 'support', 'fake-windows.ts')).href;
const VERSION = '9.9.9';

const screen = (n: number, x: number, y: number, width: number, height: number): Screen => ({
  name: `\\\\.\\DISPLAY${n}`,
  primary: n === 1,
  x,
  y,
  width,
  height,
});
const MAIN = screen(1, 0, 0, 3440, 1440);
const SIDE = screen(2, 3440, 0, 1920, 1080);
const DESK = screen(3, 0, 1440, 1920, 720);
const DESK_TOO = screen(4, 1920, 1440, 1920, 720);

/** The display task as an earlier setup registered it, for that screen. */
function displayTaskOn(on: Screen): string {
  const task = displayTask({
    edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    url: 'file:///C:/Users/dev/AppData/Local/stellwerk/display.html',
    profileDir: 'C:\\Users\\dev\\AppData\\Local\\stellwerk\\edge-display',
    screen: on,
    root: 'C:\\Stellwerk',
  });
  return taskXml(task, 'PC\\dev');
}

interface Outcome {
  status: number | null;
  output: string;
  calls: Call[];
  /** The release's folder was written. */
  unpacked: boolean;
  /** The arguments of the new version's setup, when it was started. */
  setup: string[] | null;
}

/** Runs `stellwerk update <release> --yes …` against the made-up Windows. */
function update(windows: { screens: Screen[]; tasks?: Record<string, string> }, ...extra: string[]): Outcome {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-update-cli-'));
  try {
    const name = `stellwerk-${VERSION}.zip`;
    const release = zip(
      [
        { name: `stellwerk-${VERSION}/package.json`, data: Buffer.from(`{"name":"stellwerk","version":"${VERSION}"}`) },
        { name: `stellwerk-${VERSION}/dist/cli.js`, data: Buffer.from('// a made-up release') },
      ],
      315532800,
    );
    const downloads = path.join(dir, 'downloads');
    fs.mkdirSync(downloads);
    fs.writeFileSync(path.join(downloads, name), release);
    fs.writeFileSync(path.join(downloads, 'SHA256SUMS'), `${createHash('sha256').update(release).digest('hex')}  ${name}\n`);
    const fake: FakeWindows = { screens: windows.screens, tasks: windows.tasks ?? {}, calls: path.join(dir, 'calls.jsonl') };
    fs.writeFileSync(fake.calls, '');
    const local = path.join(dir, 'local');
    const result = spawnSync(process.execPath, ['--import', FAKE, CLI, 'update', path.join(downloads, name), '--yes', ...extra], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        APPDATA: path.join(dir, 'roaming'),
        LOCALAPPDATA: local,
        CODEX_HOME: path.join(dir, 'codex'),
        STELLWERK_FAKE_WINDOWS: JSON.stringify(fake),
      },
    });
    const calls = fs
      .readFileSync(fake.calls, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Call);
    const setup = calls.find((c) => c.via === 'spawnSync' && c.args.includes('autostart'));
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      calls,
      unpacked: fs.existsSync(path.join(local, 'stellwerk', 'releases', `stellwerk-${VERSION}`)),
      setup: setup ? setup.args.slice(setup.args.indexOf('autostart')) : null,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Set up, with the display on that screen; only the screen list, task queries, npm and the setup ran. */
function setUpOn(outcome: Outcome, number: number): void {
  assert.equal(outcome.status, 0, outcome.output);
  assert.ok(outcome.unpacked, 'the release was unpacked');
  assert.deepEqual(outcome.setup, ['autostart', 'install', '--yes', '--screen', String(number)]);
  const started = outcome.calls.filter((c) => c.via === 'spawnSync');
  assert.equal(started.length, 2, 'npm ci and the new setup, nothing else');
  assert.deepEqual(started[0]!.args.slice(1), ['ci', '--omit=dev']);
  assert.ok(
    outcome.calls.every((c) => c.via === 'spawnSync' || c.asked === 'screens' || (c.command === 'schtasks' && c.args[0] === '/Query')),
    'the update itself changes no task',
  );
  assert.match(outcome.output, new RegExp(`full screen on screen ${number} `));
}

/** Stopped with that message before anything changed: nothing unpacked, nothing started. */
function stoppedBefore(outcome: Outcome, message: RegExp): void {
  assert.equal(outcome.status, 1, outcome.output);
  assert.match(outcome.output, message);
  assert.equal(outcome.unpacked, false, 'nothing was unpacked');
  assert.deepEqual(
    outcome.calls.filter((c) => c.via === 'spawnSync'),
    [],
    'neither npm nor a setup was started',
  );
  assert.ok(outcome.calls.every((c) => c.asked === 'screens' || (c.command === 'schtasks' && c.args[0] === '/Query')), 'no task was changed');
}

test('--screen 2 reaches the setup of the new version', () => {
  setUpOn(update({ screens: [MAIN, SIDE, DESK] }, '--screen', '2'), 2);
});

test('without --screen the display stays on the screen its task uses, also when that is not the 1920×720 one', () => {
  const tasks = { [HUB_TASK]: '<Task/>', [DISPLAY_TASK]: displayTaskOn(SIDE) };
  setUpOn(update({ screens: [MAIN, SIDE, DESK], tasks }), 2);
  // On the only 1920×720 screen it stays there too.
  setUpOn(update({ screens: [MAIN, SIDE, DESK], tasks: { [DISPLAY_TASK]: displayTaskOn(DESK) } }), 3);
});

test('with several 1920×720 screens the display stays on the one its task uses', () => {
  setUpOn(update({ screens: [MAIN, DESK, DESK_TOO], tasks: { [DISPLAY_TASK]: displayTaskOn(DESK_TOO) } }), 3);
});

test('a screen given with --screen comes before the one the task uses', () => {
  setUpOn(update({ screens: [MAIN, SIDE, DESK], tasks: { [DISPLAY_TASK]: displayTaskOn(SIDE) } }, '--screen', '3'), 3);
});

test('a first setup takes the only 1920×720 screen', () => {
  setUpOn(update({ screens: [MAIN, SIDE, DESK] }), 3);
});

test('a first setup without a 1920×720 screen, or with several, asks for --screen before anything changes', () => {
  stoppedBefore(update({ screens: [MAIN, SIDE] }), /No screen has 1920×720\. Choose one with --screen <number>/);
  stoppedBefore(update({ screens: [MAIN, DESK, DESK_TOO] }), /Several screens have 1920×720\. Choose one with --screen <number>/);
  setUpOn(update({ screens: [MAIN, DESK, DESK_TOO] }, '--screen', '2'), 2);
});

test('when the screen of the display task is gone, the update asks for --screen instead of moving the display', () => {
  const tasks = { [DISPLAY_TASK]: displayTaskOn(DESK) };
  stoppedBefore(update({ screens: [MAIN, SIDE], tasks }), /shows the display at 0,1440 in 1920×720, where no screen is now\. Choose one with --screen/);
  // Not even to the only 1920×720 screen there is now.
  stoppedBefore(update({ screens: [MAIN, DESK_TOO], tasks }), /where no screen is now/);
  setUpOn(update({ screens: [MAIN, SIDE], tasks }, '--screen', '2'), 2);
});

test('a display task that names no screen is not overwritten by a guess', () => {
  const plain = displayTaskOn(DESK).replace(/ --window-position=[\d,-]+ --window-size=[\d,]+/, '');
  assert.doesNotMatch(plain, /--window-/);
  stoppedBefore(update({ screens: [MAIN, SIDE, DESK], tasks: { [DISPLAY_TASK]: plain } }), /names no screen\. Choose one with --screen/);
});

test('a --screen that is no number, or names no screen, stops the update before anything changes', () => {
  for (const value of ['0', 'two', '-1', '1.5']) {
    stoppedBefore(update({ screens: [MAIN, SIDE, DESK] }, `--screen=${value}`), /--screen takes the number of a screen/);
  }
  stoppedBefore(update({ screens: [MAIN, SIDE, DESK], tasks: { [DISPLAY_TASK]: displayTaskOn(DESK) } }, '--screen', '4'), /There is no screen 4/);
});
