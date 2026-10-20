// One filled button on the display: of all waiting cards only the oldest open request fills its Allow.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PermissionOutcome, PermissionView } from '../src/shared/protocol.js';
import { leadingRequest } from '../ui/src/leading.ts';

function request(id: string, receivedAt: number, outcome: PermissionOutcome | null = null): PermissionView {
  return {
    id,
    sessionId: 'session',
    provider: 'claude',
    terminal: false,
    project: 'shop-api',
    title: null,
    tool: 'Bash',
    input: { command: 'git status' },
    mcpServer: null,
    receivedAt,
    holdUntil: receivedAt + 60_000,
    outcome,
    resolvedAt: outcome === null ? null : receivedAt + 1_000,
  };
}

test('of several waiting requests only the oldest, the top card, fills its Allow', () => {
  assert.equal(leadingRequest([request('a', 1), request('b', 2), request('c', 3)]), 'a');
});

test('a decided request passes the filled Allow to the next open one', () => {
  // The hub sends the open requests first, oldest on top, then the decided ones; a decided card can
  // still stand above the open ones for a moment.
  assert.equal(leadingRequest([request('b', 2), request('c', 3), request('a', 1, 'allowed')]), 'b');
  assert.equal(leadingRequest([request('a', 1, 'denied'), request('b', 2)]), 'b');
});

test('with no open request no Allow is filled', () => {
  assert.equal(leadingRequest([]), null);
  assert.equal(leadingRequest([request('a', 1, 'handed-to-app'), request('b', 2, 'timed-out')]), null);
});
