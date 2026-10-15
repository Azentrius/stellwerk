#!/usr/bin/env node
// Stellwerk's command line: start the hub; add and remove the hooks, the firewall rule, the start with
// Windows, the GitHub token and the hardware monitor.
//
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { format, parseArgs } from 'node:util';
import { GITHUB_OWNER, HOST, defaultPaths, loadConfig, readJsonFile, setConfigValue } from './config.ts';
import { GitHubWatcher, describeProblem } from './hub/github.ts';
import {
  HARDWARE_INTERVAL_MS,
  LHM_PORT,
  LHM_SETTINGS_FILE,
  appSettingsXml,
  parseAppSettings,
} from './hub/hardware.ts';
import { startHub } from './hub/hub.ts';
import {
  DISPLAY_TASK,
  HUB_TASK,
  commandLine,
  describeScreens,
  displayTask,
  hubTask,
  pickScreen,
  taskXml,
} from './setup/autostart.ts';
import {
  DEFAULT_SETTINGS_FILE,
  TOKEN_ENV,
  formatSettings,
  lineDiff,
  withStellwerkHooks,
  withoutStellwerkHooks,
} from './setup/claude-settings.ts';
import {
  HARDWARE_TASK,
  LHM_ARCHIVE_SHA256,
  LHM_ARCHIVE_URL,
  LHM_EXE,
  LHM_USER,
  LHM_VERSION,
  checkArchive,
  downloadArchive,
  hardwareTask,
  installFiles,
  lhmSettings,
  removeFiles,
  unzip,
} from './setup/hardware.ts';
import {
  addFirewallRule,
  conhostPath,
  currentUser,
  deleteTask,
  endTask,
  findEdge,
  firewallRuleName,
  getUserEnv,
  isElevated,
  listScreens,
  registerTask,
  removeFirewallRule,
  setUserEnv,
  startTask,
  stopProgram,
  taskExists,
} from './setup/windows.ts';
import { ensureToken, isGitHubToken, readGitHubToken, removeGitHubToken, saveGitHubToken } from './token.ts';

/** hub.log is moved to hub.log.1 when it grows beyond this at a start. */
const MAX_HUB_LOG_BYTES = 1024 * 1024;
/** How often a hub started with --exit-with-parent looks whether its parent still runs. */
const PARENT_CHECK_MS = 2000;

/** The repository root: one level above src/ (running from source) or dist/ (built). */
const ROOT = path.join(import.meta.dirname, '..');
const VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

