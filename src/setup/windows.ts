// The changes to Windows that setting up Stellwerk makes: the user environment variable that gives Claude
// Code the token, firewall rules that block ports from outside, and the Task Scheduler tasks for the start
// with Windows and the hardware monitor. Fixed programs and arguments, no shell; values go into PowerShell
// on standard input, and the token never on a command line.
//
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Screen } from './autostart.ts';

function requireWindows(): void {
  if (process.platform !== 'win32') throw new Error('This step is only needed on Windows.');
}

/**
 * Runs a fixed PowerShell script; passed encoded, so no quote in it is ever read twice. Values never go into
 * the script: they go in on standard input, each as Base64 of its UTF-8 on a line of its own, and the script
 * finds them decoded, in order, in `$values`. Read as text, standard input would be decoded with the
 * console's code page, and a path with "ö" would become another path.
 */
function powershell(script: string, values: string[] = []): string {
  const read =
    "$values = @(foreach ($line in [Console]::In.ReadToEnd().Split([char]10)) { if ($line.StartsWith(':')) { " +
    '[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Substring(1).Trim())) } })';
  const encoded = Buffer.from(`${read}; ${script}`, 'utf16le').toString('base64');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input: values.map((value) => `:${Buffer.from(value, 'utf8').toString('base64')}\n`).join(''),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

/** The current user as Task Scheduler names it: DOMAIN\name. */
export function currentUser(): string {
  const name = os.userInfo().username;
  return process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${name}` : name;
}

/** All screens with their position and size in physical pixels (asked as a per-monitor DPI aware process). */
export function listScreens(): Screen[] {
  requireWindows();
  const script = [
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class StellwerkDpi { [DllImport(\"user32.dll\")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value); }'",
    '[void][StellwerkDpi]::SetProcessDpiAwarenessContext([IntPtr]-4)',
    'Add-Type -AssemblyName System.Windows.Forms',
    '@([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [pscustomobject]@{ name = $_.DeviceName; primary = $_.Primary; x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height } }) | ConvertTo-Json -Compress',
  ].join('; ');
  const parsed = JSON.parse(powershell(script)) as Screen | Screen[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function findEdge(): string {
  const candidates = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter((dir): dir is string => Boolean(dir))
    .map((dir) => path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  const edge = candidates.find((file) => fs.existsSync(file));
  if (!edge) throw new Error('Microsoft Edge was not found.');
  return edge;
}

export function conhostPath(): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'conhost.exe');
}

/** Registers (or replaces) a task from its XML. */
export function registerTask(name: string, xml: string): void {
  requireWindows();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-task-'));
  const file = path.join(dir, 'task.xml');
  try {
    // Task Scheduler reads UTF-16 with a byte order mark.
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));
    run('schtasks', ['/Create', '/TN', name, '/XML', file, '/F']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Whether the task is there. It is missing only when Task Scheduler itself says so: a task that could not
 * be read, or a Task Scheduler that does not answer, throws instead of counting as missing.
 */
export function taskExists(name: string): boolean {
  requireWindows();
  try {
    run('schtasks', ['/Query', '/TN', name]);
    return true;
  } catch (err) {
    // schtasks fails alike when the task is missing and when it cannot be read (exit 1, a message in the
    // system's language); Task Scheduler's own error code tells the two apart.
    let code: number;
    try {
      code = taskQueryCode(name);
    } catch (inner) {
      const { stderr } = inner as { stderr?: string };
      throw unreadableTask(name, `${(err as Error).message}; ${(String(stderr ?? '').trim() || (inner as Error).message).slice(0, 300)}`);
    }
    if (code === TASK_NOT_FOUND) return false;
    throw unreadableTask(name, `${(err as Error).message} (code 0x${(code >>> 0).toString(16)})`);
  }
}

/** Task Scheduler's error code for a task that is not there: HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND). */
export const TASK_NOT_FOUND = -2147024894;

/**
 * A task as Task Scheduler gives it out (XML); null only when Task Scheduler says there is no such task.
 * A task that could not be read is not a missing one: then this throws.
 */
export function taskDefinition(name: string): string | null {
  if (!taskExists(name)) return null;
  try {
    return run('schtasks', ['/Query', '/TN', name, '/XML']);
  } catch (err) {
    throw unreadableTask(name, (err as Error).message);
  }
}

/** What Task Scheduler's own interface answers when asked for the task: 0 when it is there, else its error code. */
function taskQueryCode(name: string): number {
  // The name goes in on stdin. COM wraps the error code in PowerShell's exception: the innermost holds it.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$name = $values[0]',
    'try { $service = New-Object -ComObject Schedule.Service; $service.Connect(); [void]$service.GetFolder([string][char]92).GetTask($name); 0 } ' +
      'catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; $e.HResult }',
  ].join('; ');
  const answer = powershell(script, [name]);
  if (!/^-?\d+$/.test(answer)) throw new Error(`Task Scheduler gave no error code (${JSON.stringify(answer.slice(0, 200))})`);
  return Number(answer);
}

function unreadableTask(name: string, detail: string): Error {
  return new Error(`Task Scheduler could not read the task "${name}": ${detail}`);
}

export function deleteTask(name: string): void {
  requireWindows();
  run('schtasks', ['/Delete', '/TN', name, '/F']);
}

export function startTask(name: string): void {
  requireWindows();
  run('schtasks', ['/Run', '/TN', name]);
}

/** Ends a running task; a task that does not run is left alone. */
export function endTask(name: string): void {
  requireWindows();
  try {
    run('schtasks', ['/End', '/TN', name]);
  } catch {
    // Not running.
  }
}

/** True in a terminal opened as administrator. */
export function isElevated(): boolean {
  requireWindows();
  const script =
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)';
  return powershell(script) === 'True';
}

/** What Task Scheduler says of a task: its state, or that it is not there (by its error code, in any language). */
export type TaskState = 'missing' | 'disabled' | 'queued' | 'ready' | 'running';

export function taskState(name: string): TaskState {
  requireWindows();
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'try { $service = New-Object -ComObject Schedule.Service; $service.Connect(); [string]$service.GetFolder([string][char]92).GetTask($values[0]).State } ' +
      "catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; 'error ' + $e.HResult }",
  ].join('; ');
  const answer = powershell(script, [name]);
  if (answer === `error ${TASK_NOT_FOUND}`) return 'missing';
  const state = ({ '1': 'disabled', '2': 'queued', '3': 'ready', '4': 'running' } as const)[answer];
  if (!state) throw unreadableTask(name, answer.slice(0, 200));
  return state;
}

/**
 * How many Edge processes run with this profile folder (--user-data-dir); the folder goes in on stdin. Edge
 * passes it on to its child processes in quotes, and Windows paths ignore case.
 */
export function edgeWithProfile(profileDir: string): number {
  requireWindows();
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$flag = ('--user-data-dir=' + $values[0] + ' ').ToLowerInvariant()",
    "@(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -and ($_.CommandLine.Replace('\"', '') + ' ').ToLowerInvariant().Contains($flag) }).Count",
  ].join('; ');
  let answer: string;
  try {
    answer = powershell(script, [profileDir]);
  } catch (err) {
    const { stderr } = err as { stderr?: string };
    answer = (String(stderr ?? '').trim() || (err as Error).message).slice(0, 300);
  }
  if (!/^\d+$/.test(answer)) throw new Error(`Could not count the display's Edge processes (${answer}).`);
  return Number(answer);
}

/** Ends every process started from exactly this program file and waits for it (the path goes in on stdin). */
export function stopProgram(exe: string): void {
  requireWindows();
  // No such process is no error (exit 0); a process that cannot be ended is one (exit 1).
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$exe = $values[0]',
    '$name = [IO.Path]::GetFileNameWithoutExtension($exe)',
    '$found = @(Get-Process -Name $name -ErrorAction Ignore | Where-Object { $_.Path -eq $exe })',
    'foreach ($p in $found) { $p.Kill(); [void]$p.WaitForExit(10000) }',
    'exit 0',
  ].join('; ');
  powershell(script, [exe]);
}

