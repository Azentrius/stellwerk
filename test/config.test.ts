// The configuration file and the token file.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defaultPaths, loadConfig } from '../src/config.ts';
import { ensureToken, readToken } from '../src/token.ts';

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
  });
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
