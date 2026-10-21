// `stellwerk update` as a user runs it: the real command line in a process of its own, with a made-up
// release, temporary folders and Windows made up by test/support/fake-windows.ts (screens and tasks; every
// program it would start is written down, none runs, no task changes). Which screen the new version's
// setup gets, and that a screen that cannot be told, or a display task Task Scheduler cannot read, stops
// the update before anything changes; only a task Task Scheduler reports as missing is a first setup.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DISPLAY_TASK, HUB_TASK, displayTask, taskXml, type Screen } from '../src/setup/autostart.ts';
import { zip } from '../tools/package.ts';
import type { Call, FakeWindows, TaskFault } from './support/fake-windows.ts';

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
  /** The folders in the releases folder afterwards. */
  releases: string[];
  /** Codex' hooks.json afterwards, when there is one. */
  codexHooks: string | null;
}

/** What else the machine has: Codex' hooks.json, release folders set up before. */
interface Before {
  codexHooks?: Record<string, unknown>;
  releases?: string[];
}

/** Runs `stellwerk update <release> --yes …` against the made-up Windows. */
/** Runs a program to its end; what it printed, and its exit status (null when it had to be ended). */
function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function update(windows: Pick<FakeWindows, 'screens' | 'faults' | 'hub' | 'failing'> & { tasks?: Record<string, string> } & Before, ...extra: string[]): Promise<Outcome> {
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
    const fake: FakeWindows = { screens: windows.screens, tasks: windows.tasks ?? {}, faults: windows.faults, hub: windows.hub, failing: windows.failing, calls: path.join(dir, 'calls.jsonl') };
    fs.writeFileSync(fake.calls, '');
    const local = path.join(dir, 'local');
    const releases = path.join(local, 'stellwerk', 'releases');
    for (const folder of windows.releases ?? []) {
      fs.mkdirSync(path.join(releases, folder, 'dist', 'codex'), { recursive: true });
      fs.writeFileSync(path.join(releases, folder, 'dist', 'codex', 'hook.js'), '// a release set up before');
    }
    const codexHome = path.join(dir, 'codex');
    if (windows.codexHooks) {
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify(windows.codexHooks));
    }
    const result = await run(process.execPath, ['--import', FAKE, CLI, 'update', path.join(downloads, name), '--yes', ...extra], {
      ...process.env,
      APPDATA: path.join(dir, 'roaming'),
      LOCALAPPDATA: local,
      CODEX_HOME: codexHome,
      STELLWERK_FAKE_WINDOWS: JSON.stringify(fake),
    }, 45_000);
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
      releases: fs.existsSync(releases) ? fs.readdirSync(releases).sort() : [],
      codexHooks: fs.existsSync(path.join(codexHome, 'hooks.json')) ? fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8') : null,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Only asked: the screen list, a task (schtasks /Query, Task Scheduler's error code); changes nothing. */
const asked = (c: Call) => c.asked === 'screens' || c.asked === 'task' || (c.command === 'schtasks' && c.args[0] === '/Query');
/** The hub's task ended or run. */
const hubTask = (c: Call, action: '/End' | '/Run') => c.command === 'schtasks' && c.args[0] === action && c.args.includes(HUB_TASK);

/** Set up, with the display on that screen; only the screen list, task queries, npm and the setup ran. */
function setUpOn(outcome: Outcome, number: number): void {
  assert.equal(outcome.status, 0, outcome.output);
  assert.ok(outcome.unpacked, 'the release was unpacked');
  assert.deepEqual(outcome.setup, ['autostart', 'install', '--yes', '--screen', String(number)]);
  const started = outcome.calls.filter((c) => c.via === 'spawnSync');
  assert.ok(started.length === 2 || (started.length === 3 && started[2]!.args.includes('codex')), 'npm ci, the new setup and maybe Codex, nothing else');
  assert.deepEqual(started[0]!.args.slice(1), ['ci', '--omit=dev']);
  const ended = outcome.calls.findIndex((c) => hubTask(c, '/End'));
  const run = outcome.calls.findIndex((c) => hubTask(c, '/Run'));
  assert.ok(ended > outcome.calls.lastIndexOf(started.at(-1)!) && run > ended, 'then the hub was ended and started again');
  assert.ok(
    outcome.calls.every((c) => c.via === 'spawnSync' || asked(c) || hubTask(c, '/End') || hubTask(c, '/Run')),
    'besides that the update changes no task',
  );
  assert.match(outcome.output, new RegExp(`full screen on screen ${number} `));
  assert.match(outcome.output, /Stellwerk 9\.9\.9 runs/);
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
  assert.ok(outcome.calls.every(asked), 'no task was changed');
}

