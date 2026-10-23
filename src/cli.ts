#!/usr/bin/env node
// Stellwerk's command line: start the hub; add and remove the hooks, the firewall rule, the start with
// Windows, the GitHub token, the hardware monitor and Uptime Kuma's API key.
//
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { format, parseArgs } from 'node:util';
import { GITHUB_OWNER, HOST, defaultPaths, deleteRawLog, loadConfig, nightOf, readJsonFile, setConfigValue, uptimeKumaAddress } from './config.ts';
import { GitHubWatcher, describeProblem } from './hub/github.ts';
import { UptimeKumaWatcher, describeUptimeKumaProblem } from './hub/kuma.ts';
import {
  HARDWARE_INTERVAL_MS,
  LHM_PORT,
  LHM_SETTINGS_FILE,
  appSettingsXml,
  parseAppSettings,
} from './hub/hardware.ts';
import { codexStateFile } from './hub/codex-projects.ts';
import { codexSessionIndex, codexTranscriptsRoot, defaultTranscriptsRoot } from './hub/context.ts';
import { codexHooksFile, stellwerkCodexCommands, withStellwerkCodexHooks, withoutStellwerkCodexHooks } from './setup/codex-settings.ts';
import { checkRelease, isInside, previousReleases, releaseDir, releaseFiles, releaseVersion } from './setup/update.ts';
import { displayKey, displayStartPage, startHub } from './hub/hub.ts';
import {
  DISPLAY_TASK,
  HUB_TASK,
  commandLine,
  describeScreens,
  displayPlacement,
  displayTask,
  hubTask,
  pickScreen,
  screenNumber,
  taskXml,
  updateScreen,
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
  edgeWithProfile,
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
  taskDefinition,
  taskExists,
} from './setup/windows.ts';
import {
  ensureToken,
  isGitHubToken,
  isUptimeKumaKey,
  readGitHubToken,
  readUptimeKumaKey,
  removeGitHubToken,
  removeUptimeKumaKey,
  saveGitHubToken,
  saveUptimeKumaKey,
  writeDisplayStart,
} from './token.ts';

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
      Start the hub on ${HOST}. Then open the display with its start file, which only
      you can read: %LOCALAPPDATA%\\stellwerk\\display.html
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
  stellwerk kuma key [--url <address>]
      Show Uptime Kuma's monitors: asks for an API key of Uptime Kuma (input hidden), tries it
      once against the address's /metrics and keeps both for the hub.
  stellwerk kuma remove
      Forget the API key; the hub then opens no connection to Uptime Kuma.
  stellwerk hardware install [--yes]
      Show processor, graphics card and memory: set up LibreHardwareMonitor ${LHM_VERSION} from its
      official release (checked by SHA-256) with a password, a firewall rule and a logon task
      (as administrator).
  stellwerk hardware uninstall [--yes]
      Remove it again (as administrator).
  stellwerk codex install [--yes]
      Show the Codex app's sessions and approvals too: add Stellwerk's hooks to Codex' hooks.json.
      Then restart the Codex app and allow the hooks there.
  stellwerk codex uninstall [--yes]
      Remove exactly these hooks.
  stellwerk raw-log delete
      Delete the raw hook log (debug-raw.jsonl), which holds prompts and code.
  stellwerk update <stellwerk-X.Y.Z.zip> [--yes] [--screen <number>] [--keep-previous]
      Set up a downloaded release (SHA256SUMS next to it): check it against SHA256SUMS, unpack it to
      %LOCALAPPDATA%\\stellwerk\\releases, install its dependencies there and point the logon tasks at it;
      move Codex' hooks to its forwarder, start the hub again from it and remove the previous releases
      (unless --keep-previous). On its screen the display loads the new page by itself.
      The display stays on its screen, or goes to the one given (it is then started again there);
      when its screen is gone (or on a first setup, the 1920x720 screen cannot be told), nothing
      changes until one is given. When Task Scheduler cannot read the display task, or Codex'
      hooks.json cannot be read, nothing changes at all.

