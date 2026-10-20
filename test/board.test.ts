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
  MAX_SESSIONS,
  SETTLED_VISIBLE_MS,
  WRAP_UP_TOOL,
  canonicalJson,
  projectName,
  type SavedSession,
  type Settlement,
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

  for (const outcome of ['handed-to-app', 'timed-out'] as const) {
    describe(`requests of a subagent ${outcome === 'timed-out' ? 'whose time ran out' : 'handed to the app'}`, () => {
      /** Two Bash requests of subagent a1 at the app's card, at 10 and 20; seen from what the session shows. */
      const twoAtTheApp = (withQuestion = false) => {
        const board = new Board();
        board.apply(event('UserPromptSubmit'), 1);
        if (withQuestion) board.askUser(request({ questions: [{ question: 'Which branch?' }] }, { tool_name: 'AskUserQuestion' }), 2);
        board.addPermission('r1', request({ command: 'echo one' }, { agent_id: 'a1' }), 5, HOLD);
        board.addPermission('r2', request({ command: 'echo two' }, { agent_id: 'a1' }), 6, HOLD);
        board.settle('r1', outcome, 10);
        board.settle('r2', outcome, 20);
        const shown = () => {
          const s = board.view().sessions[0];
          return [s?.status, s?.waitingFor, s?.waitingSince];
        };
        return { board, shown };
      };
      const ran = (input: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}, name = 'PostToolUse') =>
        event(name, { agent_id: 'a1', tool_name: 'Bash', ...(input ? { tool_input: input } : {}), ...extra });

      test('an unrelated tool of the same subagent, run or failed, leaves them open', () => {
        const { board, shown } = twoAtTheApp();
        board.apply(event('PostToolUse', { agent_id: 'a1', tool_name: 'Read', tool_input: { file_path: 'a.ts' } }), 30);
        board.apply(event('PostToolUseFailure', { agent_id: 'a1', tool_name: 'Read', tool_input: { file_path: 'b.ts' } }), 31);
        board.apply(ran({ command: 'echo three' }), 32);
        assert.deepEqual(shown(), ['waiting', 'permission', 10]);
      });

      test('the first one running leaves the second, with its own time; the last one ends the waiting', () => {
        const { board, shown } = twoAtTheApp();
        board.apply(ran({ command: 'echo one' }), 30);
        assert.deepEqual(shown(), ['waiting', 'permission', 20]);
        board.apply(ran({ command: 'echo two' }, {}, 'PostToolUseFailure'), 31);
        assert.deepEqual(shown(), ['working', null, null]);
      });

      test('still matched after the cards are swept from the display', () => {
        const { board, shown } = twoAtTheApp();
        board.sweep(20 + SETTLED_VISIBLE_MS + 1);
        assert.equal(board.view().permissions.length, 0, 'the cards are gone');
        board.apply(ran({ command: 'echo two' }), 20 + SETTLED_VISIBLE_MS + 2);
        assert.deepEqual(shown(), ['waiting', 'permission', 10]);
      });

      test('other agents, and an event without input that fits two, take nothing away; the stop takes all of its own', () => {
        const { board, shown } = twoAtTheApp();
        board.addPermission('r3', request({ command: 'echo one' }, { agent_id: 'a2' }), 21, HOLD);
        board.settle('r3', outcome, 22);
        board.apply(event('PostToolUse', { agent_id: 'a2', tool_name: 'Bash', tool_input: { command: 'echo one' } }), 30);
        board.apply(event('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'echo one' } }), 31);
        board.apply(ran(undefined), 32);
        assert.deepEqual(shown(), ['waiting', 'permission', 10], 'none of them belonged to r1 or r2 for sure');
        board.apply(event('SubagentStart', { agent_id: 'a1' }), 33);
        board.apply(event('SubagentStop', { agent_id: 'a1' }), 34);
        assert.deepEqual(shown(), ['working', null, null], 'a1 stopped: its requests are over, a2 had none left');
      });

      test("a question of the main agent stays first and keeps its time", () => {
        const { board } = twoAtTheApp(true);
        board.apply(ran({ command: 'echo one' }), 30);
        const s = board.view().sessions[0];
        assert.deepEqual([s?.status, s?.waitingFor, s?.question, s?.waitingSince], ['waiting', 'question', 'Which branch?', 2]);
      });

      describe('next to a request of the same tool still held', () => {
        const SAME = { command: 'echo same' };
        /**
         * Subagent a1's Bash request 'app' at the app's card from 10 and its request 'held' still on the
         * display; 'app' asked first (at 5, 'held' at 11), with heldFirst 'held' (at 5, 'app' at 6).
         */
        const appAndHeld = (appInput: Record<string, unknown>, heldInput: Record<string, unknown>, options: { heldFirst?: boolean; withQuestion?: boolean } = {}) => {
          const board = new Board();
          board.apply(event('UserPromptSubmit'), 1);
          if (options.withQuestion) board.askUser(request({ questions: [{ question: 'Which branch?' }] }, { tool_name: 'AskUserQuestion' }), 2);
          if (options.heldFirst) board.addPermission('held', request(heldInput, { agent_id: 'a1' }), 5, HOLD);
          board.addPermission('app', request(appInput, { agent_id: 'a1' }), options.heldFirst ? 6 : 5, HOLD);
          board.settle('app', outcome, 10);
          if (!options.heldFirst) board.addPermission('held', request(heldInput, { agent_id: 'a1' }), 11, HOLD);
          /** Which of the two are still open: 'held' on the display, 'app' at the app's card. */
          const open = () => ({
            held: board.permissions.get('held')?.outcome === null,
            app: board.sessions.get(SESSION)?.subagentAppRequests.has('app') ?? false,
          });
          const shown = () => {
            const s = board.view().sessions[0];
            return [s?.status, s?.waitingFor, s?.waitingSince];
          };
          return { board, open, shown };
        };
        const ended = (settled: Settlement[]) => settled.map((s) => [s.permission.id, s.outcome]);

        for (const name of ['PostToolUse', 'PostToolUseFailure']) {
          test(`${name} with the input both have ends only the older one, the one at the app's card`, () => {
            const { board, open, shown } = appAndHeld(SAME, SAME);
            assert.deepEqual(ended(board.apply(ran(SAME, {}, name), 20)), [], 'the held request gets no answer');
            assert.deepEqual(open(), { held: true, app: false });
            assert.equal(statusOf(board), 'permission');
            // The next run with that input is the held request's.
            assert.deepEqual(ended(board.apply(ran(SAME, {}, name), 21)), [['held', 'decided-in-app']]);
            assert.deepEqual(shown(), ['working', null, null]);
          });

          test(`${name} with the input both have ends only the older one, the held one`, () => {
            const { board, open, shown } = appAndHeld(SAME, SAME, { heldFirst: true });
            assert.deepEqual(ended(board.apply(ran(SAME, {}, name), 20)), [['held', 'decided-in-app']]);
            assert.deepEqual(open(), { held: false, app: true });
            assert.deepEqual(shown(), ['waiting', 'permission', 10]);
          });

          test(`${name} without input, with one candidate in each state, ends neither, also after the sweep`, () => {
            const { board, open, shown } = appAndHeld({ command: 'echo one' }, { command: 'echo two' });
            board.sweep(10 + SETTLED_VISIBLE_MS + 1);
            assert.deepEqual(ended(board.apply(ran(undefined, {}, name), 10 + SETTLED_VISIBLE_MS + 2)), []);
            assert.deepEqual(open(), { held: true, app: true });
            // Once the held one is decided on the display, the one at the app's card is the only candidate.
            board.settle('held', 'allowed', 10 + SETTLED_VISIBLE_MS + 3);
            assert.deepEqual(shown(), ['waiting', 'permission', 10]);
            board.apply(ran(undefined, {}, name), 10 + SETTLED_VISIBLE_MS + 4);
            assert.deepEqual(open(), { held: false, app: false });
            assert.deepEqual(shown(), ['working', null, null]);
          });

          test(`${name} with an input only one of them has ends just that one, whatever its state`, () => {
            const first = appAndHeld({ command: 'echo one' }, { command: 'echo two' });
            assert.deepEqual(ended(first.board.apply(ran({ command: 'echo one' }, {}, name), 20)), []);
            assert.deepEqual(first.open(), { held: true, app: false });
            const second = appAndHeld({ command: 'echo one' }, { command: 'echo two' });
            assert.deepEqual(ended(second.board.apply(ran({ command: 'echo two' }, {}, name), 20)), [['held', 'decided-in-app']]);
            assert.deepEqual(second.open(), { held: false, app: true });
          });

          test(`${name} after the sweep keeps the main agent's question, and the remaining request ends with its own run`, () => {
            const { board, open } = appAndHeld(SAME, SAME, { withQuestion: true });
            const later = 10 + SETTLED_VISIBLE_MS + 1;
            board.sweep(later);
            assert.deepEqual(board.view().permissions.map((p) => p.id), ['held'], "the card of the one at the app's card is gone");
            assert.deepEqual(ended(board.apply(ran(SAME, {}, name), later + 1)), []);
            assert.deepEqual(open(), { held: true, app: false });
            assert.deepEqual(ended(board.apply(ran(SAME, {}, name), later + 2)), [['held', 'decided-in-app']]);
            const s = board.view().sessions[0];
            assert.deepEqual([s?.status, s?.waitingFor, s?.question, s?.waitingSince], ['waiting', 'question', 'Which branch?', 2]);
          });
        }
      });
    });
  }

  test('the stop of a subagent settles its own open requests', () => {
    const board = new Board();
    board.apply(event('SubagentStart', { agent_id: 'a1' }), 1);
    board.addPermission('sub', request({ command: 'ls' }, { agent_id: 'a1' }), 2, HOLD);
    board.addPermission('main', request(), 3, HOLD);
    const settled = board.apply(event('SubagentStop', { agent_id: 'a1' }), 4);
    assert.deepEqual(settled.map((s) => s.permission.id), ['sub']);
  });
});

