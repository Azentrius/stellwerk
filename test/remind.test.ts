// A request that waits long reminds: when its card pulses, and that the tones come once per request.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PermissionView } from '../src/shared/protocol.js';
import { newReminders, reminds } from '../ui/src/due.ts';

const AFTER = 20_000;
const request = (id: string, receivedAt: number, outcome: PermissionView['outcome'] = null) => ({ id, receivedAt, outcome }) as PermissionView;

test('an open request reminds once it has waited long enough; a settled one, or with 0, never', () => {
  assert.equal(reminds(request('a', 0), AFTER, AFTER - 1), false);
  assert.equal(reminds(request('a', 0), AFTER, AFTER), true);
  assert.equal(reminds(request('a', 0, 'allowed'), AFTER, 5 * AFTER), false);
  assert.equal(reminds(request('a', 0), 0, 5 * AFTER), false, '0 turns it off');
});

test('the tones come once per request that starts to remind, and again for a new one', () => {
  const reminded = new Set<string>();
  const open = [request('a', 0), request('b', 15_000)];
  assert.deepEqual(newReminders(open, AFTER, 10_000, reminded), []);
  assert.deepEqual(newReminders(open, AFTER, 20_000, reminded), ['a']);
  assert.deepEqual(newReminders(open, AFTER, 30_000, reminded), [], 'not again for the same one');
  assert.deepEqual(newReminders(open, AFTER, 35_000, reminded), ['b']);
  // Settled, it is forgotten; the same id open again (it never is in practice) would remind again.
  assert.deepEqual(newReminders([request('a', 0, 'allowed'), request('b', 15_000)], AFTER, 40_000, reminded), []);
  assert.deepEqual([...reminded], ['b']);
  assert.deepEqual(newReminders([request('c', 0)], 0, 99_000, reminded), [], 'never with 0');
});