Configuration: %APPDATA%\\stellwerk\\config.json. Every setting is described in the README,
section "Configuration".
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
      url: { type: 'string' },
      screen: { type: 'string' },
      'keep-previous': { type: 'boolean', default: false },
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
  if (command === 'kuma' && (action === 'key' || action === 'remove')) return uptimeKumaKey(action, values.url);
  if (command === 'hardware' && (action === 'install' || action === 'uninstall')) return hardware(action, values.yes);
  if (command === 'codex' && (action === 'install' || action === 'uninstall')) return codex(action, values.yes);
  if (command === 'raw-log' && action === 'delete') return rawLogDelete();
  if (command === 'update') return update(action, values.yes, values.screen, values['keep-previous']);
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
  const kumaKey = config.uptimeKumaUrl ? readUptimeKumaKey(paths.uptimeKumaKeyFile) : null;
  const uptimeKuma =
    config.uptimeKumaUrl && kumaKey
      ? { url: config.uptimeKumaUrl, key: kumaKey, intervalMs: config.uptimeKumaIntervalSeconds * 1000, stateFile: paths.uptimeKumaStateFile }
      : null;
  let hub;
  try {
    hub = await startHub({
      port: config.port,
      token,
      holdMs: config.holdSeconds * 1000,
      codexHoldMs: config.codexHoldSeconds * 1000,
      scale: config.scale,
      version: VERSION,
      sound: config.sound,
      quietAfterMs: config.quietAfterMinutes * 60_000,
      remindAfterMs: config.remindAfterSeconds * 1000,
      night: nightOf(config),
      auditFile: paths.auditFile,
      uiRoot: path.join(ROOT, 'ui'),
      webRoot: path.join(ROOT, 'dist', 'ui'),
      rawLogFile: rawLog ? paths.rawLogFile : null,
      simulateHang,
      github,
      hardware,
      uptimeKuma,
      context: {
        root: defaultTranscriptsRoot(),
        codexRoot: codexTranscriptsRoot(paths.codexHome),
        codexIndex: codexSessionIndex(paths.codexHome),
        windows: config.contextWindows,
      },
      plansFile: paths.plansFile,
      sessionsFile: paths.sessionsFile,
      codexStateFile: codexStateFile(paths.codexHome),
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(`Port ${config.port} is already in use. Is Stellwerk running already?`);
    }
    throw err;
  }
  const url = `http://${HOST}:${hub.port}`;
  console.log(`Stellwerk ${VERSION} on ${url}`);
  // The display signs in with this file; the address alone shows only how to open it.
  try {
    writeDisplayStart(paths.displayStartFile, displayStartPage(hub.port, displayKey(token)));
    console.log(`Display: open ${paths.displayStartFile} (msedge --app=${pathToFileURL(paths.displayStartFile).href})`);
  } catch (err) {
    console.log(`The display's start file could not be written: ${(err as Error).message}`);
  }
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
  if (uptimeKuma) {
    console.log(`Monitors of Uptime Kuma from ${uptimeKuma.url}/metrics, every ${config.uptimeKumaIntervalSeconds} s.`);
  } else if (config.uptimeKumaUrl) {
    console.log(`uptimeKumaUrl is set, but there is no API key. Run "stellwerk kuma key".`);
  }
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

async function autostart(action: 'install' | 'uninstall', yes: boolean, screenOption: string | undefined): Promise<void> {
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
  const given = screenNumber(screenOption);
  const screens = listScreens();
  const screen = pickScreen(screens, given);
  const user = currentUser();
  const tasks = [
    hubTask({ node: process.execPath, cli, root: ROOT, logFile: paths.hubLogFile, conhost: conhostPath() }),
    // The start file signs the display in; the hub writes it when it starts, before the display opens.
    displayTask({ edge: findEdge(), url: pathToFileURL(paths.displayStartFile).href, profileDir: paths.displayProfileDir, screen, root: ROOT }),
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

async function uptimeKumaKey(action: 'key' | 'remove', url: string | undefined): Promise<void> {
  const paths = defaultPaths();
  if (action === 'remove') {
    console.log(removeUptimeKumaKey(paths.uptimeKumaKeyFile) ? 'API key of Uptime Kuma removed. Restart the hub.' : 'There is no API key of Uptime Kuma.');
    return;
  }
  const address = url === undefined ? undefined : uptimeKumaAddress(url);
  if (address === null) throw new Error(`"${url}" is not an address like http://192.0.2.10:3001 (http or https, no path).`);
  const config = loadConfig(paths.configFile);
  const target = address ?? config.uptimeKumaUrl;
  if (!target) throw new Error("Where is Uptime Kuma? Give its address with --url, e.g. --url http://192.0.2.10:3001.");

  console.log(`An API key of Uptime Kuma at ${target}: in Uptime Kuma, Settings, API Keys, "Add API Key".`);
  console.log('Such a key can read /metrics and nothing else.');
  if (target.startsWith('http:')) console.log('The address is plain http: the key goes over your network unencrypted, like the metrics.');
  const key = (await readSecret('Paste the key (input stays hidden): ')).trim();
  if (!isUptimeKumaKey(key)) throw new Error('That is not an API key of Uptime Kuma (it starts with "uk" and a number). Nothing saved.');

  // One round before saving, so a wrong key or address shows now, not on the display.
  const trial = new UptimeKumaWatcher({ url: target, key, intervalMs: 0 });
  await trial.poll();
  if (trial.problem) throw new Error(`Uptime Kuma ${describeUptimeKumaProblem(trial.problem)} Nothing saved.`);
  const { failing, up, maintenance } = trial.monitors!;
  console.log(`Works: ${up} up, ${failing.length} failing, ${maintenance} in maintenance.`);

  saveUptimeKumaKey(paths.uptimeKumaKeyFile, key);
  if (target !== config.uptimeKumaUrl) setConfigValue(paths.configFile, 'uptimeKumaUrl', target);
  console.log(`Saved to ${paths.uptimeKumaKeyFile} (readable by you only). Restart the hub to show the monitors.`);
}

async function codex(action: 'install' | 'uninstall', yes: boolean): Promise<void> {
  const paths = defaultPaths();
  const file = codexHooksFile(paths.codexHome);
  const script = path.join(ROOT, 'dist', 'codex', 'hook.js');
  if (action === 'install' && !fs.existsSync(script)) throw new Error('dist/codex/hook.js is missing. Run "npm run build" first.');
  const exists = fs.existsSync(file);
  const before = exists ? fs.readFileSync(file, 'utf8') : '';
  const current = exists ? readJsonFile(file) : {};
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new Error(`${file} does not hold a JSON object. Nothing changed.`);
  }
  const hooks = current as Record<string, unknown>;
  const next = action === 'install' ? withStellwerkCodexHooks(hooks, script) : withoutStellwerkCodexHooks(hooks);
  const after = Object.keys(next).length === 0 && action === 'uninstall' ? '' : formatSettings(next);
  if (normalize(after) === normalize(before)) return void console.log('Nothing to change.');

  console.log(`${file}\n`);
  console.log(colorDiff(lineDiff(before, after)));
  console.log();
  if (action === 'install') {
    console.log('Codex runs the forwarder for each event; it passes the event to the hub on 127.0.0.1 with the');
    console.log('hook token from the token file. Without a hub it ends at once and Codex asks as usual.');
  }
  if (!(await confirm(yes))) return void console.log('Nothing changed.');

  if (action === 'install') ensureToken(paths.tokenFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (exists) {
    const backup = `${file}.stellwerk-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    fs.copyFileSync(file, backup);
    console.log(`Backup: ${backup}`);
  }
  if (after === '') {
    fs.rmSync(file);
    console.log(`Removed: ${file} (it held only Stellwerk's hooks)`);
  } else {
    fs.writeFileSync(file, after);
    console.log(`Written: ${file}`);
  }
  console.log(
    action === 'install'
      ? 'Restart the Codex app and allow the new hooks there (the hook symbol in the input field, "Review hooks").\n' +
          'Codex runs them only after that, and again after any change to them.'
      : 'Restart the Codex app so that the change applies.',
  );
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

/** Deletes the raw hook log; says when the configuration would have the hub write it again. */
function rawLogDelete(): void {
  const paths = defaultPaths();
  console.log(deleteRawLog(paths.rawLogFile) ? `Deleted ${paths.rawLogFile}.` : 'There is no raw hook log.');
  if (loadConfig(paths.configFile).debugRawLog) {
    console.log('debugRawLog is still true in config.json: set it to false and restart the hub, or it writes the log again.');
  }
}

/**
 * Sets up a downloaded release in a folder of its own and points the logon tasks at it (setup/update.ts),
 * the display on the screen it has now unless another is given.
 */
async function update(zipFile: string | undefined, yes: boolean, screenOption: string | undefined, keepPrevious: boolean): Promise<void> {
  if (!zipFile) throw new Error('Name the release: stellwerk update <stellwerk-X.Y.Z.zip>, with SHA256SUMS next to it.');
  const given = screenNumber(screenOption);
  const paths = defaultPaths();
  const name = path.basename(zipFile);
  const version = releaseVersion(name);
  const sumsFile = path.join(path.dirname(path.resolve(zipFile)), 'SHA256SUMS');
  if (!fs.existsSync(sumsFile)) throw new Error(`${sumsFile} is missing: download it with the release.`);
  const zip = fs.readFileSync(zipFile);
  checkRelease(zip, fs.readFileSync(sumsFile, 'utf8'), name);
  const target = releaseDir(paths.releasesDir, version);
  if (fs.existsSync(target)) throw new Error(`${target} is there already; remove it first to set it up again.`);
  const files = releaseFiles(unzip(zip), version);
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCli)) throw new Error(`npm is not next to Node.js (${npmCli}).`);
  // The screen before anything changes, so the new version's setup neither fails late nor moves the display.
  // Only a display task Task Scheduler says is not there counts as a first setup; one it cannot read stops.
  const screens = listScreens();
  let current: string | null;
  try {
    current = taskDefinition(DISPLAY_TASK);
  } catch (err) {
    throw new Error(
      `${(err as Error).message}\nNothing was changed: without the display task the update cannot tell the display's screen, ` +
        'nor would the new version be able to replace the task. Run it again once Task Scheduler can read it.',
    );
  }
  const screen = updateScreen(screens, given, current);
  const why = { given: 'as given', kept: 'where it is now', only: 'the only one of 1920×720' }[screen.reason];
  console.log(`Screens:\n${describeScreens(screens)}\nThe display goes full screen on screen ${screen.number} (${why}).\n`);
  const config = loadConfig(paths.configFile);
  const codexHooks = codexHooksFile(paths.codexHome);
  // Codex' hooks must be readable: otherwise the update could not move them, nor tell whether an older
  // release's forwarder is still in use.
  let moveCodex: boolean;
  try {
    moveCodex = codexCommands(codexHooks).length > 0;
  } catch (err) {
    throw new Error(`${(err as Error).message}\nNothing was changed. Repair or remove that file, then run the update again.`);
  }
  // A display moved to another screen has to start again there; on the same screen it reloads by itself. A
  // display task without a full placement gets here only with --screen (updateScreen): where its display
  // is cannot be told, so it starts again on the screen given. Without a task (a first setup) there is none.
  const place = current === null ? null : displayPlacement(current);
  const chosen = screens[screen.number - 1]!;
  const moveDisplay =
    current !== null &&
    (place === null || place.x !== chosen.x || place.y !== chosen.y || place.width !== chosen.width || place.height !== chosen.height);
  const previous = keepPrevious ? [] : previousReleases(fs.existsSync(paths.releasesDir) ? fs.readdirSync(paths.releasesDir) : [], version);
  console.log(`${name} matches SHA256SUMS. It goes to ${target}, with "npm ci --omit=dev" there. Then:`);
  console.log('  - the logon tasks start it;');
  if (moveCodex) console.log("  - Codex' hooks run its forwarder (the Codex app then asks to allow them again);");
  console.log(
    moveDisplay
      ? `  - the hub (task "${HUB_TASK}") is started again from it, and the display (task "${DISPLAY_TASK}") on screen ${screen.number};`
      : `  - the hub (task "${HUB_TASK}") is started again from it, and the display loads the new page by itself;`,
  );
  if (previous.length > 0) console.log(`  - the previous ${previous.length === 1 ? 'release goes' : 'releases go'}: ${previous.join(', ')} (keep with --keep-previous).`);
  console.log('');
  if (!(await confirm(yes))) return void console.log('Nothing changed.');
  for (const file of files) {
    const to = path.join(target, file.path);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, file.data);
  }
  // Fixed arguments, no shell: npm through the Node.js that runs this, then the new version's own setup.
  const cli = path.join(target, 'dist', 'cli.js');
  runStep(process.execPath, [npmCli, 'ci', '--omit=dev'], target);
  runStep(process.execPath, [cli, 'autostart', 'install', '--yes', '--screen', String(screen.number)], target);
  if (moveCodex) runStep(process.execPath, [cli, 'codex', 'install', '--yes'], target);
  await restartHub(config.port, paths.hubLogFile);
  if (moveDisplay) {
    try {
      await restartDisplay(paths.displayProfileDir);
    } catch (err) {
      throw new Error(`Stellwerk ${version} runs, but the display is not on screen ${screen.number} yet. ${(err as Error).message}`);
    }
  }
  console.log(
    moveDisplay
      ? `Stellwerk ${version} runs; the display started again on screen ${screen.number}.`
      : `Stellwerk ${version} runs; the display loads the new page by itself when it is open.`,
  );
  if (moveCodex) console.log('Restart the Codex app and allow the changed hooks there (the hook symbol in the input field).');
  for (const folder of previous) removeRelease(path.join(paths.releasesDir, folder), codexHooks);
}

/**
 * Stellwerk's commands in Codex' hooks; none when the file is not there. A file that cannot be read or is no
 * JSON object throws: it may still name a forwarder.
 */
function codexCommands(file: string): string[] {
  let settings: unknown;
  try {
    settings = readJsonFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    const message = (err as Error).message;
    throw new Error(`Codex' hooks could not be read: ${message.includes(file) ? message : `${file}: ${message}`}`);
  }
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    throw new Error(`Codex' hooks could not be read: ${file} is not a JSON object.`);
  }
  return stellwerkCodexCommands(settings as Record<string, unknown>);
}

/** A previous release, unless something may still use it: Codex' hooks, or this very command's folder. */
function removeRelease(dir: string, codexHooks: string): void {
  let commands: string[];
  try {
    commands = codexCommands(codexHooks);
  } catch (err) {
    // Not to be told: it may still run this release's forwarder.
    return void console.log(`${dir} stays: ${(err as Error).message}`);
  }
  const still = commands.some((command) => command.toLowerCase().includes(dir.toLowerCase()));
  if (still || isInside(process.cwd(), dir)) {
    return void console.log(`${dir} stays: ${still ? "Codex' hooks still run its forwarder" : 'this command runs in it'}.`);
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    console.log(`Removed ${dir}.`);
  } catch (err) {
    console.log(`${dir} stays (${(err as Error).message}); remove it yourself.`);
  }
}

/**
 * The hub task ended and started again, from the version its task now names. Waits until the port is free
 * (the hub follows its task within seconds, --exit-with-parent) and until the new hub answers on it.
 */
async function restartHub(port: number, logFile: string): Promise<void> {
  endTask(HUB_TASK);
  if (!(await within(HUB_STOP_MS, async () => !(await listening(port))))) {
    throw new Error(
      `A hub not started by its task still listens on ${HOST}:${port}. Stop it (Ctrl+C in its window), then: schtasks /Run /TN "${HUB_TASK}"`,
    );
  }
  startTask(HUB_TASK);
  if (!(await within(HUB_START_MS, () => listening(port)))) throw new Error(`The hub did not start again; its messages are in ${logFile}.`);
}

/**
 * The display task ended and run again, so its Edge opens on the screen its task now names. Waits until the
 * Edge of the display's own profile is gone (other Edge windows are not touched): an Edge still running with
 * that profile would only open a window in itself, where it was.
 */
async function restartDisplay(profileDir: string): Promise<void> {
  const run = `schtasks /Run /TN "${DISPLAY_TASK}"`;
  endTask(DISPLAY_TASK);
  let closed: boolean;
  try {
    closed = await within(DISPLAY_STOP_MS, async () => edgeWithProfile(profileDir) === 0);
  } catch (err) {
    throw new Error(`Whether it closed could not be told: ${(err as Error).message} Close it if it is open (Alt+F4 on the display), then: ${run}`);
  }
  if (!closed) throw new Error(`Its Edge (profile ${profileDir}) did not close. Close it (Alt+F4 on the display), then: ${run}`);
  try {
    startTask(DISPLAY_TASK);
  } catch (err) {
    throw new Error(`Its task did not run: ${(err as Error).message.trim()} Start it: ${run}`);
  }
}

/** How long the display's Edge may take to close after its task ended. */
const DISPLAY_STOP_MS = 15_000;

/** How long the hub may take to follow its ended task, and to start. */
const HUB_STOP_MS = 10_000;
const HUB_START_MS = 20_000;

/** Whether something answers on the hub's port. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function within(ms: number, test: () => Promise<boolean>): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await test()) return true;
    if (Date.now() >= end) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function runStep(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${args.slice(1).join(' ')} in ${cwd} failed (${result.status ?? result.error?.message}).`);
}
