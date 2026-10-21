// For the command line's tests: Windows as a test describes it, so the real command line runs without
// touching the machine. Loaded with --import before the command line, it answers the screen list
// (PowerShell) and task queries (schtasks /Query) from STELLWERK_FAKE_WINDOWS, writes every program the
// command line starts to the file named there, lets spawnSync end at once with success, and refuses
// everything else: nothing is run, no task is changed.
//
// SPDX-License-Identifier: Apache-2.0

import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import type { Screen } from '../../src/setup/autostart.ts';

export interface FakeWindows {
  screens: Screen[];
  /** Task name → its XML as schtasks /Query /XML gives it out; a task not named here does not exist. */
  tasks: Record<string, string>;
  /** Where each call goes, one JSON line each. */
  calls: string;
}

export interface Call {
  via: 'execFileSync' | 'spawnSync';
  command: string;
  args: string[];
  cwd?: string;
  /** For PowerShell: what the script asked. */
  asked?: 'screens';
}

const fake = JSON.parse(process.env.STELLWERK_FAKE_WINDOWS ?? '') as FakeWindows;
const note = (call: Call) => fs.appendFileSync(fake.calls, `${JSON.stringify(call)}\n`);
const refuse = (what: string) => {
  throw new Error(`Not allowed in this test: ${what}`);
};

Object.defineProperty(process, 'platform', { value: 'win32' });
const childProcess = cp as unknown as Record<string, unknown>;

childProcess.execFileSync = (command: string, args: string[] = []) => {
  if (/powershell/i.test(command)) {
    const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1] ?? '', 'base64').toString('utf16le');
    if (!script.includes('AllScreens')) refuse(`a PowerShell script other than the screen list`);
    note({ via: 'execFileSync', command, args: ['-EncodedCommand', '…'], asked: 'screens' });
    return JSON.stringify(fake.screens);
  }
  note({ via: 'execFileSync', command, args });
  if (command === 'schtasks' && args[0] === '/Query') {
    const xml = fake.tasks[args[args.indexOf('/TN') + 1] ?? ''];
    if (xml === undefined) throw Object.assign(new Error('schtasks failed'), { stderr: 'ERROR: The system cannot find the file specified.' });
    return args.includes('/XML') ? xml : 'Folder: \\';
  }
  return refuse(`${command} ${args.join(' ')}`);
};

childProcess.spawnSync = (command: string, args: string[] = [], options: { cwd?: string } = {}) => {
  note({ via: 'spawnSync', command, args, cwd: options.cwd });
  return { pid: 0, output: [], stdout: '', stderr: '', status: 0, signal: null };
};

for (const name of ['spawn', 'exec', 'execFile', 'execSync', 'fork']) childProcess[name] = () => refuse(name);
syncBuiltinESMExports();
