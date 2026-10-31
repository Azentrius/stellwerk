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
  command: 'start' | 'stop' | 'restart' | 'status' | 'setup' | 'teardown',
  windows: {
    tasks: string[] | Record<string, string>;
    hub?: FakeWindows['hub'];
    hardwareMonitor?: boolean;
    display?: FakeWindows['display'];
    userEnv?: Record<string, string>;
    /** Files to write first, by their path below the test's folder. */
    files?: Record<string, string>;
    screens?: FakeWindows['screens'];
    elevated?: boolean;
    /** Files to read afterwards, by their path below the test's folder (null: gone). */
    read?: string[];
  },
  ...extra: string[]
): Promise<{ status: number | null; output: string; actions: string[]; tasks: string[]; calls: Call[]; files: Record<string, string | null> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-control-cli-'));
  try {
    const fake: FakeWindows = {
      screens: windows.screens ?? [],
      elevated: windows.elevated,
      tasks: Array.isArray(windows.tasks) ? Object.fromEntries(windows.tasks.map((name) => [name, '<Task/>'])) : windows.tasks,
      hub: windows.hub,
      display: windows.display,
      userEnv: windows.userEnv,
      calls: path.join(dir, 'calls.jsonl'),
    };
    fs.writeFileSync(fake.calls, '');
    const roaming = path.join(dir, 'roaming');
    fs.mkdirSync(path.join(roaming, 'stellwerk'), { recursive: true });
    fs.writeFileSync(path.join(roaming, 'stellwerk', 'config.json'), JSON.stringify({ hardwareMonitor: windows.hardwareMonitor ?? false }));
    for (const [file, text] of Object.entries(windows.files ?? {})) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), text);
    }
    const result = await new Promise<{ status: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', FAKE, CLI, command, ...extra], {
        env: {
          ...process.env,
          APPDATA: roaming,
          LOCALAPPDATA: path.join(dir, 'local'),
          USERPROFILE: path.join(dir, 'home'),
          CODEX_HOME: path.join(dir, 'codex'),
          STELLWERK_FAKE_WINDOWS: JSON.stringify(fake),
        },
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
    const tasks = calls.filter((c) => c.command === 'schtasks' && c.args[0] === '/Create').map((c) => c.args[c.args.indexOf('/TN') + 1]!);
    const files = Object.fromEntries(
      (windows.read ?? []).map((file) => [file, fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : null]),
    );
    return { ...result, actions, tasks, calls, files };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ALL = [HUB_TASK, DISPLAY_TASK, HARDWARE_TASK];

describe('stellwerk start | stop | restart | status', { concurrency: true }, () => {
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

  // ---------- stellwerk status ----------

  const release = (version: string) => `<Task><Exec><Arguments>C:\\Users\\dev\\AppData\\Local\\stellwerk\\releases\\stellwerk-${version}\\dist\\cli.js serve</Arguments></Exec></Task>`;
  const hubLog = (version: string) => `--- 2026-10-26T00:00:00.000Z  Stellwerk ${version}, process 4711\nStellwerk ${version} on http://127.0.0.1:4780\n`;
  const claudeHooks = (header: boolean) =>
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:4780/hooks/claude-code', headers: { Authorization: 'Bearer $STELLWERK_TOKEN', ...(header ? { 'X-Stellwerk-App-Session': '$CLAUDE_CODE_HOST_SESSION_ID' } : {}) } }] }],
      },
    });
  const codexHooks = (version: string) =>
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `node C:\\Users\\dev\\AppData\\Local\\stellwerk\\releases\\stellwerk-${version}\\dist\\codex\\hook.js` }] }] } });
  const everything = (versions: { log: string; task: string; codex: string }, header = true) => ({
    tasks: { [HUB_TASK]: release(versions.task), [DISPLAY_TASK]: '<Task/>' },
    userEnv: { STELLWERK_TOKEN: 'a'.repeat(64) },
    files: {
      'local/stellwerk/hub.log': hubLog(versions.log),
      'home/.claude/settings.json': claudeHooks(header),
      'codex/hooks.json': codexHooks(versions.codex),
    },
  });

  test('status: all is well when the hub, its task, the display and the hooks agree on one release', async () => {
    const outcome = await control('status', everything({ log: '9.9.9', task: '9.9.9', codex: '9.9.9' }));
    assert.equal(outcome.status, 0, outcome.output);
    assert.match(outcome.output, /ok {2}Hub: answers on 127\.0\.0\.1:\d+, Stellwerk 9\.9\.9/);
    assert.match(outcome.output, /ok {2}Task "Stellwerk hub": running, starts releases\\stellwerk-9\.9\.9/);
    assert.match(outcome.output, /ok {2}Display: open/);
    assert.match(outcome.output, /ok {2}Claude Code: 1 hooks, with the app's session id/);
    assert.match(outcome.output, /ok {2}Claude Code: STELLWERK_TOKEN is set/);
    assert.match(outcome.output, /ok {2}Codex: 1 hooks run the forwarder of 9\.9\.9/);
    assert.match(outcome.output, /All is well\./);
    assert.deepEqual(outcome.actions, [], 'it changes nothing');
    assert.doesNotMatch(outcome.output, /a{64}/, 'never the token');
  });

  test('status: an old hub, old Codex hooks and hooks without the app id each say what to do, and it ends with 1', async () => {
    const outcome = await control('status', { ...everything({ log: '9.9.8', task: '9.9.9', codex: '9.9.8' }, false), display: { running: false } });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, /!! {2}The hub runs 9\.9\.8, its task starts 9\.9\.9: stellwerk restart/);
    assert.match(outcome.output, /!! {2}Codex: the hooks run the forwarder of 9\.9\.8, the hub's task starts 9\.9\.9\. Run stellwerk codex install from 9\.9\.9/);
    assert.match(outcome.output, /!! {2}Claude Code: hooks without the app's session id\. Run stellwerk hooks install/);
    assert.match(outcome.output, /!! {2}Display: closed \(task running\)\. Open it: stellwerk start/);
    assert.match(outcome.output, /4 things need doing/);
    assert.deepEqual(outcome.actions, []);
  });

  test('status: missing tasks and hooks, and an older LibreHardwareMonitor that still starts at logon', async () => {
    const outcome = await control('status', {
      tasks: { [HARDWARE_TASK]: '<Task><RegistrationInfo><Description>Starts LibreHardwareMonitor 0.9.5 at logon</Description></RegistrationInfo><Triggers><LogonTrigger/></Triggers></Task>' },
      hardwareMonitor: true,
      hub: { running: false },
    });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, /!! {2}Hub: does not answer on 127\.0\.0\.1:\d+\. Start it: stellwerk start/);
    assert.match(outcome.output, /!! {2}Task "Stellwerk hub": missing\. Set Stellwerk up: stellwerk autostart install/);
    assert.match(outcome.output, /!! {2}Task "Stellwerk display": missing/);
    assert.match(outcome.output, /LibreHardwareMonitor 0\.9\.5 (answers|does not answer) on port 8085/);
    assert.match(outcome.output, /!! {2}This Stellwerk pins LibreHardwareMonitor \d+\.\d+\.\d+: run stellwerk hardware install as administrator/);
    assert.match(outcome.output, /!! {2}Its task still starts at logon by itself/);
    assert.match(outcome.output, /!! {2}Claude Code: no Stellwerk hooks\. Run stellwerk hooks install/);
    assert.match(outcome.output, /ok {2}Codex: no Stellwerk hooks/);
  });

  // ---------- stellwerk setup ----------

  test('setup sets up the hooks and the logon tasks, names what needs an administrator, starts Stellwerk and says how it stands', async () => {
    const screen = { name: '\\\\.\\DISPLAY2', primary: false, x: 0, y: 1440, width: 1920, height: 720 };
    const main = { name: '\\\\.\\DISPLAY1', primary: true, x: 0, y: 0, width: 3440, height: 1440 };
    const outcome = await control('setup', { tasks: {}, screens: [main, screen], files: { 'codex/.keep': '' } }, '--yes');
    assert.match(outcome.output, /== 1\. Claude Code's hooks/);
    assert.match(outcome.output, /== 3\. Codex' hooks/);
    assert.match(outcome.output, /no administrator rights\. In one that has, run:\n {2}stellwerk install[\s\S]*stellwerk hardware install/);
    assert.deepEqual(outcome.tasks.sort(), [DISPLAY_TASK, HUB_TASK], 'the two logon tasks, nothing as administrator');
    assert.ok(outcome.actions.includes(`/Run ${DISPLAY_TASK}`), 'started');
    assert.match(outcome.output, /== 6\. How it stands[\s\S]*ok {2}Claude Code: \d+ hooks, with the app's session id[\s\S]*ok {2}Claude Code: STELLWERK_TOKEN is set/);
    assert.match(outcome.output, /ok {2}Codex: \d+ hooks/);
  });

  // ---------- stellwerk teardown ----------

  test('teardown stops Stellwerk, removes its tasks and hooks, keeps tokens and folders, and names what needs an administrator', async () => {
    const set = everything({ log: '9.9.9', task: '9.9.9', codex: '9.9.9' });
    const outcome = await control(
      'teardown',
      {
        ...set,
        tasks: { ...set.tasks, [HARDWARE_TASK]: '<Task/>' },
        hardwareMonitor: true,
        files: { ...set.files, 'local/stellwerk/github-token': 'github_pat_made_up' },
        read: ['home/.claude/settings.json', 'codex/hooks.json', 'local/stellwerk/github-token'],
      },
      '--yes',
    );
    assert.equal(outcome.status, 0, outcome.output);
    assert.deepEqual(outcome.actions, [`/End ${DISPLAY_TASK}`, `/End ${HUB_TASK}`, `/End ${HARDWARE_TASK}`], 'stopped first');
    const deleted = outcome.calls.filter((c) => c.command === 'schtasks' && c.args[0] === '/Delete').map((c) => c.args[c.args.indexOf('/TN') + 1]);
    assert.deepEqual(deleted.sort(), [DISPLAY_TASK, HUB_TASK], 'the two logon tasks; the hardware task only as administrator');
    assert.doesNotMatch(outcome.files['home/.claude/settings.json'] ?? '', /hooks\/claude-code/, "Claude Code's hooks gone");
    assert.equal(outcome.files['codex/hooks.json'], null, "Codex' hooks.json held only Stellwerk's hooks");
    assert.ok(outcome.calls.some((c) => c.args.includes('unset STELLWERK_TOKEN')), 'the token variable removed');
    assert.equal(outcome.files['local/stellwerk/github-token'], 'github_pat_made_up', 'the GitHub token stays with --yes');
    assert.match(outcome.output, /Kept the GitHub token \(--yes keeps tokens and keys\)\. Remove with:\n {2}stellwerk github remove/);
    assert.match(outcome.output, /no administrator rights\. In one that has, run:\n {2}stellwerk hardware uninstall[\s\S]*\n {2}stellwerk uninstall /);
    assert.match(outcome.output, /Remove-Item -Recurse "[^"]*local\\stellwerk", "[^"]*roaming\\stellwerk"/);
    assert.ok(!outcome.calls.some((c) => c.command === 'netsh'), 'no firewall rule touched without administrator rights');
  });

  test('teardown as administrator removes the firewall rule, and leaves LibreHardwareMonitor alone when it is not set up', async () => {
    const outcome = await control('teardown', { tasks: [], hub: { running: false }, elevated: true, read: ['home/.claude/settings.json'] }, '--yes');
    assert.equal(outcome.status, 0, outcome.output);
    assert.match(outcome.output, /Stellwerk does not run\./);
    assert.match(outcome.output, /There are no Stellwerk tasks/);
    assert.match(outcome.output, /There is neither\./);
    assert.match(outcome.output, /LibreHardwareMonitor is not set up here\./);
    const rules = outcome.calls.filter((c) => c.command === 'netsh').map((c) => c.args.join(' '));
    assert.equal(rules.length, 1);
    assert.match(rules[0]!, /^advfirewall firewall delete rule name=Stellwerk-block-inbound-\d+$/);
    assert.deepEqual(outcome.actions, []);
    assert.equal(outcome.files['home/.claude/settings.json'], null, 'no settings file written where there was none');
  });
});
