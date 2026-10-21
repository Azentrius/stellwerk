// The configuration file and the token file.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defaultPaths, deleteRawLog, loadConfig, setConfigValue } from '../src/config.ts';
import {
  ensureToken,
  isGitHubToken,
  isUptimeKumaKey,
  readGitHubToken,
  readToken,
  readUptimeKumaKey,
  removeGitHubToken,
  removeUptimeKumaKey,
  saveGitHubToken,
  saveUptimeKumaKey,
  writeDisplayStart,
} from '../src/token.ts';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-config-'));
}

test('without a file every setting has its default', () => {
  assert.deepEqual(loadConfig(path.join(tempDir(), 'config.json')), {
    port: 4780,
    holdSeconds: 60,
    sound: false,
    quietAfterMinutes: 10,
    remindAfterSeconds: 20,
    scale: 1,
    debugRawLog: false,
    githubIntervalSeconds: 120,
    uptimeKumaIntervalSeconds: 60,
    hardwareMonitor: false,
    codexHoldSeconds: 30,
    contextWindows: {},
  });
});

test('an open request reminds after 0 (never) to 300 seconds', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(file, '{ "remindAfterSeconds": 0 }');
  assert.equal(loadConfig(file).remindAfterSeconds, 0);
  for (const bad of ['{ "remindAfterSeconds": -1 }', '{ "remindAfterSeconds": 301 }', '{ "remindAfterSeconds": 1.5 }']) {
    fs.writeFileSync(file, bad);
    assert.throws(() => loadConfig(file), bad);
  }
});

test('the display rests after 0 (never) to 1440 minutes', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(file, '{ "quietAfterMinutes": 0 }');
  assert.equal(loadConfig(file).quietAfterMinutes, 0);
  for (const bad of ['{ "quietAfterMinutes": -1 }', '{ "quietAfterMinutes": 1441 }', '{ "quietAfterMinutes": 2.5 }']) {
    fs.writeFileSync(file, bad);
    assert.throws(() => loadConfig(file), bad);
  }
});

test('the Codex hold time stays at least 10 s below its hook timeout of 45 s', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(file, '{ "codexHoldSeconds": 36 }');
  assert.throws(() => loadConfig(file), /codexHoldSeconds/);
  fs.writeFileSync(file, '{ "codexHoldSeconds": 35 }');
  assert.equal(loadConfig(file).codexHoldSeconds, 35);
  assert.equal(defaultPaths({ CODEX_HOME: 'D:\\codex' }).codexHome, 'D:\\codex');
});

test('context windows can be given per model, within sensible bounds', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(file, '{ "contextWindows": { "claude-sonnet-5-5": 1000000 } }');
  assert.deepEqual(loadConfig(file).contextWindows, { 'claude-sonnet-5-5': 1000000 });
  for (const bad of ['{ "contextWindows": { "m": 10 } }', '{ "contextWindows": { "m": "large" } }', '{ "contextWindows": [] }']) {
    fs.writeFileSync(file, bad);
    assert.throws(() => loadConfig(file), bad);
  }
});

test('the GitHub owner must be a valid name, the interval at least a minute', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(file, '{ "githubOwner": "Azentrius", "githubIntervalSeconds": 300 }');
  assert.equal(loadConfig(file).githubOwner, 'Azentrius');
  for (const bad of ['{ "githubOwner": "a/b" }', '{ "githubOwner": "-x" }', '{ "githubIntervalSeconds": 30 }']) {
    fs.writeFileSync(file, bad);
    assert.throws(() => loadConfig(file), bad);
  }
});

test('setting one value keeps the others and refuses invalid ones', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(file, '{ "holdSeconds": 45 }');
  setConfigValue(file, 'githubOwner', 'Azentrius');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { holdSeconds: 45, githubOwner: 'Azentrius' });
  assert.throws(() => setConfigValue(file, 'githubOwner', 'not valid!'));
  assert.equal(loadConfig(file).githubOwner, 'Azentrius');
});

test('only fine-grained GitHub tokens are kept; they can be read back and removed', () => {
  const fine = `github_pat_${'A1_b'.repeat(20)}`;
  assert.equal(isGitHubToken(fine), true);
  assert.equal(isGitHubToken(`ghp_${'a'.repeat(36)}`), false, 'classic tokens carry too many rights');
  assert.equal(isGitHubToken('github_pat_short'), false);
  const file = path.join(tempDir(), 'sub', 'github-token');
  assert.throws(() => saveGitHubToken(file, `ghp_${'a'.repeat(36)}`), /fine-grained/);
  assert.equal(fs.existsSync(file), false);
  saveGitHubToken(file, fine);
  assert.equal(readGitHubToken(file), fine);
  const replaced = `github_pat_${'Z9'.repeat(20)}`;
  saveGitHubToken(file, replaced);
  assert.equal(readGitHubToken(file), replaced);
  assert.equal(removeGitHubToken(file), true);
  assert.equal(readGitHubToken(file), null);
  assert.equal(removeGitHubToken(file), false);
});

test("Uptime Kuma's address is kept as an origin, the interval at least half a minute", () => {
  const file = path.join(tempDir(), 'config.json');
  setConfigValue(file, 'uptimeKumaUrl', 'http://192.168.0.130:3001');
  assert.equal(loadConfig(file).uptimeKumaUrl, 'http://192.168.0.130:3001');
  for (const url of ['http://192.168.0.130:3001/', 'http://192.168.0.130:3001/metrics', 'ftp://192.168.0.130', 'http://u:p@host']) {
    assert.throws(() => setConfigValue(file, 'uptimeKumaUrl', url), /uptimeKumaUrl/, url);
  }
  assert.throws(() => setConfigValue(file, 'uptimeKumaIntervalSeconds', 10));
  assert.equal(loadConfig(file).uptimeKumaUrl, 'http://192.168.0.130:3001');
});