const USAGE = `Stellwerk ${VERSION}: a signal box for your AI agents

Usage:
  stellwerk serve [--debug-raw] [--simulate-hang] [--log-file <file>] [--exit-with-parent]
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
  stellwerk autostart install [--yes] [--screen <number>]
      Start the hub (without a window) and the display (full screen on the 1920x720 screen,
      or the one given) at logon, through two Task Scheduler tasks.
  stellwerk autostart uninstall [--yes]
      Remove these tasks.
  stellwerk github token [--owner <name>]
      Show the owner's open pull requests: asks for a read-only fine-grained token
      (input hidden), tries it once against api.github.com and keeps it for the hub.
  stellwerk github remove
      Forget the GitHub token; the hub then opens no connection to GitHub.
  stellwerk hardware install [--yes]
      Show processor, graphics card and memory: set up LibreHardwareMonitor ${LHM_VERSION} from its
      official release (checked by SHA-256) with a password, a firewall rule and a logon task
      (as administrator).
  stellwerk hardware uninstall [--yes]
      Remove it again (as administrator).

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
      'log-file': { type: 'string' },
      'exit-with-parent': { type: 'boolean', default: false },
      owner: { type: 'string' },
      screen: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
    },
  });
  const [command, action] = positionals;

  if (values.version) return void console.log(VERSION);
  if (values.help || !command) return void console.log(USAGE);
  if (command === 'serve') {
    return serve(values['debug-raw'], values['simulate-hang'], values['log-file'], values['exit-with-parent']);
  }
  if (command === 'hooks' && (action === 'install' || action === 'uninstall')) {
    return hooks(action, values.settings, values.yes);
  }
  if (command === 'install' || command === 'uninstall') return firewall(command);
  if (command === 'autostart' && (action === 'install' || action === 'uninstall')) {
    return autostart(action, values.yes, values.screen);
  }
  if (command === 'github' && (action === 'token' || action === 'remove')) return githubToken(action, values.owner);
  if (command === 'hardware' && (action === 'install' || action === 'uninstall')) return hardware(action, values.yes);
  console.error(USAGE);
  process.exitCode = 2;
}

async function serve(
  debugRaw: boolean,
  simulateHang: boolean,
  logFile: string | undefined,
  exitWithParent: boolean,
): Promise<void> {
  if (logFile) logToFile(logFile);
  const paths = defaultPaths();
  const config = loadConfig(paths.configFile);
  const { token, created } = ensureToken(paths.tokenFile);
  const rawLog = debugRaw || config.debugRawLog;
  const githubToken = config.githubOwner ? readGitHubToken(paths.githubTokenFile) : null;
  const github =
    config.githubOwner && githubToken
      ? { owner: config.githubOwner, token: githubToken, intervalMs: config.githubIntervalSeconds * 1000 }
      : null;
  const hardware = config.hardwareMonitor
    ? { settingsFile: path.join(paths.hardwareDir, LHM_SETTINGS_FILE), intervalMs: HARDWARE_INTERVAL_MS }
    : null;
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
      github,
      hardware,
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
  if (github) {
    console.log(`Open pull requests of ${github.owner} from api.github.com, every ${config.githubIntervalSeconds} s.`);
  } else if (config.githubOwner) {
    console.log(`githubOwner is set, but there is no GitHub token. Run "stellwerk github token".`);
  }
  if (hardware) console.log(`Hardware values from LibreHardwareMonitor on 127.0.0.1:${LHM_PORT}, every ${HARDWARE_INTERVAL_MS / 1000} s.`);
  console.log('Ctrl+C stops the hub.\n');

  const stop = () => void hub.close().then(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (exitWithParent) watchParent(stop);
}

/**
 * Stops the hub when the process that started it ends. The task at logon runs the hub under a console
 * host without a window; ending the task ends only that host, so the hub has to notice by itself.
 */
function watchParent(stop: () => void): void {
  const parent = process.ppid;
  const timer = setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') return;
      clearInterval(timer);
      console.log(`${new Date().toTimeString().slice(0, 8)}  The process that started the hub has ended; stopping.`);
      stop();
    }
  }, PARENT_CHECK_MS);
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

async function autostart(action: 'install' | 'uninstall', yes: boolean, screenNumber: string | undefined): Promise<void> {
  const paths = defaultPaths();
  const config = loadConfig(paths.configFile);

  if (action === 'uninstall') {
    const existing = [HUB_TASK, DISPLAY_TASK].filter(taskExists);
    if (existing.length === 0) return void console.log('There are no Stellwerk tasks in the Task Scheduler.');
    console.log(`Remove the tasks ${existing.map((name) => `"${name}"`).join(' and ')} from the Task Scheduler.`);
    console.log('A hub or display already running keeps running until you close it or log off.\n');
    if (!(await confirm(yes))) return void console.log('Nothing changed.');
    for (const name of existing) deleteTask(name);
    return void console.log('Removed.');
  }

  const cli = path.join(ROOT, 'dist', 'cli.js');
  if (!fs.existsSync(cli)) throw new Error('dist/cli.js is missing. Run "npm run build" first.');
  if (screenNumber !== undefined && !/^[1-9]\d*$/.test(screenNumber)) throw new Error('--screen takes the number of a screen.');
  const screens = listScreens();
  const screen = pickScreen(screens, screenNumber === undefined ? undefined : Number(screenNumber));
  const user = currentUser();
  const tasks = [
    hubTask({ node: process.execPath, cli, root: ROOT, logFile: paths.hubLogFile, conhost: conhostPath() }),
    displayTask({ edge: findEdge(), url: `http://${HOST}:${config.port}`, profileDir: paths.displayProfileDir, screen, root: ROOT }),
  ];

  console.log(`Screens:\n${describeScreens(screens)}\nThe display goes full screen on screen ${screens.indexOf(screen) + 1}.\n`);
  for (const task of tasks) {
    const when = task.delaySeconds > 0 ? `${task.delaySeconds} s after logon` : 'at logon';
    console.log(`Task "${task.name}" for ${user}, ${when}:\n  ${commandLine([task.action.command, ...task.action.args])}\n`);
  }
  if (!(await confirm(yes))) return void console.log('Nothing changed.');
  for (const task of tasks) registerTask(task.name, taskXml(task, user));
  console.log('Registered. Both start at your next logon. To start them now (the hub only if none is running):');
  console.log(`  schtasks /Run /TN "${HUB_TASK}"`);
  console.log(`  schtasks /Run /TN "${DISPLAY_TASK}"`);
  console.log(`The hub's messages: ${paths.hubLogFile}`);
}

async function githubToken(action: 'token' | 'remove', owner: string | undefined): Promise<void> {
  const paths = defaultPaths();
  if (action === 'remove') {
    console.log(removeGitHubToken(paths.githubTokenFile) ? 'GitHub token removed. Restart the hub.' : 'There is no GitHub token.');
    return;
  }
  if (owner !== undefined && !GITHUB_OWNER.test(owner)) throw new Error(`"${owner}" is not a GitHub user or organisation name.`);
  const config = loadConfig(paths.configFile);
  const target = owner ?? config.githubOwner;
  if (!target) throw new Error('Whose pull requests? Give the owner with --owner, e.g. --owner Azentrius.');

  console.log(`A fine-grained token for ${target}: Repository access "All repositories",`);
  console.log('permissions "Pull requests: Read" and "Actions: Read", nothing else.');
  const token = (await readSecret('Paste the token (input stays hidden): ')).trim();
  if (!isGitHubToken(token)) throw new Error('That is not a fine-grained GitHub token (it starts with "github_pat_"). Nothing saved.');

  // One round before saving, so a wrong token or a missing permission shows now, not on the display.
  const trial = new GitHubWatcher({ owner: target, token, intervalMs: 0 });
  await trial.poll();
  if (trial.problem) throw new Error(`GitHub: ${describeProblem(trial.problem)} Nothing saved.`);
  const repos = new Set(trial.pullRequests.map((pr) => pr.repo)).size;
  console.log(`Works: ${trial.pullRequests.length} open pull request(s) in ${repos} repositories of ${target}.`);

  saveGitHubToken(paths.githubTokenFile, token);
  if (owner && owner !== config.githubOwner) setConfigValue(paths.configFile, 'githubOwner', owner);
  console.log(`Saved to ${paths.githubTokenFile} (readable by you only). Restart the hub to show the pull requests.`);
}