function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    const { stdout, stderr } = err as { stdout?: string; stderr?: string };
    throw new Error(`${String(stderr ?? '').trim() || String(stdout ?? '').trim() || (err as Error).message}`);
  }
}

/**
 * Reads a user environment variable as stored for new processes (not this process's copy). It comes out as
 * Base64 of its UTF-8, like the values that go in, so the console's code page cannot change it either.
 */
export function getUserEnv(name: string): string | null {
  requireWindows();
  const value = powershell(
    `$v = [Environment]::GetEnvironmentVariable('${name}', 'User'); if ($v) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v)) }`,
  );
  return value === '' ? null : Buffer.from(value, 'base64').toString('utf8');
}

/** Sets (or with null removes) a user environment variable; Windows tells running programs about it. */
export function setUserEnv(name: string, value: string | null): void {
  requireWindows();
  if (value === null) {
    powershell(`[Environment]::SetEnvironmentVariable('${name}', $null, 'User')`);
  } else {
    powershell(`[Environment]::SetEnvironmentVariable('${name}', $values[0], 'User')`, [value]);
  }
}

export function firewallRuleName(port: number): string {
  return `Stellwerk-block-inbound-${port}`;
}

/** Blocks inbound connections to the port from other machines. Needs an elevated terminal. */
export function addFirewallRule(port: number): void {
  requireWindows();
  removeFirewallRule(port, { quiet: true });
  netsh([
    'advfirewall', 'firewall', 'add', 'rule',
    `name=${firewallRuleName(port)}`,
    'dir=in', 'action=block', 'protocol=TCP', `localport=${port}`, 'profile=any',
  ]);
}

export function removeFirewallRule(port: number, { quiet = false } = {}): void {
  requireWindows();
  try {
    netsh(['advfirewall', 'firewall', 'delete', 'rule', `name=${firewallRuleName(port)}`]);
  } catch (err) {
    if (!quiet) throw err;
  }
}

function netsh(args: string[]): void {
  try {
    execFileSync('netsh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    const output = String((err as { stdout?: string }).stdout ?? '').trim();
    throw new Error(output || (err as Error).message);
  }
}
