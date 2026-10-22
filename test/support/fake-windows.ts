// For the command line's tests: Windows as a test describes it, so the real command line runs without
// touching the machine. Loaded with --import before the command line, it answers the screen list
// (PowerShell), task queries (schtasks /Query) and Task Scheduler's error code for a task (PowerShell) from
// STELLWERK_FAKE_WINDOWS, writes every program the command line starts to the file named there, lets
// spawnSync end at once with success, and refuses everything else: nothing is run, no task is changed.
// A task that is not there fails schtasks with a German message, as on the machine this was made on.
// The hub is played by a socket on a free port of 127.0.0.1, written to the configuration: ending its
// task closes it, running the task opens it. A new version's `codex install` writes its forwarder into
// Codex' hooks.json (in CODEX_HOME), as the real one would.
//
// SPDX-License-Identifier: Apache-2.0

import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { DISPLAY_TASK, HUB_TASK, type Screen } from '../../src/setup/autostart.ts';
import { withStellwerkCodexHooks } from '../../src/setup/codex-settings.ts';

export interface FakeWindows {
  screens: Screen[];
  /** Task name → its XML as schtasks /Query /XML gives it out; a task not named here does not exist. */
  tasks: Record<string, string>;
  /** What goes wrong with a task, by name: */
  faults?: Record<string, TaskFault>;
  /** The hub: running at the start (default), ended with its task (default), started by it (default). */
  hub?: { running?: boolean; endsWithTask?: boolean; starts?: boolean };
  /** spawnSync fails (status 1) for a program whose arguments hold this. */
  failing?: string;
  /** Where each call goes, one JSON line each. */
  calls: string;
}

export interface TaskFault {
  /** schtasks /Query fails with this message. */
  query?: string;
  /** schtasks /Query /XML fails with this message. */
  xml?: string;
  /** Task Scheduler answers this error code (0: the task is there). */
  code?: number;
  /** The PowerShell that asks Task Scheduler fails with this message. */
  powershell?: string;
}

export interface Call {
  via: 'execFileSync' | 'spawnSync';
  command: string;
  args: string[];
  cwd?: string;
  /** For PowerShell: what the script asked (for a task: its name). */
  asked?: 'screens' | 'task';
  task?: string;
}

/** HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND), as in src/setup/windows.ts. */
const NOT_FOUND = -2147024894;
const failed = (stderr: string) => Object.assign(new Error(`Command failed: ${stderr}`), { status: 1, stderr });

const fake = JSON.parse(process.env.STELLWERK_FAKE_WINDOWS ?? '') as FakeWindows;
const note = (call: Call) => fs.appendFileSync(fake.calls, `${JSON.stringify(call)}\n`);
const refuse = (what: string) => {
  throw new Error(`Not allowed in this test: ${what}`);
};

Object.defineProperty(process, 'platform', { value: 'win32' });
const childProcess = cp as unknown as Record<string, unknown>;

// The hub: a socket on a free port, which the configuration names.
const hub = { running: true, endsWithTask: true, starts: true, ...fake.hub };
let socket: net.Server | null = null;
const port = await new Promise<number>((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as net.AddressInfo;
    probe.close(() => resolve(port));
  });
});
const configDir = path.join(process.env.APPDATA ?? '', 'stellwerk');
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ port }));
const startHub = () => {
  socket ??= net.createServer((connection) => connection.destroy()).listen(port, '127.0.0.1');
  socket.unref();
};
const endHub = () => {
  socket?.close();
  socket = null;
};
if (hub.running) startHub();

childProcess.execFileSync = (command: string, args: string[] = [], options: { input?: string } = {}) => {
  if (/powershell/i.test(command)) {
    const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1] ?? '', 'base64').toString('utf16le');
    if (script.includes('AllScreens')) {
      note({ via: 'execFileSync', command, args: ['-EncodedCommand', '…'], asked: 'screens' });
      return JSON.stringify(fake.screens);
    }
    if (script.includes('Schedule.Service')) {
      const name = String(options.input ?? '').trim();
      note({ via: 'execFileSync', command, args: ['-EncodedCommand', '…'], asked: 'task', task: name });
      const fault = fake.faults?.[name];
      if (fault?.powershell !== undefined) throw failed(fault.powershell);
      return String(fault?.code ?? (name in fake.tasks ? 0 : NOT_FOUND));
    }
    return refuse('a PowerShell script other than the screen list and the task query');
  }
  note({ via: 'execFileSync', command, args });
  if (command === 'schtasks' && args[0] === '/Query') {
    const name = args[args.indexOf('/TN') + 1] ?? '';
    const fault = fake.faults?.[name];
    const message = args.includes('/XML') ? fault?.xml : fault?.query;
    if (message !== undefined) throw failed(message);
    const xml = fake.tasks[name];
    if (xml === undefined) throw failed('FEHLER: Das System kann die angegebene Datei nicht finden.');
    return args.includes('/XML') ? xml : 'Ordner: \\';
  }
  // Stellwerk's two tasks may be deleted (autostart uninstall); a missing one fails as schtasks would.
  if (command === 'schtasks' && args[0] === '/Delete' && [HUB_TASK, DISPLAY_TASK].includes(args[args.indexOf('/TN') + 1] ?? '')) {
    if (!((args[args.indexOf('/TN') + 1] ?? '') in fake.tasks)) throw failed('FEHLER: Das System kann die angegebene Datei nicht finden.');
    return 'ERFOLGREICH';
  }
  // Only the hub's task may be ended and started.
  if (command === 'schtasks' && (args[0] === '/End' || args[0] === '/Run') && args[args.indexOf('/TN') + 1] === HUB_TASK) {
    if (args[0] === '/End' && hub.endsWithTask) endHub();
    if (args[0] === '/Run' && hub.starts) startHub();
    return 'ERFOLGREICH';
  }
  return refuse(`${command} ${args.join(' ')}`);
};

childProcess.spawnSync = (command: string, args: string[] = [], options: { cwd?: string } = {}) => {
  note({ via: 'spawnSync', command, args, cwd: options.cwd });
  if (fake.failing !== undefined && args.some((arg) => arg.includes(fake.failing!))) {
    return { pid: 0, output: [], stdout: '', stderr: '', status: 1, signal: null };
  }
  // A new version's `codex install --yes`: its forwarder goes into Codex' hooks, next to its cli.js.
  if (args[1] === 'codex' && args[2] === 'install') {
    const file = path.join(process.env.CODEX_HOME ?? '', 'hooks.json');
    const current = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
    fs.writeFileSync(file, JSON.stringify(withStellwerkCodexHooks(current, path.join(path.dirname(args[0]!), 'codex', 'hook.js')), null, 2));
  }
  return { pid: 0, output: [], stdout: '', stderr: '', status: 0, signal: null };
};

for (const name of ['spawn', 'exec', 'execFile', 'execSync', 'fork']) childProcess[name] = () => refuse(name);
syncBuiltinESMExports();
