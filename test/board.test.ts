// The status model: how hook events, decisions and time change sessions and permission requests.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  Board,
  ENDED_VISIBLE_MS,
  IDLE_FORGET_MS,
  MAX_QUESTION,
  SETTLED_VISIBLE_MS,
  WRAP_UP_TOOL,
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

  test("a name and a project from the agent's app replace what the events give, also when found first", () => {
    const board = new Board();
    assert.equal(board.setProject(SESSION, 'Lautwerk - Codex'), false, 'no session yet: kept for it');
    board.addPermission('r1', request(), 1000, HOLD, 'codex');
    assert.equal(board.setTitle(SESSION, 'Implementation'), true);
    assert.equal(board.setTitle(SESSION, 'Implementation'), false, 'unchanged');
    const view = board.view();
    assert.deepEqual([view.sessions[0]?.title, view.sessions[0]?.project, view.permissions[0]?.project], ['Implementation', 'Lautwerk - Codex', 'Lautwerk - Codex']);
    board.apply(event('Stop'), 2000);
    assert.equal(board.view().sessions[0]?.title, 'Implementation', 'an event without a title keeps it');
    assert.equal(board.setProject(SESSION, ''), true, 'kept without a project');
    assert.equal(board.view().sessions[0]?.project, '');
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

  test('a request closed by Claude Code (answered in the app) leaves the session done until its next event', () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit'), 1);
    board.addPermission('p1', request(), 2, HOLD);
    board.settle('p1', 'decided-in-app', 3);
    assert.equal(statusOf(board), 'done');
    board.apply(event('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git push origin main' } }), 4);
    assert.equal(statusOf(board), 'working');
  });

  test('a question to the user gets no card; the session waits for the answer', () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit'), 1);
    board.askUser(request({ questions: [] }, { tool_name: 'AskUserQuestion' }), 2);
    assert.equal(statusOf(board), 'waiting');
    assert.equal(board.permissions.size, 0);
    assert.equal(board.lastEventAt, 2);
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

describe('what a waiting session waits for', () => {
  const waiting = (board: Board) => {
    const s = board.view().sessions[0];
    return { status: s?.status, waitingFor: s?.waitingFor, waitingSince: s?.waitingSince };
  };

  test('a question, input, a permission open in the app, or only the next prompt', () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit'), 1);
    board.askUser(request({ questions: [] }, { tool_name: 'AskUserQuestion' }), 2);
    assert.deepEqual(waiting(board), { status: 'waiting', waitingFor: 'question', waitingSince: 2 });

    board.apply(event('PostToolUse', { tool_name: 'AskUserQuestion', tool_input: {} }), 3);
    assert.deepEqual(waiting(board), { status: 'working', waitingFor: null, waitingSince: null });

    board.apply(event('Notification', { notification_type: 'elicitation_dialog' }), 4);
    assert.equal(waiting(board).waitingFor, 'input');
    board.apply(event('Notification', { notification_type: 'agent_needs_input' }), 5);
    assert.deepEqual(waiting(board), { status: 'waiting', waitingFor: 'input', waitingSince: 4 });

    board.apply(event('Stop'), 6);
    board.apply(event('Notification', { notification_type: 'idle_prompt' }), 7);
    assert.deepEqual(waiting(board), { status: 'waiting', waitingFor: 'idle', waitingSince: 7 });
  });

  test('a permission handed to the app, or left there when the hold time ended, waits in the app', () => {
    for (const outcome of ['handed-to-app', 'timed-out'] as const) {
      const board = new Board();
      board.addPermission('p1', request(), 1, HOLD);
      assert.equal(waiting(board).waitingFor, null, 'the card itself is no answer due in the app');
      board.settle('p1', outcome, 2);
      assert.deepEqual(waiting(board), { status: 'waiting', waitingFor: 'permission', waitingSince: 2 }, outcome);
    }
    const board = new Board();
    board.apply(event('Notification', { notification_type: 'permission_prompt' }), 1);
    assert.equal(waiting(board).waitingFor, 'permission', 'a request the hub never saw');
  });

  test('a question asked with AskUserQuestion is kept for the display while it waits', () => {
    const board = new Board();
    board.askUser(request({ questions: [{ question: '  Which   contrast level? ', options: [] }] }, { tool_name: 'AskUserQuestion' }), 1);
    assert.equal(board.view().sessions[0]?.question, 'Which contrast level?');
    board.apply(event('PostToolUse', { tool_name: 'AskUserQuestion', tool_input: {} }), 2);
    assert.equal(board.view().sessions[0]?.question, null, 'answered');
    board.askUser(request({ questions: 'not a list' }, { tool_name: 'AskUserQuestion' }), 3);
    assert.deepEqual([waiting(board).waitingFor, board.view().sessions[0]?.question], ['question', null]);
  });

  test('mere idleness does not replace a question', () => {
    const board = new Board();
    board.askUser(request({ questions: [] }, { tool_name: 'AskUserQuestion' }), 1);
    board.apply(event('Notification', { notification_type: 'idle_prompt' }), 2);
    assert.deepEqual(waiting(board), { status: 'waiting', waitingFor: 'question', waitingSince: 1 });
  });

  test("anything that means the main agent works again ends the waiting; a subagent starting does not", () => {
    for (const name of ['UserPromptSubmit', 'Stop', 'SessionEnd']) {
      const board = new Board();
      board.askUser(request({ questions: [] }, { tool_name: 'AskUserQuestion' }), 1);
      board.apply(event(name), 2);
      assert.equal(waiting(board).waitingFor, null, name);
    }
    const asked = new Board();
    asked.askUser(request({ questions: [] }, { tool_name: 'AskUserQuestion' }), 1);
    asked.apply(event('SubagentStart', { agent_id: 'a1' }), 2);
    assert.equal(waiting(asked).waitingFor, 'question', 'a subagent starting leaves the question open');
    const board = new Board();
    board.apply(event('Notification', { notification_type: 'idle_prompt' }), 1);
    board.addPermission('p1', request(), 2, HOLD);
    assert.deepEqual(waiting(board), { status: 'permission', waitingFor: null, waitingSince: null });
  });
});

