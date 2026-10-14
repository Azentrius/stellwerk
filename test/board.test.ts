// The status model: how hook events, decisions and time change sessions and permission requests.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  Board,
  ENDED_VISIBLE_MS,
  IDLE_FORGET_MS,
  SETTLED_VISIBLE_MS,
  canonicalJson,
  projectName,
} from '../src/hub/board.ts';
import type { HookEvent, PermissionRequestEvent } from '../src/hub/hook-input.ts';

const SESSION = 'session-1';
const CWD = 'C:\\Projekte\\shop-api';
const HOLD = 60_000;

function event(name: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: SESSION, cwd: CWD, ...extra } as HookEvent;
}

function request(input: Record<string, unknown> = { command: 'git push origin main' }, extra: Partial<PermissionRequestEvent> = {}) {
  return { hook_event_name: 'PermissionRequest', session_id: SESSION, cwd: CWD, tool_name: 'Bash', tool_input: input, ...extra } as PermissionRequestEvent;
}

function statusOf(board: Board, id = SESSION) {
  return board.view().sessions.find((s) => s.id === id)?.status;
}

describe('sessions', () => {
  test('a session appears with its first event, named after the last part of its directory', () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit', { session_title: 'Fix the login' }), 1000);
    const [session] = board.view().sessions;
    assert.equal(session?.project, 'shop-api');
    assert.equal(session?.title, 'Fix the login');
    assert.equal(session?.status, 'working');
    assert.equal(board.lastEventAt, 1000);
  });

  test('prompt, stop and notifications move the status', () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit'), 1);
    assert.equal(statusOf(board), 'working');
    board.apply(event('Stop'), 2);
    assert.equal(statusOf(board), 'done');
    board.apply(event('Notification', { notification_type: 'idle_prompt' }), 3);
    assert.equal(statusOf(board), 'waiting');
    board.apply(event('PostToolUse', { tool_name: 'Read' }), 4);
    assert.equal(statusOf(board), 'working');
    board.apply(event('Notification', { notification_type: 'auth_success' }), 5);
    assert.equal(statusOf(board), 'working');
  });

  test('sessions are sorted by urgency, then by last activity', () => {
    const board = new Board();
    board.apply({ ...event('Stop'), session_id: 'done-early' }, 1);
    board.apply({ ...event('UserPromptSubmit'), session_id: 'working' }, 2);
    board.apply({ ...event('Stop'), session_id: 'done-late' }, 3);
    board.addPermission('p1', { ...request(), session_id: 'asking' }, 4, HOLD);
    board.apply({ ...event('Notification', { notification_type: 'idle_prompt' }), session_id: 'waiting' }, 5);
    board.apply({ ...event('SessionEnd'), session_id: 'ended' }, 6);
    assert.deepEqual(
      board.view().sessions.map((s) => s.id),
      ['asking', 'waiting', 'working', 'done-late', 'done-early', 'ended'],
    );
  });

  test('an ended session stays greyed out for ten minutes, then disappears', () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit'), 0);
    board.apply(event('SessionEnd', { reason: 'other' }), 1000);
    assert.equal(statusOf(board), 'ended');
    assert.equal(board.sweep(1000 + ENDED_VISIBLE_MS - 1), false);
    assert.equal(statusOf(board), 'ended');
    assert.equal(board.sweep(1000 + ENDED_VISIBLE_MS), true);
    assert.equal(board.view().sessions.length, 0);
  });

  test('a session resumed after its end comes back', () => {
    const board = new Board();
    board.apply(event('SessionEnd'), 1);
    board.apply(event('UserPromptSubmit'), 2);
    const [session] = board.view().sessions;
    assert.equal(session?.status, 'working');
    assert.equal(session?.endedAt, null);
  });

  test('sessions without any event for twelve hours are forgotten', () => {
    const board = new Board();
    board.apply(event('Stop'), 0);
    board.sweep(IDLE_FORGET_MS);
    assert.equal(board.view().sessions.length, 0);
  });
});

describe('permission requests', () => {
  test('an open request puts its session on "permission"; allowing it lets the session work', () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit'), 1);
    board.addPermission('p1', request(), 2, HOLD);
    assert.equal(statusOf(board), 'permission');
    assert.equal(board.pendingCount(), 1);
    assert.equal(board.settle('p1', 'allowed', 3), true);
    assert.equal(statusOf(board), 'working');
    assert.equal(board.pendingCount(), 0);
  });

  test('handing over to the app, or the end of the hold time, leaves the session waiting for the user', () => {
    for (const outcome of ['handed-to-app', 'timed-out'] as const) {
      const board = new Board();
      board.addPermission('p1', request(), 1, HOLD);
      board.settle('p1', outcome, 2);
      assert.equal(statusOf(board), 'waiting', outcome);
    }
  });

  test('a request is settled once; later attempts and unknown ids return false', () => {
    const board = new Board();
    board.addPermission('p1', request(), 1, HOLD);
    assert.equal(board.settle('p1', 'denied', 2), true);
    assert.equal(board.settle('p1', 'allowed', 3), false);
    assert.equal(board.settle('nope', 'allowed', 3), false);
    assert.equal(board.view().permissions[0]?.outcome, 'denied');
  });

  test('open requests come oldest first, settled ones after them, and those go after a few seconds', () => {
    const board = new Board();
    board.addPermission('old', request(), 1, HOLD);
    board.addPermission('new', request({ command: 'ls' }), 2, HOLD);
    board.addPermission('settled', request({ command: 'pwd' }), 3, HOLD);
    board.settle('settled', 'allowed', 10);
    assert.deepEqual(board.view().permissions.map((p) => p.id), ['old', 'new', 'settled']);
    board.sweep(10 + SETTLED_VISIBLE_MS - 1);
    assert.equal(board.view().permissions.length, 3);
    board.sweep(10 + SETTLED_VISIBLE_MS);
    assert.deepEqual(board.view().permissions.map((p) => p.id), ['old', 'new']);
  });

  test('the view carries the complete input, the project and the hold deadline', () => {
    const board = new Board();
    const input = { command: 'git push origin main', description: 'Push', timeout: 120000 };
    board.addPermission('p1', request(input, { session_title: 'Release' }), 1000, HOLD);
    const [view] = board.view().permissions;
    assert.deepEqual(view?.input, input);
    assert.equal(view?.project, 'shop-api');
    assert.equal(view?.title, 'Release');
    assert.equal(view?.holdUntil, 1000 + HOLD);
  });
});

