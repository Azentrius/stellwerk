// The usage of the plans' limits: what the hub takes from Codex' transcripts and from the desktop app's
// usage tool, how it keeps and remembers the newest values, and how the display shows them.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import type { PlanView } from '../src/shared/protocol.js';
import { ContextReader, codexPlanOfLine } from '../src/hub/context.ts';
import { CLAUDE_USAGE_TOOL, PlanBook, claudePlanOfHook } from '../src/hub/plans.ts';
import { pickTexts } from '../ui/src/i18n.ts';
import { meterTone } from '../ui/src/levels.ts';
import { currentLimits, limitName, resetText } from '../ui/src/plans.ts';

const AT = '2026-10-18T03:11:28.392Z';
const tokenCount = (rateLimits: unknown, timestamp: unknown = AT) =>
  JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 1000 }, model_context_window: 258_400 }, rate_limits: rateLimits },
  });
const plan = (used: number, recordedAt: number): PlanView => ({
  provider: 'codex',
  limits: [{ used, windowMinutes: 10_080, resetsAt: null }],
  recordedAt,
});

describe('Codex transcripts', () => {
  test("token_count carries the limits: shortest window first, the reset in milliseconds", () => {
    const line = tokenCount({
      limit_id: 'codex',
      primary: { used_percent: 74, window_minutes: 10_080, resets_at: 1_792_887_346 },
      secondary: { used_percent: 12.5, window_minutes: 300, resets_at: 1_792_300_000 },
      credits: { has_credits: false, balance: '0' },
      plan_type: 'prolite',
    });
    assert.deepEqual(codexPlanOfLine(line), {
      provider: 'codex',
      limits: [
        { used: 12.5, windowMinutes: 300, resetsAt: 1_792_300_000_000 },
        { used: 74, windowMinutes: 10_080, resetsAt: 1_792_887_346_000 },
      ],
      recordedAt: Date.parse(AT),
    });
  });

  test('only limits that make sense count; without one or without a time there is nothing', () => {
    const only = (limit: unknown) => codexPlanOfLine(tokenCount({ primary: limit, secondary: null }))?.limits ?? null;
    assert.deepEqual(only({ used_percent: 130, window_minutes: 300 }), [{ used: 100, windowMinutes: 300, resetsAt: null }]);
    assert.equal(only({ used_percent: 'much', window_minutes: 300 }), null);
    assert.equal(only({ used_percent: 5, window_minutes: 0 }), null);
    assert.equal(only({ used_percent: 5, window_minutes: 1.5 }), null);
    assert.equal(only(null), null);
    assert.equal(codexPlanOfLine(tokenCount(null)), null);
    assert.equal(codexPlanOfLine(tokenCount({ primary: { used_percent: 5, window_minutes: 300 } }, 'yesterday')), null);
    assert.equal(codexPlanOfLine(JSON.stringify({ timestamp: AT, type: 'event_msg', payload: { type: 'agent_message', rate_limits: {} } })), null);
    assert.equal(codexPlanOfLine('{"rate_limits": '), null);
  });

  test('the reader passes the limits on from Codex transcripts only, under their folder', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-plans-'));
    const codexRoot = path.join(home, 'sessions');
    fs.mkdirSync(codexRoot);
    const file = path.join(codexRoot, 'rollout.jsonl');
    const limits = { primary: { used_percent: 74, window_minutes: 10_080, resets_at: 1_792_887_346 } };
    // The newest token_count counts, even if a later one has no limits.
    fs.writeFileSync(file, `${tokenCount({ primary: { used_percent: 10, window_minutes: 10_080 } }, '2026-10-17T00:00:00Z')}\n${tokenCount(limits)}\n${tokenCount(null)}\n`);
    const plans: PlanView[] = [];
    const reader = new ContextReader({ root: path.join(home, 'claude'), codexRoot, onUsage: () => {}, onPlan: (p) => plans.push(p) });
    await reader.read('s', file, 'codex');
    assert.deepEqual(plans.map((p) => p.limits[0]?.used), [74]);
    await reader.read('s', file, 'claude');
    const outside = path.join(home, 'rollout.jsonl');
    fs.writeFileSync(outside, tokenCount(limits));
    await reader.read('s', outside, 'codex');
    assert.equal(plans.length, 1);
    reader.stop();
  });
});