test("only Uptime Kuma's API keys are kept; they can be read back and removed", () => {
  const key = `uk12_${'Ab9-_'.repeat(8)}`;
  assert.equal(isUptimeKumaKey(key), true);
  for (const other of ['uk_abc', `uk1-${'a'.repeat(40)}`, `github_pat_${'a'.repeat(30)}`, `uk1_${'a'.repeat(40)} `, `uk1_${'a'.repeat(20)}/x`]) {
    assert.equal(isUptimeKumaKey(other), false, other);
  }
  const file = path.join(tempDir(), 'sub', 'uptime-kuma-key');
  assert.throws(() => saveUptimeKumaKey(file, 'password123'), /API key of Uptime Kuma/);
  assert.equal(fs.existsSync(file), false);
  saveUptimeKumaKey(file, key);
  assert.equal(readUptimeKumaKey(file), key);
  fs.writeFileSync(file, 'something else\n');
  assert.throws(() => readUptimeKumaKey(file), /stellwerk kuma key/);
  assert.equal(removeUptimeKumaKey(file), true);
  assert.equal(readUptimeKumaKey(file), null);
  assert.equal(removeUptimeKumaKey(file), false);
});

test('a file written by a Windows editor (with byte order mark) is read', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(file, '\uFEFF{ "holdSeconds": 45, "scale": 1.25 }');
  const config = loadConfig(file);
  assert.equal(config.holdSeconds, 45);
  assert.equal(config.scale, 1.25);
});

test('the hold time stays at least 10 s below the hook timeout of 90 s', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(file, '{ "holdSeconds": 81 }');
  assert.throws(() => loadConfig(file), /holdSeconds/);
  fs.writeFileSync(file, '{ "holdSeconds": 80 }');
  assert.equal(loadConfig(file).holdSeconds, 80);
});

test('typos and broken JSON are reported, not ignored', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(file, '{ "hold": 30 }');
  assert.throws(() => loadConfig(file), /hold/);
  fs.writeFileSync(file, '{ "port": 4780, }');
  assert.throws(() => loadConfig(file), /not valid JSON/);
});

test('the files live under APPDATA and LOCALAPPDATA', () => {
  const paths = defaultPaths({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' });
  assert.equal(paths.configFile, path.join('C:\\Users\\u\\AppData\\Roaming', 'stellwerk', 'config.json'));
  assert.equal(paths.auditFile, path.join('C:\\Users\\u\\AppData\\Local', 'stellwerk', 'audit.jsonl'));
  assert.equal(paths.tokenFile, path.join('C:\\Users\\u\\AppData\\Local', 'stellwerk', 'token'));
  assert.equal(paths.plansFile, path.join('C:\\Users\\u\\AppData\\Local', 'stellwerk', 'plans.json'));
  assert.equal(paths.sessionsFile, path.join('C:\\Users\\u\\AppData\\Local', 'stellwerk', 'sessions.json'));
  assert.equal(paths.uptimeKumaStateFile, path.join('C:\\Users\\u\\AppData\\Local', 'stellwerk', 'uptime-kuma.json'));
  assert.equal(paths.displayStartFile, path.join('C:\\Users\\u\\AppData\\Local', 'stellwerk', 'display.html'));
});

test('the hardware monitor lives in Program Files, where only administrators can change it', () => {
  const paths = defaultPaths({ ProgramFiles: 'D:\\Programs' });
  assert.equal(paths.hardwareDir, path.join('D:\\Programs', 'Stellwerk', 'LibreHardwareMonitor'));
  assert.equal(defaultPaths({}).hardwareDir, path.join('C:\\Program Files', 'Stellwerk', 'LibreHardwareMonitor'));
});

test('the hardware monitor is switched on and off in the configuration', () => {
  const file = path.join(tempDir(), 'config.json');
  setConfigValue(file, 'hardwareMonitor', true);
  assert.equal(loadConfig(file).hardwareMonitor, true);
  setConfigValue(file, 'hardwareMonitor', false);
  assert.equal(loadConfig(file).hardwareMonitor, false);
  assert.throws(() => setConfigValue(file, 'hardwareMonitor', 'yes'));
});

test('the token is created once, 256 bits as hex, and read back the same', () => {
  const file = path.join(tempDir(), 'sub', 'token');
  const first = ensureToken(file);
  assert.equal(first.created, true);
  assert.match(first.token, /^[0-9a-f]{64}$/);
  const second = ensureToken(file);
  assert.deepEqual(second, { token: first.token, created: false });
  assert.equal(readToken(file), first.token);
});

test("the display's start file is written like a token, and again only when it changes", () => {
  const file = path.join(tempDir(), 'sub', 'display.html');
  assert.equal(writeDisplayStart(file, '<form>one</form>'), true);
  assert.equal(fs.readFileSync(file, 'utf8'), '<form>one</form>\n');
  assert.equal(writeDisplayStart(file, '<form>one</form>'), false, 'unchanged: not written again');
  assert.equal(writeDisplayStart(file, '<form>two</form>'), true, 'a new key or port: written again');
  assert.equal(fs.readFileSync(file, 'utf8'), '<form>two</form>\n');
});

test('a damaged token file is reported', () => {
  const file = path.join(tempDir(), 'token');
  fs.writeFileSync(file, 'not-a-token');
  assert.throws(() => readToken(file), /valid token/);
});

test('the raw hook log is deleted on request; without one there is nothing to delete', () => {
  const file = path.join(tempDir(), 'debug-raw.jsonl');
  fs.writeFileSync(file, '{"prompt":"secret"}\n');
  assert.equal(deleteRawLog(file), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(deleteRawLog(file), false);
});
