// The configuration file and the token file.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defaultPaths, loadConfig, setConfigValue } from '../src/config.ts';
import { ensureToken, isGitHubToken, readGitHubToken, readToken, removeGitHubToken, saveGitHubToken } from '../src/token.ts';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-config-'));
}

test('without a file every setting has its default', () => {
  assert.deepEqual(loadConfig(path.join(tempDir(), 'config.json')), {
    port: 4780,
    holdSeconds: 60,
    sound: false,
    scale: 1,
    debugRawLog: false,
    githubIntervalSeconds: 120,
  });
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

test('a damaged token file is reported', () => {
  const file = path.join(tempDir(), 'token');
  fs.writeFileSync(file, 'not-a-token');
  assert.throws(() => readToken(file), /valid token/);
});
