// Windows itself: Task Scheduler on this machine, in whatever language it answers, tells a task that is not
// there from one it cannot read (asks for a made-up task; creates and changes nothing), and the Edge count
// that `stellwerk update` waits on finds a real Edge by its profile folder, whatever is in that folder's path
// (a headless Edge of the test's own with a profile in a temporary folder; the user's Edge stays untouched).
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { edgeWithProfile, taskDefinition, taskExists } from '../src/setup/windows.ts';
import { openEdge, until } from '../tools/edge.ts';

const windowsOnly = { skip: process.platform !== 'win32' && 'Windows only' };

test('a task that is not there is null, by Task Scheduler\'s error code', windowsOnly, () => {
  assert.equal(taskDefinition(`Stellwerk test ${randomUUID()}`), null);
});

test('a task that is not there does not exist, by the same code; asking changes nothing', windowsOnly, () => {
  assert.equal(taskExists(`Stellwerk test ${randomUUID()}`), false);
  // Its name reaches Task Scheduler as it is, umlauts included.
  assert.equal(taskExists(`Stellwerk Prüfung ${randomUUID()}`), false);
});

test("a running Edge is counted by its profile folder: umlauts, spaces, any case; another or a shorter path, or once it closed, not", { ...windowsOnly, timeout: 120_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-edge-'));
  try {
    for (const name of ['Profil Jörg', 'Ärger über Öl']) {
      const profile = path.join(root, name);
      const edge = await openEdge(profile);
      let open = true;
      try {
        assert.ok(edgeWithProfile(profile) > 0, `${name}: its Edge is counted`);
        assert.ok(edgeWithProfile(profile.toUpperCase()) > 0, `${name}: in capitals too`);
        assert.ok(edgeWithProfile(profile.toLowerCase()) > 0, `${name}: in small letters too`);
        // Read with the console's code page, "ö" would turn into other letters: such a path is another one.
        assert.equal(edgeWithProfile(path.join(root, name.normalize('NFD').replace(/\p{M}/gu, ''))), 0, `${name}: without its umlauts it is another folder`);
        assert.equal(edgeWithProfile(profile.slice(0, -1)), 0, `${name}: a shorter path is another folder`);
        assert.equal(edgeWithProfile(`${profile} 2`), 0, `${name}: a longer one too`);
        await edge.close();
        open = false;
        await until(`${name}: no Edge counted once it closed`, async () => edgeWithProfile(profile) === 0, 20_000);
      } finally {
        if (open) await edge.close();
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
});
