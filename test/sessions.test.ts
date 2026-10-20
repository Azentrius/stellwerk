// The sessions remembered over a restart of the hub: what the file holds, how it is read and written.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import type { SavedSession } from '../src/hub/board.ts';
import { SessionFile } from '../src/hub/sessions.ts';

const fileIn = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-sessions-')), 'stellwerk', 'sessions.json');
const session = (id: string, lastActivity = 1000): SavedSession => ({
  id,
  provider: 'claude',
  cwd: 'C:\\Projects\\shop-api',
  title: `Title of ${id}`,
  project: null,
  context: { used: 42, size: 100 },
  lastActivity,
});

describe('sessions over a restart', () => {
  test('what is saved is read again', async () => {
    const file = fileIn();
    const first = new SessionFile(file);
    first.save([session('a'), session('b', 2000)]);
    await first.flush();
    assert.deepEqual(new SessionFile(file).load(), [session('a'), session('b', 2000)]);
  });

  test('saved at most once a while: the newest list is the one written', async () => {
    const file = fileIn();
    const sessions = new SessionFile(file);
    sessions.save([session('a')]);
    sessions.save([session('a'), session('b')]);
    assert.equal(fs.existsSync(file), false, 'nothing written before the time is up');
    await sessions.flush();
    assert.deepEqual(new SessionFile(file).load().map((s) => s.id), ['a', 'b']);
  });

  test('a missing file is nothing to restore, quietly; a broken one is reported and written again', async () => {
    const quiet: string[] = [];
    assert.deepEqual(new SessionFile(fileIn(), (line) => quiet.push(line)).load(), []);
    assert.deepEqual(quiet, []);

    const file = fileIn();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"not": "a list"}');
    const log: string[] = [];
    const sessions = new SessionFile(file, (line) => log.push(line));
    assert.deepEqual(sessions.load(), []);
    assert.equal(log.length, 1);
    assert.match(log[0]!, /is not readable; it is written again/);
    sessions.save([session('a')]);
    await sessions.flush();
    assert.deepEqual(new SessionFile(file).load(), [session('a')]);
  });

  test('an entry that does not fit is left out, the others are taken', () => {
    const file = fileIn();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([session('a'), { ...session('b'), provider: 'other' }, { ...session('c'), title: 'x'.repeat(2000) }, session('d')]));
    assert.deepEqual(new SessionFile(file).load().map((s) => s.id), ['a', 'd']);
  });

  test('a file that cannot be written is reported once', async () => {
    // A folder where the file should be.
    const file = fileIn();
    fs.mkdirSync(file, { recursive: true });
    const log: string[] = [];
    const sessions = new SessionFile(file, (line) => log.push(line));
    sessions.save([session('a')]);
    await sessions.flush();
    sessions.save([session('b')]);
    await sessions.flush();
    assert.equal(log.length, 1);
    assert.match(log[0]!, /^Sessions: /);
  });

  test('without a file nothing is kept', async () => {
    const sessions = new SessionFile(null);
    sessions.save([session('a')]);
    await sessions.flush();
    assert.deepEqual(sessions.load(), []);
  });
});