describe("The desktop app's usage tool", () => {
  /** A PostToolUse of get_usage as the hook carries it: the answer as JSON in a text block. */
  const usageHook = (answer: unknown, extra: Record<string, unknown> = {}) => ({
    hook_event_name: 'PostToolUse',
    session_id: 's',
    tool_name: CLAUDE_USAGE_TOOL,
    tool_input: {},
    tool_response: [{ type: 'text', text: JSON.stringify(answer, null, 2) }],
    ...extra,
  });
  const answer = {
    plan: {
      status: 'ok',
      plan: 'Max',
      windows: [
        { label: 'Weekly · all models', percentUsed: 57, resetsAt: '2026-10-21T01:00:00.295Z', resetsIn: '2d 21h' },
        { label: 'Weekly · Fable', percentUsed: 16, resetsAt: '2026-10-21T01:00:00.295Z', resetsIn: '2d 21h' },
        { label: '5-hour limit', percentUsed: 28, resetsAt: '2026-10-18T05:10:00.295Z', resetsIn: '1h 24m' },
      ],
      extraUsage: { enabled: false, currency: 'USD' },
    },
    context: { session: 'self', status: 'ok', tokensUsed: 328_671, contextWindow: 1_000_000, categories: [{ name: 'Messages', tokens: 1 }] },
  };

  test('gives the limits: five hours, the week of all models, the week of one model', () => {
    assert.deepEqual(claudePlanOfHook(usageHook(answer), 1234), {
      provider: 'claude',
      limits: [
        { used: 28, windowMinutes: 300, resetsAt: Date.parse('2026-10-18T05:10:00.295Z') },
        { used: 57, windowMinutes: 10_080, resetsAt: Date.parse('2026-10-21T01:00:00.295Z') },
        { used: 16, windowMinutes: 10_080, resetsAt: Date.parse('2026-10-21T01:00:00.295Z'), model: 'Fable' },
      ],
      recordedAt: 1234,
    });
  });

  test('takes nothing from other tools, failures, unknown windows or an answer without limits', () => {
    assert.equal(claudePlanOfHook(usageHook(answer, { tool_name: 'mcp__other__get_usage' }), 1), null);
    assert.equal(claudePlanOfHook(usageHook(answer, { hook_event_name: 'PostToolUseFailure' }), 1), null);
    assert.equal(claudePlanOfHook(usageHook({ plan: { status: 'not_applicable' } }), 1), null);
    assert.equal(claudePlanOfHook(usageHook({ plan: { status: 'unavailable', note: 'try again' } }), 1), null);
    assert.equal(claudePlanOfHook(usageHook(answer, { tool_response: [{ type: 'text', text: 'Error: no plan' }] }), 1), null);
    assert.equal(claudePlanOfHook(usageHook(answer, { tool_response: undefined }), 1), null);
    const odd = { plan: { status: 'ok', windows: [{ label: 'Extra usage', percentUsed: 5 }, { label: 'Weekly · <b>x</b>', percentUsed: 5 }] } };
    assert.equal(claudePlanOfHook(usageHook(odd), 1), null);
    assert.equal(claudePlanOfHook(null, 1), null);
  });

  test("the answer may also come as the object itself; nothing of the session's context is kept", () => {
    const plan = claudePlanOfHook(usageHook(answer, { tool_response: answer }), 1);
    assert.equal(plan?.limits.length, 3);
    assert.doesNotMatch(JSON.stringify(plan), /Messages|328671|Max/);
  });
});

