// Adding Stellwerk's hooks to Claude Code's settings and removing exactly them again.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TOKEN_ENV,
  formatSettings,
  hookUrl,
  isStellwerkHandler,
  lineDiff,
  stellwerkHooks,
  withStellwerkHooks,
  withoutStellwerkHooks,
} from '../src/setup/claude-settings.ts';

type Group = { matcher?: string; hooks: Array<Record<string, unknown>> };
const groupsOf = (settings: Record<string, unknown>, event: string) => (settings.hooks as Record<string, Group[]>)[event] ?? [];

test("every hook goes to the local hub with the token header, the app's id of the session and its timeout", () => {
  const hooks = stellwerkHooks(4780);
  assert.deepEqual(Object.keys(hooks).sort(), [
    'Elicitation',
    'Notification',
    'PermissionRequest',
    'PostToolUse',
    'PostToolUseFailure',
    'SessionEnd',
    'Stop',
    'SubagentStart',
    'SubagentStop',
    'UserPromptSubmit',
  ]);
  for (const [event, groups] of Object.entries(hooks)) {
    const handler = groups[0]!.hooks![0] as Record<string, unknown>;
    assert.equal(handler.type, 'http', event);
    assert.equal(handler.url, 'http://127.0.0.1:4780/hooks/claude-code', event);
    assert.deepEqual(handler.headers, { Authorization: `Bearer $${TOKEN_ENV}`, 'X-Stellwerk-App-Session': '$CLAUDE_CODE_HOST_SESSION_ID' }, event);
    assert.deepEqual(handler.allowedEnvVars, [TOKEN_ENV, 'CLAUDE_CODE_HOST_SESSION_ID'], event);
    assert.equal(handler.onFailure, undefined, `${event} must not block when the hub is down`);
  }
  const timeout = (event: string) => (hooks[event]![0]!.hooks![0] as Record<string, unknown>).timeout;
  assert.equal(timeout('PermissionRequest'), 90);
  assert.equal(timeout('UserPromptSubmit'), 3);
  assert.equal(timeout('SessionEnd'), 1);
  // Every notification type, so the hub can name the ones it does not show; an MCP server's question is
  // answered at once (empty: the app asks itself).
  assert.equal(hooks.Notification![0]!.matcher, undefined);
  assert.equal(timeout('Notification'), 3);
  assert.equal(timeout('Elicitation'), 3);
});

test('installing keeps everything else and is idempotent', () => {
  const settings = {
    model: 'opus',
    permissions: { allow: ['Bash(git status)'] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] },
  };
  const once = withStellwerkHooks(settings, 4780);
  assert.equal(once.model, 'opus');
  assert.deepEqual(once.permissions, settings.permissions);
  assert.deepEqual(groupsOf(once, 'Stop')[0], settings.hooks.Stop[0]);
  assert.equal(groupsOf(once, 'Stop').length, 2);
  assert.deepEqual(withStellwerkHooks(once, 4780), once);
  // The input is not changed.
  assert.equal(settings.hooks.Stop.length, 1);
});

test('uninstalling removes exactly Stellwerk handlers, also from another port, and leaves foreign ones', () => {
  const foreign = { type: 'http', url: 'http://127.0.0.1:9999/other-tool', timeout: 5 };
  const settings = withStellwerkHooks({ hooks: { Stop: [{ hooks: [foreign] }] } }, 5000);
  // A foreign handler sharing a group with one of ours.
  groupsOf(settings, 'PermissionRequest')[0]!.hooks.push({ type: 'command', command: 'notify.exe' });
  const removed = withoutStellwerkHooks(settings);
  assert.deepEqual(removed, {
    hooks: {
      Stop: [{ hooks: [foreign] }],
      PermissionRequest: [{ hooks: [{ type: 'command', command: 'notify.exe' }] }],
    },
  });
  assert.deepEqual(withoutStellwerkHooks(withStellwerkHooks({}, 4780)), {});
});

test('only URLs of the local hook path count as Stellwerk', () => {
  assert.equal(isStellwerkHandler({ url: hookUrl(4780) }), true);
  assert.equal(isStellwerkHandler({ url: 'http://127.0.0.1:1234/hooks/claude-code' }), true);
  assert.equal(isStellwerkHandler({ url: 'http://localhost:4780/hooks/claude-code' }), false);
  assert.equal(isStellwerkHandler({ url: 'http://127.0.0.1:4780/hooks/claude-code/x' }), false);
  assert.equal(isStellwerkHandler({ url: 'http://127.0.0.12:4780/hooks/claude-code' }), false);
  assert.equal(isStellwerkHandler({ command: 'curl http://127.0.0.1:4780/hooks/claude-code' }), false);
  assert.equal(isStellwerkHandler(null), false);
});

test('the diff shows added and removed lines', () => {
  assert.deepEqual(lineDiff('{\n  "a": 1\n}\n', '{\n  "a": 2\n}\n'), ['  {', '-   "a": 1', '+   "a": 2', '  }']);
  assert.deepEqual(lineDiff('', formatSettings({})), ['+ {}']);
  assert.deepEqual(lineDiff('{}\r\n', '{}\n'), ['  {}']);
});
