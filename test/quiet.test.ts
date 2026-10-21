// The display at rest: what wakes it, what keeps it awake, and when it rests.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { FailingMonitor, PermissionView, PullRequestView, SessionView, StateMessage } from '../src/shared/protocol.js';
import { NIGHT_REST_MS, Rest, inNight, restAfter, watched } from '../ui/src/quiet.ts';

const AFTER = 10 * 60_000;

function stateWith(parts: { sessions?: Partial<SessionView>[]; permissions?: Partial<PermissionView>[]; pulls?: Partial<PullRequestView>[]; failing?: FailingMonitor[] } = {}): StateMessage {
  return {
    type: 'state',
    now: 0,
    sessions: (parts.sessions ?? []) as SessionView[],
    permissions: (parts.permissions ?? []) as PermissionView[],
    pullRequests: (parts.pulls ?? []) as PullRequestView[],
    hub: { startedAt: 0, lastEventAt: null, sound: false, quietAfterMs: AFTER, remindAfterMs: 0, night: null, build: 'x', rejected: null, rawLog: false, newRelease: null },
    github: null,
    hardware: null,
    uptimeKuma: parts.failing ? { monitors: { failing: parts.failing, up: 3, maintenance: 0 }, updatedAt: 0, problem: null } : null,
    plans: [],
    decisions: [],
  } as StateMessage;
}

describe('what wakes the display', () => {
  test('answers due in the app, monitors down, pull requests and failed checks; open requests are counted', () => {
    const seen = watched(
      stateWith({
        sessions: [
          { id: 'a', status: 'waiting', waitingFor: 'question', waitingSince: 5 },
          { id: 'b', status: 'waiting', waitingFor: 'idle', waitingSince: 6 },
          { id: 'c', status: 'working', waitingFor: null, waitingSince: null },
        ],
        permissions: [{ id: 'r1', outcome: null }, { id: 'r2', outcome: 'allowed' }],
        pulls: [
          { repo: 'shop-api', number: 1, checks: 'passing' },
          { repo: 'shop-api', number: 2, checks: 'failing' },
        ],
        failing: [
          { name: 'Server', status: 'down', since: null },
          { name: 'Shop', status: 'pending', since: null },
        ],
      }),
      true,
    );
    assert.equal(seen.open, 1, 'a settled request does not keep it awake');
    assert.deepEqual(seen.keys, ['answer a 5', 'down Server', 'pull shop-api#1', 'pull shop-api#2', 'failing shop-api#2']);
  });

  test('without the hub, that is what wakes it', () => {
    assert.deepEqual(watched(stateWith(), false), { open: 0, keys: ['hub away'] });
    assert.deepEqual(watched(null, true), { open: 0, keys: [] });
  });
});

describe('at rest', () => {
  test('after the time with nothing new; what stays as it was does not wake it again', () => {
    const rest = new Rest(0);
    const seen = { open: 0, keys: ['down Server', 'pull shop-api#1'] };
    assert.equal(rest.update(seen, AFTER, 1000), false, 'what is there at first is new');
    assert.equal(rest.update(seen, AFTER, 1000 + AFTER - 1), false);
    assert.equal(rest.update(seen, AFTER, 1000 + AFTER), true);
    assert.equal(rest.update(seen, AFTER, 1000 + 5 * AFTER), true, 'the same things, still at rest');
  });

  test('something new wakes it, and the time starts again', () => {
    const rest = new Rest(0);
    rest.update({ open: 0, keys: ['down Server'] }, AFTER, 0);
    assert.equal(rest.update({ open: 0, keys: ['down Server'] }, AFTER, AFTER), true);
    assert.equal(rest.update({ open: 0, keys: ['down Server', 'down Shop'] }, AFTER, AFTER + 1), false);
    assert.equal(rest.update({ open: 0, keys: ['down Shop'] }, AFTER, 2 * AFTER), false, 'one gone is not new');
    assert.equal(rest.update({ open: 0, keys: ['down Shop'] }, AFTER, 2 * AFTER + 1), true);
    assert.equal(rest.update({ open: 0, keys: ['down Shop', 'down Server'] }, AFTER, 3 * AFTER), false, 'back again is new');
  });

  test('an open request keeps it awake, however long it is open', () => {
    const rest = new Rest(0);
    for (let t = 0; t <= 3 * AFTER; t += AFTER / 2) assert.equal(rest.update({ open: 1, keys: [] }, AFTER, t), false);
    assert.equal(rest.update({ open: 0, keys: [] }, AFTER, 3 * AFTER + AFTER - 1), false, 'the time starts when it is decided');
    assert.equal(rest.update({ open: 0, keys: [] }, AFTER, 4 * AFTER), true);
  });

  test('a tap wakes it; 0 keeps it awake', () => {
    const rest = new Rest(0);
    assert.equal(rest.update({ open: 0, keys: [] }, AFTER, AFTER), true);
    rest.wake(AFTER + 5);
    assert.equal(rest.update({ open: 0, keys: [] }, AFTER, AFTER + 6), false);
    assert.equal(rest.update({ open: 0, keys: [] }, AFTER, 2 * AFTER + 5), true);
    assert.equal(rest.update({ open: 0, keys: [] }, 0, 100 * AFTER), false);
  });
});

describe('at night', () => {
  const at = (h: number, m = 0) => h * 60 + m;

  test('the night lies between its two times, also over midnight; without one, never', () => {
    const late = { from: at(23), to: at(7) };
    assert.equal(inNight(late, at(23)), true);
    assert.equal(inNight(late, at(2, 30)), true);
    assert.equal(inNight(late, at(6, 59)), true);
    assert.equal(inNight(late, at(7)), false);
    assert.equal(inNight(late, at(22, 59)), false);
    const nap = { from: at(13), to: at(14) };
    assert.equal(inNight(nap, at(13, 30)), true);
    assert.equal(inNight(nap, at(14)), false);
    assert.equal(inNight(null, at(3)), false);
    assert.equal(inNight({ from: at(5), to: at(5) }, at(5)), false, 'no length, no night');
  });

  test('at night the display rests after a minute, sooner if the day is quicker, also when it never rests by day', () => {
    assert.equal(restAfter(10 * 60_000, false), 10 * 60_000);
    assert.equal(restAfter(0, false), 0);
    assert.equal(restAfter(10 * 60_000, true), NIGHT_REST_MS);
    assert.equal(restAfter(1500, true), 1500);
    assert.equal(restAfter(0, true), NIGHT_REST_MS);
  });
});