describe('The plan book', () => {
  test('keeps the newest values per provider', () => {
    const book = new PlanBook(null);
    assert.equal(book.offer(plan(40, 2000)), true);
    assert.equal(book.offer(plan(30, 1000)), false, 'older values, from another transcript');
    assert.equal(book.offer(plan(40, 2000)), false, 'the same values again');
    assert.equal(book.offer(plan(45, 3000)), true);
    assert.deepEqual(book.view(), [plan(45, 3000)]);
  });

  test('remembers them in its file for the next start; a broken file leaves it empty', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-plans-')), 'stellwerk', 'plans.json');
    const book = new PlanBook(file);
    book.load();
    assert.deepEqual(book.view(), [], 'no file yet');
    book.offer(plan(40, 2000));
    book.offer(plan(45, 3000));
    const claude: PlanView = { provider: 'claude', limits: [{ used: 81, windowMinutes: 10_080, resetsAt: 9000, model: 'Fable' }], recordedAt: 5 };
    book.offer(claude);
    await book.flush();
    const next = new PlanBook(file);
    next.load();
    assert.deepEqual(next.view(), [claude, plan(45, 3000)], 'Claude first, then Codex');

    fs.writeFileSync(file, JSON.stringify([{ provider: 'someone', limits: [], recordedAt: 1 }]));
    const lines: string[] = [];
    const broken = new PlanBook(file, (line) => lines.push(line));
    broken.load();
    assert.deepEqual(broken.view(), []);
    assert.equal(lines.length, 1);
  });
});

describe('The display', () => {
  const { texts } = pickTexts(['de']);
  const { texts: en } = pickTexts(['en']);

  test('shows whole percent; a window that started again counts from zero', () => {
    const view: PlanView = {
      provider: 'codex',
      limits: [
        { used: 38.4, windowMinutes: 300, resetsAt: 5000 },
        { used: 84, windowMinutes: 10_080, resetsAt: 9000 },
      ],
      recordedAt: 0,
    };
    assert.deepEqual(currentLimits(view, 6000), [
      { used: 0, windowMinutes: 300, resetsAt: null },
      { used: 84, windowMinutes: 10_080, resetsAt: 9000 },
    ]);
    assert.deepEqual([84, 92].map(meterTone), ['warning', 'danger'], 'attention from 80 %, red from 90 %, as for the context');
  });

  test("a model's own limit shows only once it needs attention, named by the model", () => {
    const view = (fable: number): PlanView => ({
      provider: 'claude',
      limits: [
        { used: 57, windowMinutes: 10_080, resetsAt: null },
        { used: fable, windowMinutes: 10_080, resetsAt: null, model: 'Fable' },
      ],
      recordedAt: 0,
    });
    assert.deepEqual(currentLimits(view(16), 0).map((l) => limitName(l, texts)), ['Woche']);
    assert.deepEqual(currentLimits(view(81), 0).map((l) => limitName(l, texts)), ['Woche', 'Fable']);
  });

  test('names the window and when it starts again: the time within a day, else the weekday', () => {
    assert.deepEqual([300, 10_080, 1440, 2880, 30].map(texts.planWindow), ['5 h', 'Woche', 'Tag', '2 Tage', '30 min']);
    assert.deepEqual([300, 10_080].map(en.planWindow), ['5 h', 'Week']);
    assert.equal(texts.planTitle('Codex'), 'Abo-Nutzung Codex');
    const now = new Date(2026, 9, 18, 5, 0).getTime();
    assert.equal(resetText(new Date(2026, 9, 18, 7, 41).getTime(), now, texts), 'bis 07:41');
    assert.equal(resetText(new Date(2026, 9, 22, 7, 41).getTime(), now, texts), 'bis Do');
    assert.equal(resetText(new Date(2026, 9, 22, 7, 41).getTime(), now, en), 'until Thu');
    assert.equal(resetText(null, now, texts), '');
  });
});