async function hardware(action: 'install' | 'uninstall', yes: boolean): Promise<void> {
  if (process.platform !== 'win32') throw new Error('The hardware monitor is set up on Windows only.');
  if (!isElevated()) throw new Error('Run this in a terminal opened as administrator, with your own account.');
  const paths = defaultPaths();
  const dir = paths.hardwareDir;
  const exe = path.join(dir, LHM_EXE);
  const rule = firewallRuleName(LHM_PORT);
  const restartHub = () => {
    console.log(`Restart the hub so that the display follows:\n  schtasks /End /TN "${HUB_TASK}"\n  schtasks /Run /TN "${HUB_TASK}"`);
  };

  if (action === 'uninstall') {
    console.log(`Stop LibreHardwareMonitor and remove the task "${HARDWARE_TASK}", the firewall rule "${rule}" and ${dir}.\n`);
    if (!(await confirm(yes))) return void console.log('Nothing changed.');
    if (taskExists(HARDWARE_TASK)) {
      endTask(HARDWARE_TASK);
      deleteTask(HARDWARE_TASK);
    }
    stopProgram(exe);
    removeFirewallRule(LHM_PORT, { quiet: true });
    removeFiles(dir);
    setConfigValue(paths.configFile, 'hardwareMonitor', false);
    console.log('Removed.');
    return restartHub();
  }

  const user = currentUser();
  const task = hardwareTask({ exe, dir });
  console.log(`LibreHardwareMonitor ${LHM_VERSION} for the hardware values:`);
  console.log(`  download    ${LHM_ARCHIVE_URL}`);
  console.log(`  check       SHA-256 ${LHM_ARCHIVE_SHA256}`);
  console.log(`  unpack to   ${dir} (only administrators can change it)`);
  console.log(`  web server  port ${LHM_PORT}, user "${LHM_USER}" with a new random password; the hub reads it from`);
  console.log(`              LibreHardwareMonitor's settings and asks only for data.json`);
  console.log(`  firewall    rule "${rule}": other machines cannot reach port ${LHM_PORT}`);
  console.log(`              (LibreHardwareMonitor ${LHM_VERSION} listens on every network interface)`);
  console.log(`  task        "${HARDWARE_TASK}" for ${user} at logon, minimized to the tray, with administrator`);
  console.log('              rights: it reads the sensors');
  console.log('Processor temperatures need the PawnIO driver, which you install yourself.\n');
  if (!(await confirm(yes))) return void console.log('Nothing changed.');

  process.stdout.write('Downloading … ');
  const archive = await downloadArchive();
  checkArchive(archive);
  const files = unzip(archive);
  if (!files.some((file) => file.name === LHM_EXE)) throw new Error(`${LHM_EXE} is missing in the archive. Nothing changed.`);
  console.log(`size and SHA-256 match, ${files.length} files.`);

  // A running copy keeps its files open.
  if (taskExists(HARDWARE_TASK)) endTask(HARDWARE_TASK);
  stopProgram(exe);
  const settingsFile = path.join(dir, LHM_SETTINGS_FILE);
  const existing = fs.existsSync(settingsFile) ? parseAppSettings(fs.readFileSync(settingsFile, 'utf8')) : new Map<string, string>();
  installFiles(dir, files, appSettingsXml(lhmSettings(existing, randomBytes(32).toString('hex'))));
  console.log(`Unpacked to ${dir}.`);
  addFirewallRule(LHM_PORT);
  console.log(`Firewall rule "${rule}" added.`);
  registerTask(task.name, taskXml(task, user));
  startTask(HARDWARE_TASK);
  console.log(`Task "${HARDWARE_TASK}" registered and started.`);
  setConfigValue(paths.configFile, 'hardwareMonitor', true);
  restartHub();
}

/** Reads a secret from the terminal without showing it; from standard input when there is no terminal. */
async function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let text = '';
    for await (const chunk of stdin) text += String(chunk);
    return text.split(/\r?\n/)[0] ?? '';
  }
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          done();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          done();
          reject(new Error('Cancelled.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** Copies everything the hub prints into a file as well, for the hub started at logon without a window. */
function logToFile(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > MAX_HUB_LOG_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // No log yet.
  }
  const stream = fs.createWriteStream(file, { flags: 'a', mode: 0o600 });
  stream.write(`--- ${new Date().toISOString()}  Stellwerk ${VERSION}, process ${process.pid}\n`);
  for (const level of ['log', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      stream.write(`${format(...args)}\n`);
    };
  }
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