describe('questions asked without waiting (Codex)', () => {
  const ask = (title: string) =>
    event('PostToolUse', { tool_name: 'request_user_input_async', tool_input: { questions: [{ title, options: ['Yes', 'No'] }] } });
  const session = (board: Board) => {
    const s = board.view().sessions[0];
    return [s?.status, s?.waitingFor, s?.question, s?.waitingSince];
  };

  test('stay open past the end of the turn and further tool events, until the answer', () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit'), 1, 'codex');
    board.apply(ask('Fetch the latest state?'), 2, 'codex');
    board.apply(event('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }), 3, 'codex');
    board.apply(event('Stop'), 4, 'codex');
    assert.deepEqual(session(board), ['waiting', 'question', 'Fetch the latest state?', 2]);
    // The answer comes as the next prompt.
    board.apply(event('UserPromptSubmit'), 5, 'codex');
    assert.deepEqual(session(board), ['working', null, null, null]);
  });

  test('a new one replaces the open one; the end of the session drops it; a request still shows first', () => {
    const board = new Board();
    board.apply(ask('First?'), 1, 'codex');
    board.apply(ask('Second?'), 2, 'codex');
    assert.equal(session(board)[2], 'Second?');
    board.addPermission('p1', request(), 3, HOLD, 'codex');
    assert.equal(session(board)[0], 'permission');
    board.apply(event('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git push origin main' } }), 4, 'codex');
    assert.deepEqual(session(board), ['waiting', 'question', 'Second?', 2]);
    board.apply(event('SessionEnd'), 5, 'codex');
    assert.deepEqual(session(board), ['ended', null, null, null]);
  });
});