describe('requests decided in the app', () => {
  test('Stop settles the open requests of the main agent', () => {
    const board = new Board();
    board.addPermission('main', request(), 1, HOLD);
    board.addPermission('sub', request({ command: 'ls' }, { agent_id: 'agent-1' }), 2, HOLD);
    const settled = board.apply(event('Stop'), 3);
    assert.deepEqual(settled.map((s) => [s.permission.id, s.outcome]), [['main', 'decided-in-app']]);
    assert.equal(board.permissions.get('sub')?.outcome, null);
  });

  test('a new prompt settles them as well', () => {
    const board = new Board();
    board.addPermission('main', request(), 1, HOLD);
    const settled = board.apply(event('UserPromptSubmit'), 2);
    assert.equal(settled.length, 1);
    assert.equal(statusOf(board), 'working');
  });

  test('PostToolUse settles exactly the request with the same tool and input, whatever the key order', () => {
    const board = new Board();
    board.addPermission('a', request({ command: 'npm test', description: 'Test' }), 1, HOLD);
    board.addPermission('b', request({ command: 'npm run build', description: 'Build' }), 2, HOLD);
    const settled = board.apply(
      event('PostToolUse', { tool_name: 'Bash', tool_input: { description: 'Build', command: 'npm run build' } }),
      3,
    );
    assert.deepEqual(settled.map((s) => s.permission.id), ['b']);
    assert.equal(board.permissions.get('a')?.outcome, null);
  });

  test('PostToolUse of another agent or another tool settles nothing', () => {
    const board = new Board();
    board.addPermission('main', request(), 1, HOLD);
    assert.equal(board.apply(event('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git push origin main' }, agent_id: 'x' }), 2).length, 0);
    assert.equal(board.apply(event('PostToolUseFailure', { tool_name: 'Write', tool_input: { command: 'git push origin main' } }), 3).length, 0);
    assert.equal(board.apply(event('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'git push origin main' } }), 4).length, 1);
  });

  test('the permission_prompt notification that follows every request changes nothing while it is open', () => {
    const board = new Board();
    board.addPermission('p1', request(), 1, HOLD);
    board.apply(event('Notification', { notification_type: 'permission_prompt' }), 2);
    assert.equal(statusOf(board), 'permission');
    assert.equal(board.permissions.get('p1')?.outcome, null);
    board.settle('p1', 'timed-out', 3);
    board.apply(event('Notification', { notification_type: 'permission_prompt' }), 4);
    assert.equal(statusOf(board), 'waiting');
  });

  test('SessionEnd cancels every open request of the session', () => {
    const board = new Board();
    board.addPermission('p1', request(), 1, HOLD);
    const settled = board.apply(event('SessionEnd'), 2);
    assert.deepEqual(settled.map((s) => s.outcome), ['aborted']);
    assert.equal(statusOf(board), 'ended');
  });
});

describe('subagents', () => {
  test('are counted in pairs of start and stop', () => {
    const board = new Board();
    board.apply(event('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }), 1);
    board.apply(event('SubagentStart', { agent_id: 'a2', agent_type: 'Plan' }), 2);
    assert.equal(board.view().sessions[0]?.subagents, 2);
    board.apply(event('SubagentStop', { agent_id: 'a1' }), 3);
    assert.equal(board.view().sessions[0]?.subagents, 1);
  });

  test('a stop without a start (internal helpers of the app) is ignored', () => {
    const board = new Board();
    board.apply(event('SubagentStart', { agent_id: 'a1' }), 1);
    board.apply(event('SubagentStop', { agent_id: 'helper', agent_type: '' }), 2);
    board.apply(event('SubagentStop'), 3);
    assert.equal(board.view().sessions[0]?.subagents, 1);
  });

  test('the stop of a subagent settles its own open requests', () => {
    const board = new Board();
    board.apply(event('SubagentStart', { agent_id: 'a1' }), 1);
    board.addPermission('sub', request({ command: 'ls' }, { agent_id: 'a1' }), 2, HOLD);
    board.addPermission('main', request(), 3, HOLD);
    const settled = board.apply(event('SubagentStop', { agent_id: 'a1' }), 4);
    assert.deepEqual(settled.map((s) => s.permission.id), ['sub']);
  });
});

describe('helpers', () => {
  test('projectName takes the last part of Windows and POSIX paths', () => {
    assert.equal(projectName('C:\\Users\\dev\\Projekte\\stellwerk'), 'stellwerk');
    assert.equal(projectName('C:\\Users\\dev\\Projekte\\stellwerk\\'), 'stellwerk');
    assert.equal(projectName('/home/user/code/app'), 'app');
    assert.equal(projectName(''), '');
  });

  test('canonicalJson ignores the order of keys, also nested, but not of arrays', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, 1] } }), canonicalJson({ a: { c: [3, 1], d: 2 }, b: 1 }));
    assert.notEqual(canonicalJson({ a: [1, 3] }), canonicalJson({ a: [3, 1] }));
  });
});
