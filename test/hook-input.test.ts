// Checking the hook data: what is accepted, what is turned away, what is ignored.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOther, parseHookInput } from '../src/hub/hook-input.ts';

const base = { session_id: 'abc', cwd: 'C:\\Projekte\\stellwerk' };

test('fields Stellwerk does not use are ignored, not rejected', () => {
  const result = parseHookInput({
    ...base,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'secret prompt',
    permission_mode: 'default',
    effort: { level: 'xhigh' },
    some_future_field: [1, 2, 3],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.event.hook_event_name, 'UserPromptSubmit');
    assert.equal('prompt' in result.event, false);
  }
});

test('an Elicitation keeps who asks and how, not what is asked', () => {
  const result = parseHookInput({
    ...base,
    hook_event_name: 'Elicitation',
    mcp_server_name: 'Claude_Browser',
    message: 'Allow typing a password on example.com?',
    mode: 'form',
    url: 'https://example.com/login',
    elicitation_id: 'e-1',
    requested_schema: { type: 'object', properties: { allow: { type: 'boolean' } } },
  });
  assert.equal(result.ok, true);
  if (result.ok && !isOther(result.event) && result.event.hook_event_name === 'Elicitation') {
    assert.deepEqual({ ...result.event }, { ...base, hook_event_name: 'Elicitation', mcp_server_name: 'Claude_Browser', mode: 'form' });
  } else {
    assert.fail('parsed as an Elicitation');
  }
});

test('a PermissionRequest keeps its complete tool input, nested values included', () => {
  const toolInput = { file_path: 'C:\\a.txt', content: 'hallo', options: { mode: 'w', lines: [1, 2] } };
  const result = parseHookInput({
    ...base,
    hook_event_name: 'PermissionRequest',
    tool_name: 'Write',
    tool_input: toolInput,
    permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
    mcp_server: { name: 'files', source: 'user' },
  });
  assert.equal(result.ok, true);
  if (result.ok && !isOther(result.event) && result.event.hook_event_name === 'PermissionRequest') {
    assert.deepEqual(result.event.tool_input, toolInput);
    assert.equal(result.event.mcp_server?.name, 'files');
  } else {
    assert.fail('expected a PermissionRequest');
  }
});

test('a PermissionRequest without tool input gets an empty one; without a tool name it is rejected', () => {
  const withoutInput = parseHookInput({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  assert.equal(withoutInput.ok && 'tool_input' in withoutInput.event && JSON.stringify(withoutInput.event.tool_input), '{}');
  assert.equal(parseHookInput({ ...base, hook_event_name: 'PermissionRequest', tool_input: {} }).ok, false);
});

test('without a session id nothing is accepted', () => {
  assert.equal(parseHookInput({ hook_event_name: 'Stop', cwd: 'x' }).ok, false);
  assert.equal(parseHookInput({ hook_event_name: 'Stop', session_id: '' }).ok, false);
});

test('wrong types and non-objects are rejected', () => {
  assert.equal(parseHookInput({ ...base, hook_event_name: 'Notification', notification_type: 42 }).ok, false);
  assert.equal(parseHookInput({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: 'rm -rf /' }).ok, false);
  assert.equal(parseHookInput(null).ok, false);
  assert.equal(parseHookInput('Stop').ok, false);
  assert.equal(parseHookInput([base]).ok, false);
});

test('events Stellwerk does not know still count as a sign of life', () => {
  const result = parseHookInput({ ...base, hook_event_name: 'PreCompact', trigger: 'auto' });
  assert.equal(result.ok, true);
  assert.equal(result.ok && isOther(result.event), true);
});

test('overlong values are rejected', () => {
  assert.equal(parseHookInput({ ...base, hook_event_name: 'Stop', session_id: 'x'.repeat(201) }).ok, false);
  assert.equal(parseHookInput({ ...base, hook_event_name: 'Stop', session_title: 'x'.repeat(1001) }).ok, false);
});