describe("the app's box at the end of a turn", () => {
  const wrapUp = (input: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    event('PostToolUse', { tool_name: WRAP_UP_TOOL, tool_input: { recap: 'Done with the first host.', ...input }, ...extra });
  const session = (board: Board) => {
    const s = board.view().sessions[0];
    return { status: s?.status, waitingFor: s?.waitingFor, waitingSince: s?.waitingSince, question: s?.question };
  };

  test('with a question, the Stop that ends the turn makes the session wait for the answer', () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit'), 1);
    board.apply(wrapUp({ ask: 'Set up the other two hosts the same way?', blocked: true, actions: [{ label: 'Yes', message: 'Yes' }] }), 2);
    assert.equal(session(board).status, 'working', 'the turn is not over yet');
    board.apply(event('Stop'), 3);
    assert.deepEqual(session(board), { status: 'waiting', waitingFor: 'question', waitingSince: 3, question: 'Set up the other two hosts the same way?' });
    board.apply(event('Notification', { notification_type: 'idle_prompt' }), 4);
    assert.equal(session(board).waitingFor, 'question', 'idleness does not replace it');
    board.apply(event('UserPromptSubmit'), 5);
    assert.deepEqual(session(board), { status: 'working', waitingFor: null, waitingSince: null, question: null });
    board.apply(event('Stop'), 6);
    assert.equal(session(board).status, 'done', 'the next turn without a box is done again');
  });

  test('blocked without a question waits for input; neither means done', () => {
    const board = new Board();
    board.apply(wrapUp({ blocked: true, ask: '   ' }), 1);
    board.apply(event('Stop'), 2);
    assert.deepEqual(session(board), { status: 'waiting', waitingFor: 'input', waitingSince: 2, question: null });
    board.apply(event('UserPromptSubmit'), 3);
    board.apply(wrapUp({ blocked: false }), 4);
    board.apply(event('Stop'), 5);
    assert.equal(session(board).status, 'done');
  });

  test('a long question is cut; a box from a subagent or a failed one does not count', () => {
    const board = new Board();
    board.apply(wrapUp({ ask: 'x'.repeat(MAX_QUESTION + 50) }), 1);
    board.apply(event('Stop'), 2);
    assert.equal(session(board).question, `${'x'.repeat(MAX_QUESTION)}…`);

    for (const other of [wrapUp({ ask: 'Really?' }, { agent_id: 'a1' }), event('PostToolUseFailure', { tool_name: WRAP_UP_TOOL, tool_input: { ask: 'Really?' } })]) {
      const b = new Board();
      b.apply(other, 1);
      b.apply(event('Stop'), 2);
      assert.equal(session(b).status, 'done');
    }
  });

  test('a session that ends forgets the question', () => {
    const board = new Board();
    board.apply(wrapUp({ ask: 'Go on?' }), 1);
    board.apply(event('SessionEnd'), 2);
    board.apply(event('Stop'), 3);
    assert.equal(session(board).status, 'done');
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

  test("a subagent's work leaves the main agent's question open: tools, failures, starts, stops and requests", () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit'), 1);
    board.apply(event('SubagentStart', { agent_id: 'a1' }), 2);
    board.askUser(request({ questions: [{ question: 'Which branch?' }] }, { tool_name: 'AskUserQuestion' }), 3);
    const question = () => {
      const s = board.view().sessions[0];
      return [s?.status, s?.waitingFor, s?.question];
    };
    board.apply(event('PostToolUse', { agent_id: 'a1', tool_name: 'Read', tool_input: { file_path: 'a.ts' } }), 4);
    board.apply(event('PostToolUseFailure', { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'false' } }), 5);
    board.apply(event('SubagentStart', { agent_id: 'a2' }), 6);
    assert.deepEqual(question(), ['waiting', 'question', 'Which branch?']);
    // A subagent's request shows as such while open, and afterwards the question is still there.
    board.addPermission('sub', request({ command: 'ls' }, { agent_id: 'a1' }), 7, HOLD);
    assert.equal(board.view().sessions[0]?.status, 'permission');
    board.apply(event('PostToolUse', { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'ls' } }), 8);
    assert.equal(board.view().permissions[0]?.outcome, 'decided-in-app');
    board.apply(event('SubagentStop', { agent_id: 'a2' }), 9);
    assert.deepEqual(question(), ['waiting', 'question', 'Which branch?']);
    // The main agent's own tool (the answered question) ends the waiting.
    board.apply(event('PostToolUse', { tool_name: 'AskUserQuestion', tool_input: {} }), 10);
    assert.deepEqual(question(), ['working', null, null]);
  });

  test("settling a subagent's request keeps the main agent's question and its time, whatever the outcome", () => {
    for (const outcome of ['allowed', 'denied', 'handed-to-app', 'timed-out', 'decided-in-app'] as const) {
      const board = new Board();
      board.apply(event('UserPromptSubmit'), 1);
      board.askUser(request({ questions: [{ question: 'Which branch?' }] }, { tool_name: 'AskUserQuestion' }), 2);
      board.addPermission('sub', request({ command: 'ls' }, { agent_id: 'a1' }), 3, HOLD);
      assert.equal(board.settle('sub', outcome, 4), true);
      const s = board.view().sessions[0];
      assert.deepEqual([s?.status, s?.waitingFor, s?.question, s?.waitingSince], ['waiting', 'question', 'Which branch?', 2], outcome);
    }
  });

  test("a subagent's request at the app's card shows after the main agent's question, until the subagent goes on", () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit'), 1);
    board.askUser(request({ questions: [{ question: 'Which branch?' }] }, { tool_name: 'AskUserQuestion' }), 2);
    board.addPermission('sub', request({ command: 'ls' }, { agent_id: 'a1' }), 3, HOLD);
    board.settle('sub', 'handed-to-app', 4);
    const shown = () => {
      const s = board.view().sessions[0];
      return [s?.status, s?.waitingFor, s?.waitingSince];
    };
    assert.deepEqual(shown(), ['waiting', 'question', 2], "the main agent's question comes first");
    board.apply(event('PostToolUse', { tool_name: 'AskUserQuestion', tool_input: {} }), 5);
    assert.deepEqual(shown(), ['waiting', 'permission', 4], "then the subagent's request in the app");
    board.apply(event('PostToolUse', { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'ls' } }), 6);
    assert.deepEqual(shown(), ['working', null, null], 'the subagent went on: answered in the app');
    // Timed out, and over with the subagent's stop.
    board.addPermission('sub2', request({ command: 'pwd' }, { agent_id: 'a2' }), 7, HOLD);
    board.settle('sub2', 'timed-out', 8);
    assert.deepEqual(shown(), ['waiting', 'permission', 8]);
    board.apply(event('SubagentStart', { agent_id: 'a2' }), 9);
    board.apply(event('SubagentStop', { agent_id: 'a2' }), 10);
    assert.deepEqual(shown(), ['working', null, null]);
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