describe('stellwerk update', { concurrency: true }, () => {
  test('--screen 2 reaches the setup of the new version', async () => {
    setUpOn(await update({ screens: [MAIN, SIDE, DESK] }, '--screen', '2'), 2);
  });

  test('without --screen the display stays on the screen its task uses, also when that is not the 1920×720 one', async () => {
    const tasks = { [HUB_TASK]: '<Task/>', [DISPLAY_TASK]: displayTaskOn(SIDE) };
    setUpOn(await update({ screens: [MAIN, SIDE, DESK], tasks }), 2);
    // On the only 1920×720 screen it stays there too.
    setUpOn(await update({ screens: [MAIN, SIDE, DESK], tasks: { [DISPLAY_TASK]: displayTaskOn(DESK) } }), 3);
  });

  test('with several 1920×720 screens the display stays on the one its task uses', async () => {
    setUpOn(await update({ screens: [MAIN, DESK, DESK_TOO], tasks: { [DISPLAY_TASK]: displayTaskOn(DESK_TOO) } }), 3);
  });

  test('a screen given with --screen comes before the one the task uses', async () => {
    setUpOn(await update({ screens: [MAIN, SIDE, DESK], tasks: { [DISPLAY_TASK]: displayTaskOn(SIDE) } }, '--screen', '3'), 3);
  });

  test('a first setup takes the only 1920×720 screen', async () => {
    setUpOn(await update({ screens: [MAIN, SIDE, DESK] }), 3);
  });

  test('a first setup without a 1920×720 screen, or with several, asks for --screen before anything changes', async () => {
    stoppedBefore(await update({ screens: [MAIN, SIDE] }), /No screen has 1920×720\. Choose one with --screen <number>/);
    stoppedBefore(await update({ screens: [MAIN, DESK, DESK_TOO] }), /Several screens have 1920×720\. Choose one with --screen <number>/);
    setUpOn(await update({ screens: [MAIN, DESK, DESK_TOO] }, '--screen', '2'), 2);
  });

  test('when the screen of the display task is gone, the update asks for --screen instead of moving the display', async () => {
    const tasks = { [DISPLAY_TASK]: displayTaskOn(DESK) };
    stoppedBefore(await update({ screens: [MAIN, SIDE], tasks }), /shows the display at 0,1440 in 1920×720, where no screen is now\. Choose one with --screen/);
    // Not even to the only 1920×720 screen there is now.
    stoppedBefore(await update({ screens: [MAIN, DESK_TOO], tasks }), /where no screen is now/);
    setUpOn(await update({ screens: [MAIN, SIDE], tasks }, '--screen', '2'), 2);
  });

  test('a display task that names no screen is not overwritten by a guess', async () => {
    const plain = displayTaskOn(DESK).replace(/ --window-position=[\d,-]+ --window-size=[\d,]+/, '');
    assert.doesNotMatch(plain, /--window-/);
    stoppedBefore(await update({ screens: [MAIN, SIDE, DESK], tasks: { [DISPLAY_TASK]: plain } }), /names no screen\. Choose one with --screen/);
  });

  // Task Scheduler's error codes (HRESULTs): not there, access denied, its service not reachable.
  const NOT_FOUND = -2147024894;
  const ACCESS_DENIED = -2147024891;
  const UNREACHABLE = -2147023174;
  const unreadable = (detail: RegExp) =>
    new RegExp(`could not read the task "Stellwerk display": ${detail.source}[\\s\\S]*Nothing was changed`);

  test('a display task Task Scheduler cannot read stops the update, instead of counting as a first setup', async () => {
    const tasks = { [DISPLAY_TASK]: displayTaskOn(SIDE) };
    const faults = { [DISPLAY_TASK]: { query: 'FEHLER: Zugriff verweigert', code: ACCESS_DENIED } };
    const denied = await update({ screens: [MAIN, SIDE, DESK], tasks, faults });
    stoppedBefore(denied, unreadable(/FEHLER: Zugriff verweigert \(code 0x80070005\)/));
    assert.ok(denied.calls.some((c) => c.asked === 'task' && c.task === DISPLAY_TASK), 'Task Scheduler was asked');
    // A screen given does not get round it: the new version could not replace the task either.
    stoppedBefore(await update({ screens: [MAIN, SIDE, DESK], tasks, faults }, '--screen', '3'), unreadable(/FEHLER: Zugriff verweigert/));
    // schtasks' words do not count: "cannot find" with the code for access denied is no missing task.
    const words = { [DISPLAY_TASK]: { query: 'ERROR: The system cannot find the file specified.', code: ACCESS_DENIED } };
    stoppedBefore(await update({ screens: [MAIN, SIDE, DESK], faults: words }), unreadable(/ERROR: The system cannot find the file specified\. \(code 0x80070005\)/));
  });

  test('when Task Scheduler cannot be reached, or asking it fails, the update stops the same way', async () => {
    const unreachable = { [DISPLAY_TASK]: { query: 'FEHLER: Der RPC-Server ist nicht verfügbar.', code: UNREACHABLE } };
    stoppedBefore(await update({ screens: [MAIN, SIDE, DESK], faults: unreachable }), unreadable(/FEHLER: Der RPC-Server ist nicht verfügbar\. \(code 0x800706ba\)/));
    const broken = { [DISPLAY_TASK]: { query: 'FEHLER: Unbekannter Fehler', powershell: 'Die Aufgabenplanung antwortet nicht.' } };
    stoppedBefore(await update({ screens: [MAIN, SIDE, DESK], faults: broken }), unreadable(/FEHLER: Unbekannter Fehler; Die Aufgabenplanung antwortet nicht\./));
    // Task Scheduler says the task is there although schtasks could not find it: no first setup either.
    const there = { [DISPLAY_TASK]: { query: 'FEHLER: Das System kann die angegebene Datei nicht finden.', code: 0 } };
    stoppedBefore(await update({ screens: [MAIN, SIDE, DESK], faults: there }), unreadable(/.*\(code 0x0\)/));
  });

  test('a display task that is there but whose definition cannot be read stops the update the same way', async () => {
    const tasks = { [DISPLAY_TASK]: displayTaskOn(SIDE) };
    stoppedBefore(await update({ screens: [MAIN, SIDE, DESK], tasks, faults: { [DISPLAY_TASK]: { xml: 'FEHLER: Zugriff verweigert' } } }), unreadable(/FEHLER: Zugriff verweigert/));
  });

  test('a display task Task Scheduler says is not there is a first setup, in whatever language schtasks answers', async () => {
    // German, by default.
    const german = await update({ screens: [MAIN, SIDE, DESK] });
    setUpOn(german, 3);
    assert.ok(german.calls.some((c) => c.asked === 'task' && c.task === DISPLAY_TASK), 'Task Scheduler was asked');
    for (const query of ['ERROR: The system cannot find the file specified.', 'ERREUR : le fichier spécifié est introuvable.', '']) {
      setUpOn(await update({ screens: [MAIN, SIDE, DESK], faults: { [DISPLAY_TASK]: { query, code: NOT_FOUND } } }), 3);
    }
    // The hub task alone does not make it an update of the display task.
    setUpOn(await update({ screens: [MAIN, SIDE, DESK], tasks: { [HUB_TASK]: '<Task/>' } }), 3);
  });

  test('a --screen that is no number, or names no screen, stops the update before anything changes', async () => {
    for (const value of ['0', 'two', '-1', '1.5']) {
      stoppedBefore(await update({ screens: [MAIN, SIDE, DESK] }, `--screen=${value}`), /--screen takes the number of a screen/);
    }
    stoppedBefore(await update({ screens: [MAIN, SIDE, DESK], tasks: { [DISPLAY_TASK]: displayTaskOn(DESK) } }, '--screen', '4'), /There is no screen 4/);
  });

  // ---------- the update in one step: Codex' hooks, the hub, previous releases ----------

  const OLD = 'stellwerk-0.5.3';
  /** Codex' hooks as an earlier version set them up, next to a hook of someone else. */
  const codexHooksOf = (folder: string) => ({
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: `node C:\\Users\\dev\\AppData\\Local\\stellwerk\\releases\\${folder}\\dist\\codex\\hook.js`, timeout: 5 }] },
        { hooks: [{ type: 'command', command: 'notify-me.exe', timeout: 5 }] },
      ],
    },
  });

  test("Codex' hooks that run Stellwerk's forwarder move to the new version's; others stay as they are", async () => {
    const moved = await update({ screens: [MAIN, SIDE, DESK], codexHooks: codexHooksOf(OLD) });
    setUpOn(moved, 3);
    const codex = moved.calls.filter((c) => c.via === 'spawnSync' && c.args.includes('codex'));
    assert.equal(codex.length, 1);
    assert.match(codex[0]!.args[0]!, /stellwerk-9\.9\.9[\\/]dist[\\/]cli\.js$/, "the new version's own command");
    assert.deepEqual(codex[0]!.args.slice(1), ['codex', 'install', '--yes']);
    // In the file as JSON writes it: each backslash doubled.
    assert.match(moved.codexHooks ?? '', /stellwerk-9\.9\.9\\\\dist\\\\codex\\\\hook\.js/);
    assert.doesNotMatch(moved.codexHooks ?? '', new RegExp(OLD));
    assert.match(moved.codexHooks ?? '', /notify-me\.exe/);
    assert.match(moved.output, /allow the changed hooks there/);

    const others = await update({ screens: [MAIN, SIDE, DESK], codexHooks: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify-me.exe' }] }] } } });
    setUpOn(others, 3);
    assert.ok(!others.calls.some((c) => c.args.includes('codex')), 'without Stellwerk in them, Codex is left alone');
    assert.doesNotMatch(others.output, /allow the changed hooks/);
  });

  test('then the hub starts again from the new version; its task, not the display, is ended and run', async () => {
    const outcome = await update({ screens: [MAIN, SIDE, DESK] });
    setUpOn(outcome, 3);
    assert.ok(!outcome.calls.some((c) => c.command === 'schtasks' && c.args.includes(DISPLAY_TASK) && c.args[0] !== '/Query'), 'the display reloads by itself');
    assert.match(outcome.output, /loads the new page by itself/);
    // No hub running before (the first setup): it is started all the same.
    setUpOn(await update({ screens: [MAIN, SIDE, DESK], hub: { running: false } }), 3);
  });

  test('previous releases go once the hub and Codex run the new one; --keep-previous keeps them', async () => {
    const releases = [OLD, 'stellwerk-0.5.4', 'notes'];
    const gone = await update({ screens: [MAIN, SIDE, DESK], releases, codexHooks: codexHooksOf(OLD) });
    setUpOn(gone, 3);
    assert.deepEqual(gone.releases, ['notes', 'stellwerk-9.9.9'], 'what is not a release stays');
    assert.match(gone.output, /the previous releases go: stellwerk-0\.5\.3, stellwerk-0\.5\.4/);
    const kept = await update({ screens: [MAIN, SIDE, DESK], releases }, '--keep-previous');
    setUpOn(kept, 3);
    assert.deepEqual(kept.releases, ['notes', OLD, 'stellwerk-0.5.4', 'stellwerk-9.9.9']);
    assert.doesNotMatch(kept.output, /previous release/);
  });

  test('when the hub does not follow its task, the update says so and keeps the previous release', async () => {
    const otherwise = await update({ screens: [MAIN, SIDE, DESK], releases: [OLD], hub: { endsWithTask: false } });
    assert.equal(otherwise.status, 1, otherwise.output);
    assert.match(otherwise.output, /A hub not started by its task still listens on 127\.0\.0\.1:\d+\. Stop it/);
    assert.ok(!otherwise.calls.some((c) => hubTask(c, '/Run')), 'not run a second time');
    assert.deepEqual(otherwise.releases, [OLD, 'stellwerk-9.9.9']);
  });

  test('when the hub does not start again, the update says where to look and keeps the previous release', async () => {
    const silent = await update({ screens: [MAIN, SIDE, DESK], releases: [OLD], hub: { starts: false } });
    assert.equal(silent.status, 1, silent.output);
    assert.match(silent.output, /The hub did not start again; its messages are in .*hub\.log/);
    assert.deepEqual(silent.releases, [OLD, 'stellwerk-9.9.9']);
  });

  test("when Codex' hooks cannot be moved, nothing after it happens and the previous release stays", async () => {
    const outcome = await update({ screens: [MAIN, SIDE, DESK], releases: [OLD], codexHooks: codexHooksOf(OLD), failing: 'codex' });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, /codex install --yes in .* failed/);
    assert.ok(!outcome.calls.some((c) => hubTask(c, '/End')), 'the hub was left as it was');
    assert.deepEqual(outcome.releases, [OLD, 'stellwerk-9.9.9']);
    assert.match(outcome.codexHooks ?? '', new RegExp(OLD));
  });
});
