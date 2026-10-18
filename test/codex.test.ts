// Codex: its hook events in the board's shape, Stellwerk's entries in its hooks.json, the forwarder that
// passes events to the hub, and what the hub reads from its transcripts.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { CODEX_HOOK_PATH, CODEX_PERMISSION_TIMEOUT_S } from '../src/config.ts';
import { ANSWER_MARGIN_MS, STATUS_TIMEOUT_MS, forwardEvent, timeoutFor } from '../src/codex/hook.ts';
import { parseCodexInput } from '../src/hub/codex-input.ts';
import { ContextReader, codexReviewerOfLine, codexUsageOfLine, plainPath } from '../src/hub/context.ts';
import {
  forwarderCommand,
  isStellwerkCodexHandler,
  stellwerkCodexHooks,
  withStellwerkCodexHooks,
  withoutStellwerkCodexHooks,
} from '../src/setup/codex-settings.ts';

const TRANSCRIPT = 'C:\\Users\\dev\\.codex\\sessions\\2026\\10\\18\\rollout-x.jsonl';

describe('Codex hook events', () => {
  test('come in the shape the board knows; an interrupt ends the turn like Stop', () => {
    const request = parseCodexInput({
      hook_event_name: 'PermissionRequest',
      session_id: 's',
      cwd: 'C:\\p',
      transcript_path: TRANSCRIPT,
      turn_id: 't',
      model: 'gpt-6-astra',
      permission_mode: 'default',
      tool_name: 'Bash',
      tool_input: { command: 'git fetch', description: 'why' },
    });
    assert.ok(request.ok);
    assert.deepEqual(request.event, {
      hook_event_name: 'PermissionRequest',
      session_id: 's',
      cwd: 'C:\\p',
      transcript_path: TRANSCRIPT,
      tool_name: 'Bash',
      tool_input: { command: 'git fetch', description: 'why' },
    });
    assert.equal(request.helper, false);
    const interrupt = parseCodexInput({ hook_event_name: 'Interrupt', session_id: 's', transcript_path: TRANSCRIPT });
    assert.ok(interrupt.ok);
    assert.equal(interrupt.event.hook_event_name, 'Stop');
  });

  test("the app's helper sessions have no transcript; unknown events still count as signs of life", () => {
    for (const transcript of [null, undefined, '']) {
      const parsed = parseCodexInput({ hook_event_name: 'UserPromptSubmit', session_id: 'h', transcript_path: transcript, prompt: 'x' });
      assert.ok(parsed.ok);
      assert.equal(parsed.helper, true, String(transcript));
    }
    const other = parseCodexInput({ hook_event_name: 'PreCompact', session_id: 's', transcript_path: TRANSCRIPT });
    assert.ok(other.ok);
    assert.ok('other' in other.event);
    assert.equal(parseCodexInput({ hook_event_name: 'Stop' }).ok, false, 'no session');
    assert.equal(parseCodexInput({ hook_event_name: 'PermissionRequest', session_id: 's' }).ok, false, 'no tool');
  });
});

describe("Stellwerk's entries in Codex' hooks.json", () => {
  const script = 'C:\\Stellwerk\\dist\\codex\\hook.js';

  test('run the forwarder for each event; the permission request may take the hold time', () => {
    const hooks = stellwerkCodexHooks(script);
    assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SubagentStart', 'SubagentStop', 'SessionEnd']);
    assert.deepEqual(hooks.PermissionRequest, [{ hooks: [{ type: 'command', command: 'node C:\\Stellwerk\\dist\\codex\\hook.js', timeout: CODEX_PERMISSION_TIMEOUT_S }] }]);
    assert.equal((hooks.SessionEnd![0]!.hooks![0] as { timeout: number }).timeout, 3, 'Codex allows at most 3 s');
    assert.equal(forwarderCommand('C:\\Program Files\\Stellwerk\\dist\\codex\\hook.js'), 'node "C:\\Program Files\\Stellwerk\\dist\\codex\\hook.js"');
  });

  test('are added next to foreign hooks and removed exactly, from any folder', () => {
    const foreign = { type: 'command', command: 'python audit.py' };
    const settings = { hooks: { Stop: [{ hooks: [foreign] }] }, other: true };
    const added = withStellwerkCodexHooks(settings, script);
    assert.deepEqual((added.hooks as Record<string, unknown[]>).Stop![0], { hooks: [foreign] });
    assert.equal((added.hooks as Record<string, unknown[]>).Stop!.length, 2);
    assert.deepEqual(withoutStellwerkCodexHooks(added), settings);
    const moved = withStellwerkCodexHooks(settings, 'D:\\elsewhere\\stellwerk\\dist\\codex\\hook.js');
    assert.deepEqual(withoutStellwerkCodexHooks(moved), settings, 'found by its file name');
    assert.deepEqual(withoutStellwerkCodexHooks(withStellwerkCodexHooks({}, script)), {});
    assert.equal(isStellwerkCodexHandler(foreign), false);
    assert.equal(isStellwerkCodexHandler({ type: 'command', command: 'node "C:\\a b\\dist\\codex\\hook.js"' }), true);
  });
});

