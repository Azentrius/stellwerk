// For the command line's tests: Windows as a test describes it, so the real command line runs without
// touching the machine. Loaded with --import before the command line, it answers the screen list
// (PowerShell), task queries (schtasks /Query) and Task Scheduler's error code for a task (PowerShell) from
// STELLWERK_FAKE_WINDOWS, writes every program the command line starts to the file named there, lets
// spawnSync end at once with success, and refuses everything else: nothing is run, no task is changed.
// A task that is not there fails schtasks with a German message, as on the machine this was made on.
// The hub is played by a socket on a free port of 127.0.0.1, written to the configuration: ending its
// task closes it, running the task opens it. A new version's `codex install` writes its forwarder into
// Codex' hooks.json (in CODEX_HOME), as the real one would. The display's Edge is counted by its profile:
// ending the display task closes it, running the task opens it. Codex' hooks.json can be made unreadable.
//
// SPDX-License-Identifier: Apache-2.0

import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { DISPLAY_TASK, HUB_TASK, type Screen } from '../../src/setup/autostart.ts';
import { HARDWARE_TASK } from '../../src/setup/hardware.ts';
import { withStellwerkCodexHooks } from '../../src/setup/codex-settings.ts';

export interface FakeWindows {
  screens: Screen[];
  /** Task name → its XML as schtasks /Query /XML gives it out; a task not named here does not exist. */
  tasks: Record<string, string>;
  /** What goes wrong with a task, by name: */
  faults?: Record<string, TaskFault>;
  /** The hub: running at the start (default), ended with its task (default), started by it (default). */
  hub?: { running?: boolean; endsWithTask?: boolean; starts?: boolean };
  /**
   * The display's Edge: running at the start (default), closed when its task ends (default), opened by it
   * (default: else /Run fails); counting it fails with `count`.
   */
  display?: { running?: boolean; endsWithTask?: boolean; starts?: boolean; count?: string };
  /** Codex' hooks.json cannot be read (EACCES): always, or only once the hub was started again (at the cleanup). */
  codexUnreadable?: 'always' | 'at-cleanup';
  /** User environment variables as Windows stores them (getUserEnv, setUserEnv). */
  userEnv?: Record<string, string>;
  /** The terminal runs with administrator rights (isElevated). */
  elevated?: boolean;
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
  asked?: 'screens' | 'task' | 'edge';
  task?: string;
}

/**
 * The values on PowerShell's standard input, as src/setup/windows.ts sends them: each as Base64 of its UTF-8
 * on a line of its own. Anything else there is refused: a console code page could change it.
 */
