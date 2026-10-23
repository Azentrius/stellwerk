// The last decisions: what of a request the display gets, and reading them back from the audit log.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { DecisionView } from '../src/shared/protocol.js';
import { DECISIONS_KEPT, Decisions, decisionOfAuditLine, decisionWhat } from '../src/hub/decisions.ts';
import { pickTexts } from '../ui/src/i18n.ts';
import { DECISIONS_FOR_MS, recentDecisions } from '../ui/src/recent.ts';
import { decisionState } from '../ui/src/states.ts';

const languages = ['en', 'de'].map((lang) => pickTexts([lang]).texts);

test("a decision says what it was about in one short line: the command's first line, the file, the address", () => {
  assert.equal(decisionWhat('Bash', { command: '\n  npm run deploy -- --target staging\necho done', description: 'Deploy' }, null), 'npm run deploy -- --target staging');
  assert.equal(decisionWhat('Edit', { file_path: 'C:\\Projects\\shop\\src\\app.ts', old_string: 'a', new_string: 'b' }, null), 'C:\\Projects\\shop\\src\\app.ts');
  assert.equal(decisionWhat('Write', { file_path: '/tmp/x', content: 'secret' }, null), '/tmp/x');
  assert.equal(decisionWhat('WebFetch', { url: 'https://example.com/a', prompt: 'read' }, null), 'https://example.com/a');
  assert.equal(decisionWhat('mcp__github__create_issue', { title: 'Bug' }, 'github'), 'github');
  assert.equal(decisionWhat('Other', { n: 3, label: 'first text' }, null), 'first text');
  assert.equal(decisionWhat('Other', {}, null), '');
  const long = decisionWhat('Bash', { command: 'x'.repeat(500) }, null);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('…'));
});

test('an audit line gives a decision, without its whole input; anything else gives none', () => {
  const line = JSON.stringify({
    ts: '2026-10-21T20:00:00.000Z',
    request: 'r1',
    session: 's1',
    project: 'shop',
    title: 'Deploy the shop',
    provider: 'codex',
    cwd: 'C:\\Projects\\shop',
    agent: null,
    tool: 'Bash',
    mcpServer: null,
    input: { command: 'npm run deploy', description: 'Deploy' },
    result: 'denied',
    waitedMs: 1200,
  });
  assert.deepEqual(decisionOfAuditLine(line), {
    id: 'r1',
    at: Date.parse('2026-10-21T20:00:00.000Z'),
    outcome: 'denied',
    tool: 'Bash',
    what: 'npm run deploy',
    project: 'shop',
    title: 'Deploy the shop',
    provider: 'codex',
  });
  // Written before the log named title and provider.
  const older = decisionOfAuditLine(JSON.stringify({ ts: '2026-10-20T20:00:00.000Z', request: 'r0', project: 'shop', tool: 'Read', result: 'allowed' }));
  assert.equal(older?.title, null);
  assert.equal(older?.provider, null);
  for (const bad of ['', '{', 'null', '{"ts":"x","request":"r","tool":"Bash","result":"allowed"}', '{"ts":"2026-10-21T20:00:00Z","request":"r","tool":"Bash","result":"maybe"}']) {
    assert.equal(decisionOfAuditLine(bad), null, bad);
  }
});

test('the last ten stay, newest first; at a start they come back from the end of the audit log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-decisions-'));
  try {
    const file = path.join(dir, 'audit.jsonl');
    const lines = Array.from({ length: 14 }, (_, i) =>
      JSON.stringify({ ts: new Date(Date.UTC(2026, 9, 21, 20, i)).toISOString(), request: `r${i}`, project: 'shop', tool: 'Bash', input: { command: `step ${i}` }, result: i % 2 ? 'allowed' : 'denied' }),
    );
    fs.writeFileSync(file, `{"cut in the mid${'\n'}${lines.join('\n')}\nnot json\n`);
    const decisions = new Decisions();
    decisions.load(file);
    const shown = decisions.view();
    assert.equal(shown.length, DECISIONS_KEPT);
    assert.deepEqual(
      shown.map((d) => d.id),
      ['r13', 'r12', 'r11', 'r10', 'r9', 'r8', 'r7', 'r6', 'r5', 'r4'],
    );
    decisions.add({ ...shown[0]!, id: 'new', what: 'later' });
    assert.equal(decisions.view()[0]!.id, 'new');
    assert.equal(decisions.view().length, DECISIONS_KEPT);
    new Decisions().load(path.join(dir, 'missing.jsonl'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('each way a request ends has its word in both languages; allowed is good, denied a stop', () => {
  const [en, de] = languages;
  assert.deepEqual(decisionState('allowed', en!), { tone: 'success', icon: 'check-circle', text: 'Allowed' });
  assert.equal(decisionState('denied', de!).tone, 'danger');
  assert.equal(decisionState('denied', de!).text, 'Abgelehnt');
  for (const outcome of ['allowed', 'denied', 'handed-to-app', 'decided-in-app', 'aborted', 'timed-out'] as const) {
    assert.ok(en!.decided[outcome] && de!.decided[outcome], outcome);
  }
  assert.equal(en!.decisionsTitle(10), 'The last 10 decisions');
  assert.equal(de!.decisionsTitle(1), 'Die letzte Entscheidung');
});

test('the display shows only the decisions of the last day, newest first as the hub gave them', () => {
  const now = Date.parse('2026-10-23T18:00:00Z');
  const at = (hoursAgo: number, id: string) => ({ id, at: now - hoursAgo * 3_600_000 }) as DecisionView;
  const all = [at(0, 'now'), at(23.9, 'yesterday evening'), at(24, 'a day ago'), at(96, 'four days ago')];
  assert.deepEqual(recentDecisions(all, now).map((d) => d.id), ['now', 'yesterday evening']);
  assert.equal(DECISIONS_FOR_MS, 24 * 3_600_000);
  assert.deepEqual(recentDecisions(all, now + 4 * DECISIONS_FOR_MS), [], 'old ones leave, nothing is shown');
});