describe('the forwarder', () => {
  async function fakeHub(answer: (req: http.IncomingMessage, body: string) => { status: number; body?: string; delayMs?: number }) {
    const seen: Array<{ url: string; auth: string | undefined; type: string | undefined; body: string }> = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', auth: req.headers.authorization, type: req.headers['content-type'], body });
        const a = answer(req, body);
        setTimeout(() => {
          res.writeHead(a.status);
          res.end(a.body ?? '');
        }, a.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { port: (server.address() as AddressInfo).port, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  test('posts the event to the Codex endpoint with the token and passes the answer on', async () => {
    const hub = await fakeHub(() => ({ status: 200, body: '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}\n' }));
    const input = '{"hook_event_name":"PermissionRequest","session_id":"s"}';
    const answer = await forwardEvent(input, { port: hub.port, token: 't0k', timeoutMs: 2000 });
    assert.equal(answer, '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}');
    assert.deepEqual(hub.seen, [{ url: CODEX_HOOK_PATH, auth: 'Bearer t0k', type: 'application/json', body: input }]);
    await hub.close();
  });

  test('anything but a 200 in time is no answer, and no hub ends it at once', async () => {
    const refused = await fakeHub(() => ({ status: 401 }));
    assert.equal(await forwardEvent('{}', { port: refused.port, token: 't', timeoutMs: 2000 }), '');
    await refused.close();
    const slow = await fakeHub(() => ({ status: 200, body: 'late', delayMs: 1000 }));
    const started = Date.now();
    assert.equal(await forwardEvent('{}', { port: slow.port, token: 't', timeoutMs: 100 }), '');
    assert.ok(Date.now() - started < 900);
    await slow.close();
    const gone = await fakeHub(() => ({ status: 200 }));
    const port = gone.port;
    await gone.close();
    const at = Date.now();
    assert.equal(await forwardEvent('{}', { port, token: 't', timeoutMs: 5000 }), '');
    assert.ok(Date.now() - at < 2000, 'connection refused, no waiting');
  });

  test('waits the hold time only for a permission request', () => {
    assert.equal(timeoutFor('{"hook_event_name": "PermissionRequest"}', 30), 30_000 + ANSWER_MARGIN_MS);
    assert.equal(timeoutFor('{"hook_event_name":"Stop"}', 30), STATUS_TIMEOUT_MS);
    assert.ok(30 * 1000 + ANSWER_MARGIN_MS < CODEX_PERMISSION_TIMEOUT_S * 1000, 'the forwarder ends before Codex gives up');
  });
});

describe('Codex transcripts', () => {
  const tokenCount = (total: number, window: number) =>
    JSON.stringify({ timestamp: 'x', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1, total_tokens: total }, model_context_window: window }, rate_limits: { primary: { used_percent: 43 } } } });

  test('token_count gives the context with its window; turn_context says who approves', () => {
    assert.deepEqual(codexUsageOfLine(tokenCount(182_031, 258_400)), { used: 182_031, size: 258_400 });
    assert.equal(codexUsageOfLine(tokenCount(10, 0)), null, 'no window');
    assert.equal(codexUsageOfLine('{"type":"response_item","payload":{"type":"message"}}'), null);
    assert.equal(codexReviewerOfLine(JSON.stringify({ type: 'turn_context', payload: { approvals_reviewer: 'auto_review' } })), 'auto_review');
    assert.equal(codexReviewerOfLine('{"type":"event_msg","payload":{"type":"turn_context"}}'), null);
    assert.equal(plainPath('\\\\?\\C:\\Users\\dev\\x.jsonl'), 'C:\\Users\\dev\\x.jsonl');
    assert.equal(plainPath('C:\\x.jsonl'), 'C:\\x.jsonl');
  });

  test('are read only under the Codex folder, with the long-path prefix as the app sends it', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-codex-t-'));
    const codexRoot = path.join(home, 'sessions');
    fs.mkdirSync(path.join(codexRoot, '2026'), { recursive: true });
    const file = path.join(codexRoot, '2026', 'rollout.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ type: 'turn_context', payload: { approvals_reviewer: 'user' } })}\n${tokenCount(100_000, 258_400)}\n`);
    const reports: unknown[] = [];
    const reader = new ContextReader({ root: path.join(home, 'claude'), codexRoot, onUsage: (_, u) => reports.push(u) });
    assert.deepEqual(await reader.read('s', `\\\\?\\${file}`, 'codex'), { used: 100_000, size: 258_400 });
    assert.equal(await reader.codexReviewer(file), 'user');
    assert.equal(await reader.read('s', file, 'claude'), null, 'not a Claude transcript folder');
    const outside = path.join(home, 'rollout.jsonl');
    fs.writeFileSync(outside, tokenCount(1, 2));
    assert.equal(await reader.read('s', outside, 'codex'), null);
    assert.equal(await reader.codexReviewer(outside), null);
    assert.equal(reports.length, 1);
    reader.stop();
  });
});