function values(input: unknown): string[] {
  const text = String(input ?? '');
  if (/[^\x20-\x7e\n]/.test(text)) refuse(`text on standard input that is not Base64: ${JSON.stringify(text)}`);
  return text
    .split('\n')
    .filter((line) => line.startsWith(':'))
    .map((line) => Buffer.from(line.slice(1), 'base64').toString('utf8'));
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
// The display's Edge, played by a number of processes with its profile.
const display = { running: true, endsWithTask: true, starts: true, ...fake.display };
// Codex' hooks.json made unreadable, from the start or once the hub's task ran (the cleanup).
let hubRestarted = false;
const readFile = fs.readFileSync;
(fs as unknown as Record<string, unknown>).readFileSync = (file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
  const unreadable = fake.codexUnreadable === 'always' || (fake.codexUnreadable === 'at-cleanup' && hubRestarted);
  if (unreadable && typeof file === 'string' && path.resolve(file) === path.resolve(process.env.CODEX_HOME ?? '', 'hooks.json')) {
    throw Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' });
  }
  return (readFile as (...args: unknown[]) => unknown)(file, ...rest);
};
let socket: net.Server | null = null;
const port = await new Promise<number>((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as net.AddressInfo;
    probe.close(() => resolve(port));
  });
});
const configDir = path.join(process.env.APPDATA ?? '', 'stellwerk');
fs.mkdirSync(configDir, { recursive: true });
// A configuration the test wrote keeps its other settings.
const configFile = path.join(configDir, 'config.json');
const earlier = fs.existsSync(configFile) ? (JSON.parse(String(readFile(configFile, 'utf8'))) as Record<string, unknown>) : {};
fs.writeFileSync(configFile, JSON.stringify({ ...earlier, port }));
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
    if (script.includes('msedge.exe')) {
      note({ via: 'execFileSync', command, args: ['-EncodedCommand', '…'], asked: 'edge', task: values(options.input)[0] });
      if (display.count !== undefined) throw failed(display.count);
      return String(display.running ? 3 : 0);
    }
    if (script.includes('IsInRole')) {
      note({ via: 'execFileSync', command, args: ['-EncodedCommand', '…'] });
      return fake.elevated ? 'True' : 'False';
    }
    if (script.includes('SetEnvironmentVariable')) {
      const name = /SetEnvironmentVariable\('([^']+)'/.exec(script)?.[1] ?? '';
      note({ via: 'execFileSync', command, args: ['-EncodedCommand', '…', `set ${name}`] });
      fake.userEnv = { ...fake.userEnv, [name]: values(options.input)[0] ?? '' };
      return '';
    }
    if (script.includes('GetEnvironmentVariable')) {
      const name = /GetEnvironmentVariable\('([^']+)'/.exec(script)?.[1] ?? '';
      note({ via: 'execFileSync', command, args: ['-EncodedCommand', '…'] });
      const value = fake.userEnv?.[name];
      return value === undefined ? '' : Buffer.from(value, 'utf8').toString('base64');
    }
    if (script.includes('.State')) {
      const name = values(options.input)[0] ?? '';
      note({ via: 'execFileSync', command, args: ['-EncodedCommand', '…'], asked: 'task', task: name });
      return name in fake.tasks ? (name === HUB_TASK && !hub.running ? '3' : '4') : `error ${NOT_FOUND}`;
    }
    if (script.includes('Schedule.Service')) {
      const name = values(options.input)[0] ?? '';
      note({ via: 'execFileSync', command, args: ['-EncodedCommand', '…'], asked: 'task', task: name });
      const fault = fake.faults?.[name];
      if (fault?.powershell !== undefined) throw failed(fault.powershell);
      return String(fault?.code ?? (name in fake.tasks ? 0 : NOT_FOUND));
    }
    return refuse("a PowerShell script other than the screen list, the task query and the display's Edge");
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
  // A file only the current user may read (the token, the display's start file): nothing to do here.
  if (/icacls/i.test(command)) return '';
  // Stellwerk's tasks may be registered from their XML file (UTF-16 with a byte order mark).
  if (command === 'schtasks' && args[0] === '/Create') {
    const name = args[args.indexOf('/TN') + 1] ?? '';
    fake.tasks[name] = (readFile(args[args.indexOf('/XML') + 1]!) as Buffer).subarray(2).toString('utf16le');
    return 'ERFOLGREICH';
  }
  // The display's task may be ended and run: its Edge closes and opens.
  if (command === 'schtasks' && (args[0] === '/End' || args[0] === '/Run') && args[args.indexOf('/TN') + 1] === DISPLAY_TASK) {
    if (args[0] === '/End' && display.endsWithTask) display.running = false;
    if (args[0] === '/Run' && !display.starts) throw failed('FEHLER: Die Aufgabe konnte nicht gestartet werden.');
    if (args[0] === '/Run') display.running = true;
    return 'ERFOLGREICH';
  }
  // The hardware monitor's task may be ended and run: nothing more to it here.
  if (command === 'schtasks' && (args[0] === '/End' || args[0] === '/Run') && args[args.indexOf('/TN') + 1] === HARDWARE_TASK) {
    return 'ERFOLGREICH';
  }
  // The hub's task may be ended and started.
  if (command === 'schtasks' && (args[0] === '/End' || args[0] === '/Run') && args[args.indexOf('/TN') + 1] === HUB_TASK) {
    if (args[0] === '/End' && hub.endsWithTask) endHub();
    if (args[0] === '/Run' && hub.starts) startHub();
    if (args[0] === '/Run') hubRestarted = true;
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
