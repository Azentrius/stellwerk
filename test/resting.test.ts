// Sessions at rest in the agents column: which ones, and when their line is open.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionStatus, SessionView } from '../src/shared/protocol.js';
import { OPEN_FOR_MS, REST_AFTER_MS, RestingLine, splitResting } from '../ui/src/resting.ts';

const NOW = 10 * REST_AFTER_MS;
const session = (id: string, status: SessionStatus, idleMs: number) => ({ id, status, lastActivity: NOW - idleMs }) as SessionView;

test('done and unknown sessions rest after a while without an event; the others never; the order stays', () => {
  const sessions = [
    session('working', 'working', 5 * REST_AFTER_MS),
    session('waiting', 'waiting', 5 * REST_AFTER_MS),
    session('asking', 'permission', 5 * REST_AFTER_MS),
    session('done now', 'done', REST_AFTER_MS - 1),
    session('done long', 'done', REST_AFTER_MS),
    session('unknown', 'unknown', 3 * REST_AFTER_MS),
    session('ended', 'ended', 5 * REST_AFTER_MS),
  ];
  const { active, resting } = splitResting(sessions, NOW);
  assert.deepEqual(active.map((s) => s.id), ['working', 'waiting', 'asking', 'done now', 'ended']);
  assert.deepEqual(resting.map((s) => s.id), ['done long', 'unknown']);
});

test('the line opens on a tap and closes on the next, or by itself a while after the last touch', () => {
  const line = new RestingLine();
  assert.equal(line.isOpen(0), false);
  line.touched(0);
  assert.equal(line.isOpen(0), false, 'a touch alone does not open it');
  line.toggle(1000);
  assert.equal(line.isOpen(1000 + OPEN_FOR_MS - 1), true);
  assert.equal(line.isOpen(1000 + OPEN_FOR_MS), false, 'closed by itself');
  line.toggle(2 * OPEN_FOR_MS);
  line.touched(2 * OPEN_FOR_MS + OPEN_FOR_MS / 2);
  assert.equal(line.isOpen(3 * OPEN_FOR_MS + 1), true, 'a touch keeps it open');
  line.toggle(3 * OPEN_FOR_MS + 2);
  assert.equal(line.isOpen(3 * OPEN_FOR_MS + 3), false, 'the next tap closes it');
});
