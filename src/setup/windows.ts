// The two changes to Windows that setting up Stellwerk makes: the user environment variable that gives
// Claude Code the token, and a firewall rule that blocks the port from outside. Fixed programs and
// arguments, no shell; the token goes in on standard input, never on a command line.
//
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process';

function requireWindows(): void {
  if (process.platform !== 'win32') throw new Error('This step is only needed on Windows.');
}

function powershell(script: string, input = ''): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
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