describe('over a restart of the hub', () => {
  const saved = (id: string, lastActivity: number, extra: Partial<SavedSession> = {}): SavedSession => ({
    id,
    provider: 'claude',
    cwd: CWD,
    title: `Title of ${id}`,
    project: null,
    context: { used: 42, size: 100 },
    lastActivity,
    ...extra,
  });

  test('the sessions of the last run come back as unknown, with name, project, context and their time', () => {
    const board = new Board();
    const now = 10 * 3_600_000;
    const restored = board.restore([saved('a', now - 60_000), saved('b', now - 3_600_000, { provider: 'codex', project: 'Lautwerk - Codex' })], now);
    assert.equal(restored, 2);
    assert.deepEqual(
      board.view().sessions.map((s) => [s.id, s.status, s.provider, s.project, s.title, s.context?.used, s.lastActivity, s.waitingFor]),
      [
        ['a', 'unknown', 'claude', 'shop-api', 'Title of a', 42, now - 60_000, null],
        ['b', 'unknown', 'codex', 'Lautwerk - Codex', 'Title of b', 42, now - 3_600_000, null],
      ],
    );
    assert.deepEqual(board.view().permissions, [], 'no request comes back');
    assert.equal(board.lastEventAt, null, 'no event yet');
  });

  test('only what the running hub would still show: active within IDLE_FORGET_MS, not twice, not over the limit', () => {
    const board = new Board();
    const now = 100 * 3_600_000;
    board.apply({ ...event('UserPromptSubmit'), session_id: 'live' } as HookEvent, now);
    const list = [
      saved('live', now - 1000),
      saved('old', now - IDLE_FORGET_MS),
      saved('ahead', now + 1000),
      ...Array.from({ length: MAX_SESSIONS + 5 }, (_, i) => saved(`s${i}`, now - i)),
    ];
    assert.equal(board.restore(list, now), MAX_SESSIONS - 1);
    assert.equal(statusOf(board, 'live'), 'working', 'a session already there keeps what it is');
    assert.equal(statusOf(board, 'old'), undefined);
    assert.equal(statusOf(board, 'ahead'), undefined);
    assert.equal(board.view().sessions.length, MAX_SESSIONS);
  });

  test('unknown stands after done and before ended; its next event says what it does', () => {
    const board = new Board();
    board.restore([saved(SESSION, 900), saved('other', 800), saved('third', 700), saved('fourth', 600), saved('fifth', 500)], 1000);
    board.apply({ ...event('Stop'), session_id: 'other' } as HookEvent, 1000);
    board.apply({ ...event('SessionEnd', { reason: 'other' }), session_id: 'third' } as HookEvent, 1000);
    assert.deepEqual(
      board.view().sessions.map((s) => [s.id, s.status]),
      [
        ['other', 'done'],
        [SESSION, 'unknown'],
        ['fourth', 'unknown'],
        ['fifth', 'unknown'],
        ['third', 'ended'],
      ],
    );
    board.apply(event('UserPromptSubmit'), 1100);
    assert.equal(statusOf(board), 'working');
    board.apply({ ...event('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }), session_id: 'fourth' } as HookEvent, 1100);
    assert.equal(statusOf(board, 'fourth'), 'working', "a subagent's event says the session runs");
    board.addPermission('r1', { ...request(), session_id: 'fifth' }, 1100, HOLD);
    assert.equal(statusOf(board, 'fifth'), 'permission');
  });

  test('the snapshot holds what restore needs and nothing else; ended sessions are left out', () => {
    const board = new Board();
    board.apply(event('UserPromptSubmit', { session_title: 'Fix the login', prompt: 'secret prompt' }), 1000);
    board.askUser(request({ questions: [{ question: 'Which contrast level?', options: [] }] }, { tool_name: 'AskUserQuestion' }), 1100);
    board.addPermission('r1', { ...request({ command: 'git push' }), session_id: 'other' }, 1200, HOLD);
    board.apply({ ...event('SessionEnd', { reason: 'other' }), session_id: 'gone' } as HookEvent, 1300);
    const snapshot = board.snapshot();
    assert.deepEqual(snapshot, [
      { id: SESSION, provider: 'claude', cwd: CWD, title: 'Fix the login', project: null, context: null, lastActivity: 1100 },
      { id: 'other', provider: 'claude', cwd: CWD, title: null, project: null, context: null, lastActivity: 1200 },
    ]);
    assert.doesNotMatch(JSON.stringify(snapshot), /secret prompt|contrast|git push/);
    const again = new Board();
    again.restore(snapshot, 2000);
    assert.deepEqual(again.view().sessions.map((s) => [s.id, s.status, s.title]), [
      ['other', 'unknown', null],
      [SESSION, 'unknown', 'Fix the login'],
    ]);
  });

  test('forgotten like any idle session, IDLE_FORGET_MS after its last activity', () => {
    const board = new Board();
    board.restore([saved(SESSION, 1000)], 2000);
    board.sweep(1000 + IDLE_FORGET_MS - 1);
    assert.equal(statusOf(board), 'unknown');
    board.sweep(1000 + IDLE_FORGET_MS);
    assert.equal(statusOf(board), undefined);
  });
});

describe("Codex' command line", () => {
  test('a session that runs in the terminal says so, also on its requests', () => {
    const board = new Board();
    assert.equal(board.setTerminal(SESSION), false, 'no session yet');
    board.addPermission('r1', request(), 1000, HOLD, 'codex');
    assert.deepEqual([board.view().sessions[0]?.terminal, board.view().permissions[0]?.terminal], [false, false]);
    assert.equal(board.setTerminal(SESSION), true);
    assert.equal(board.setTerminal(SESSION), false, 'once');
    assert.deepEqual([board.view().sessions[0]?.terminal, board.view().permissions[0]?.terminal], [true, true]);
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
