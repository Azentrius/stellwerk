#!/usr/bin/env node
// Stellwerk's command line: start the hub; add and remove the hooks and the firewall rule.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { HOST, defaultPaths, loadConfig, readJsonFile } from './config.ts';
import { startHub } from './hub/hub.ts';
import {
  DEFAULT_SETTINGS_FILE,
  TOKEN_ENV,
  formatSettings,
  lineDiff,
  withStellwerkHooks,
  withoutStellwerkHooks,
} from './setup/claude-settings.ts';
import { addFirewallRule, firewallRuleName, getUserEnv, removeFirewallRule, setUserEnv } from './setup/windows.ts';
import { ensureToken } from './token.ts';

/** The repository root: one level above src/ (running from source) or dist/ (built). */
const ROOT = path.join(import.meta.dirname, '..');
const VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

const USAGE = `Stellwerk ${VERSION}: a signal box for your AI agents

Usage:
  stellwerk serve [--debug-raw] [--simulate-hang]
      Start the hub on ${HOST}. Then open the display:
      msedge --app=http://${HOST}:4780
  stellwerk hooks install [--yes] [--settings <file>]
      Add Stellwerk's hooks to Claude Code's settings and give Claude Code the token
      through the user environment variable ${TOKEN_ENV}.
  stellwerk hooks uninstall [--yes] [--settings <file>]
      Remove exactly these hooks and the environment variable.
  stellwerk install
      Add a Windows Firewall rule that blocks the port for other machines (as administrator).
  stellwerk uninstall
      Remove that rule (as administrator).

Configuration: %APPDATA%\\stellwerk\\config.json (port, holdSeconds, sound, scale, debugRawLog).
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      yes: { type: 'boolean', short: 'y', default: false },
      settings: { type: 'string', default: DEFAULT_SETTINGS_FILE },
      'debug-raw': { type: 'boolean', default: false },
      'simulate-hang': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
    },
  });
  const [command, action] = positionals;

  if (values.version) return void console.log(VERSION);
  if (values.help || !command) return void console.log(USAGE);
  if (command === 'serve') return serve(values['debug-raw'], values['simulate-hang']);
  if (command === 'hooks' && (action === 'install' || action === 'uninstall')) {
    return hooks(action, values.settings, values.yes);
  }
  if (command === 'install' || command === 'uninstall') return firewall(command);
  console.error(USAGE);
  process.exitCode = 2;
}

async function serve(debugRaw: boolean, simulateHang: boolean): Promise<void> {
  const paths = defaultPaths();
  const config = loadConfig(paths.configFile);
  const { token, created } = ensureToken(paths.tokenFile);
  const rawLog = debugRaw || config.debugRawLog;
  let hub;
  try {
    hub = await startHub({
      port: config.port,
      token,
      holdMs: config.holdSeconds * 1000,
      scale: config.scale,
      sound: config.sound,
      auditFile: paths.auditFile,
      uiRoot: path.join(ROOT, 'ui'),
      webRoot: path.join(ROOT, 'dist', 'ui'),
      rawLogFile: rawLog ? paths.rawLogFile : null,
      simulateHang,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(`Port ${config.port} is already in use. Is Stellwerk running already?`);
    }
    throw err;
  }
  const url = `http://${HOST}:${hub.port}`;
  console.log(`Stellwerk ${VERSION} on ${url}`);
  console.log(`Display: msedge --app=${url}`);
  console.log(`Hold time ${config.holdSeconds} s. Audit log: ${paths.auditFile}`);
  if (created) console.log(`A new token was created. Run "stellwerk hooks install" so that Claude Code sends it.`);
  if (hub.missingBuild) console.log('The display is not built yet. Run "npm run build" first.');
  if (rawLog) console.log(`Debug: raw hook data goes to ${paths.rawLogFile}. It holds prompts and code, delete it afterwards.`);
  if (simulateHang) console.log('Debug: status hooks are not answered (simulated hang).');
  console.log('Ctrl+C stops the hub.\n');

  const stop = () => void hub.close().then(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function hooks(action: 'install' | 'uninstall', file: string, yes: boolean): Promise<void> {
  const paths = defaultPaths();
  const config = loadConfig(paths.configFile);
  const exists = fs.existsSync(file);
  const before = exists ? fs.readFileSync(file, 'utf8') : '';
  const current = exists ? readJsonFile(file) : {};
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new Error(`${file} does not hold a JSON object. Nothing changed.`);
  }
  const settings = current as Record<string, unknown>;
  const after = formatSettings(action === 'install' ? withStellwerkHooks(settings, config.port) : withoutStellwerkHooks(settings));
  const settingsChange = normalize(after) !== normalize(before);

  const onWindows = process.platform === 'win32';
  const token = action === 'install' ? ensureToken(paths.tokenFile).token : null;
  const envNow = onWindows ? getUserEnv(TOKEN_ENV) : null;
  const envChange = onWindows && envNow !== token;

  if (!settingsChange && !envChange) return void console.log('Nothing to change.');
  if (settingsChange) {
    console.log(`${file}\n`);
    console.log(colorDiff(lineDiff(before, after)));
    console.log();
  }
  if (envChange) {
    console.log(
      action === 'install'
        ? `Set the user environment variable ${TOKEN_ENV} (the hook token).`
        : `Remove the user environment variable ${TOKEN_ENV}.`,
    );
  }
  if (!onWindows && action === 'install') {
    console.log(`Not on Windows: give the processes that run Claude Code the variable ${TOKEN_ENV} yourself.`);
  }
  if (!(await confirm(yes))) return void console.log('Nothing changed.');

  if (settingsChange) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (exists) {
      const backup = `${file}.stellwerk-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
      fs.copyFileSync(file, backup);
      console.log(`Backup: ${backup}`);
    }
    fs.writeFileSync(file, after);
    console.log(`Written: ${file}`);
  }
  if (envChange) {
    setUserEnv(TOKEN_ENV, token);
    console.log(action === 'install' ? `${TOKEN_ENV} set.` : `${TOKEN_ENV} removed.`);
  }
  console.log('Restart the Claude desktop app (and terminals running Claude Code) so that the change applies.');
}

function firewall(command: 'install' | 'uninstall'): void {
  const config = loadConfig(defaultPaths().configFile);
  const name = firewallRuleName(config.port);
  try {
    if (command === 'install') addFirewallRule(config.port);
    else removeFirewallRule(config.port);
  } catch (err) {
    throw new Error(`${(err as Error).message}\nRun this in a terminal opened as administrator.`);
  }
  console.log(
    command === 'install'
      ? `Firewall rule "${name}" added: inbound connections to TCP ${config.port} from other machines are blocked.`
      : `Firewall rule "${name}" removed.`,
  );
}

async function confirm(yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error('No terminal to confirm in. Run again with --yes to apply without asking.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Apply these changes? [y/N] ');
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function normalize(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

function colorDiff(lines: string[]): string {
  if (!process.stdout.isTTY) return lines.join('\n');
  return lines
    .map((line) => (line.startsWith('+ ') ? `\x1b[32m${line}\x1b[0m` : line.startsWith('- ') ? `\x1b[31m${line}\x1b[0m` : line))
    .join('\n');
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
