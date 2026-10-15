// The changes to Windows that setting up Stellwerk makes: the user environment variable that gives Claude
// Code the token, a firewall rule that blocks the port from outside, and the Task Scheduler tasks for the
// start with Windows. Fixed programs and arguments, no shell; the token goes in on standard input, never
// on a command line.
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

/** Runs a fixed PowerShell script; passed encoded, so no quote in it is ever read twice. */
function powershell(script: string, input = ''): string {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input,
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

export function taskExists(name: string): boolean {
  requireWindows();
  try {
    run('schtasks', ['/Query', '/TN', name]);
    return true;
  } catch {
    return false;
  }
}

export function deleteTask(name: string): void {
  requireWindows();
  run('schtasks', ['/Delete', '/TN', name, '/F']);
}

export function startTask(name: string): void {
  requireWindows();
  run('schtasks', ['/Run', '/TN', name]);
}

function run(command: string, args: string[]): void {
  try {
    execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    const { stdout, stderr } = err as { stdout?: string; stderr?: string };
    throw new Error(`${String(stderr ?? '').trim() || String(stdout ?? '').trim() || (err as Error).message}`);
  }
}

/** Reads a user environment variable as stored for new processes (not this process's copy). */
export function getUserEnv(name: string): string | null {
  requireWindows();
  const value = powershell(`[Environment]::GetEnvironmentVariable('${name}', 'User')`);
  return value === '' ? null : value;
}

/** Sets (or with null removes) a user environment variable; Windows tells running programs about it. */
export function setUserEnv(name: string, value: string | null): void {
  requireWindows();
  if (value === null) {
    powershell(`[Environment]::SetEnvironmentVariable('${name}', $null, 'User')`);
  } else {
    powershell(`$v = [Console]::In.ReadLine(); [Environment]::SetEnvironmentVariable('${name}', $v, 'User')`, `${value}\n`);
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
