// How full a session's context is: the token counts of the last answer of the main agent in its
// transcript, read only under the transcripts folder, and the ring that shows it.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ContextReader,
  DEFAULT_WINDOW,
  LARGE_WINDOW,
  checkedTranscript,
  claudeTitleOfLine,
  contextWindow,
  readContextUsage,
  usageOfLine,
} from '../src/hub/context.ts';
import { contextPercent } from '../ui/src/context.ts';
import { meterTone } from '../ui/src/levels.ts';

const answer = (usage: Record<string, number>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'secret answer' }], usage },
    ...extra,
  });
const prompt = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

function transcripts(): { root: string; file: (name: string, lines: string[]) => string } {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-ctx-')), 'projects');
  fs.mkdirSync(path.join(root, 'C--Projekte-shop-api'), { recursive: true });
  return {
    root,
    file: (name, lines) => {
      const file = path.join(root, 'C--Projekte-shop-api', name);
      fs.writeFileSync(file, `${lines.join('\n')}\n`);
      return file;
    },
  };
}

test('the context is input, cache and output of the last answer of the main agent', () => {
  assert.deepEqual(
    usageOfLine(answer({ input_tokens: 5, cache_read_input_tokens: 580_000, cache_creation_input_tokens: 3_000, output_tokens: 800 })),
    { used: 583_805, model: 'claude-opus-5-5' },
  );
  assert.equal(usageOfLine(answer({ input_tokens: 10 }, { isSidechain: true })), null, 'a subagent has its own context');
  assert.equal(usageOfLine(prompt('my "usage" of the "assistant"')), null);
  assert.equal(usageOfLine('{"type":"assistant","usage" cut off'), null);
  assert.equal(usageOfLine(answer({})), null, 'no counts, no answer');
});

test('it is read from the end of the transcript, also across long lines', async () => {
  const t = transcripts();
  const long = 'x'.repeat(600 * 1024);
  const file = t.file('a.jsonl', [
    answer({ input_tokens: 1, cache_read_input_tokens: 100_000 }),
    prompt(long),
    answer({ input_tokens: 2, cache_read_input_tokens: 200_000, output_tokens: 98 }),
    prompt(long),
    answer({ input_tokens: 1_000 }, { isSidechain: true }),
  ]);
  assert.deepEqual(await readContextUsage(file), { used: 200_100, model: 'claude-opus-5-5' });
  assert.equal(await readContextUsage(t.file('b.jsonl', [prompt('hi')])), null);
});

test('only transcripts in the transcripts folder are read', async () => {
  const t = transcripts();
  const inside = t.file('session.jsonl', [answer({ input_tokens: 1 })]);
  // The native resolution, as the hub uses it: it also expands short 8.3 names such as RUNNER~1.
  assert.equal(await checkedTranscript(inside, t.root), fs.realpathSync.native(inside));
  const outside = path.join(path.dirname(t.root), 'elsewhere.jsonl');
  fs.writeFileSync(outside, answer({ input_tokens: 1 }));
  for (const file of [outside, path.join(t.root, '..', 'elsewhere.jsonl'), path.join(t.root, 'C--Projekte-shop-api', 'notes.txt'), 'relative/session.jsonl']) {
    assert.equal(await checkedTranscript(file, t.root), null, file);
  }
});

test('the window comes from the configuration, the model, or what is in use', () => {
  assert.equal(contextWindow('claude-opus-5-5', 591_500), LARGE_WINDOW, 'Opus 5.5 has 1M, as the app shows');
  assert.equal(contextWindow('claude-sonnet-5-5', 50_000, { 'claude-sonnet-5-5': 400_000 }), 400_000);
  assert.equal(contextWindow('some-model[1m]', 10), LARGE_WINDOW);
  assert.equal(contextWindow(null, 150_000), DEFAULT_WINDOW);
  assert.equal(contextWindow('unknown', 250_000), LARGE_WINDOW, 'more in use than 200k: the large window');
});

test('the reader reports usage for a session at most once per interval, and ignores foreign paths', async () => {
  const t = transcripts();
  const file = t.file('s.jsonl', [answer({ input_tokens: 1, cache_read_input_tokens: 590_000, output_tokens: 1_500 })]);
  const reports: Array<[string, { used: number; size: number }]> = [];
  const log: string[] = [];
  const reader = new ContextReader({ root: t.root, intervalMs: 20, onUsage: (id, usage) => reports.push([id, usage]), log: (l) => log.push(l) });
  for (let i = 0; i < 5; i++) reader.note('s1', file);
  const until = Date.now() + 3000;
  while (reports.length === 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(reports, [['s1', { used: 591_501, size: LARGE_WINDOW }]], 'a burst of events, one read');

  assert.equal(await reader.read('s2', path.join(os.tmpdir(), 'other.jsonl')), null);
  assert.equal(await reader.read('s2', path.join(os.tmpdir(), 'other.jsonl')), null);
  assert.equal(log.length, 1, 'said once');
  reader.stop();
});

test("a session's title is the transcript's latest, for the events that do not carry it", async () => {
  const title = (text: unknown) => JSON.stringify({ type: 'custom-title', customTitle: text, sessionId: 's' });
  assert.equal(claudeTitleOfLine(title(' Radar:\n Java-Version ')), 'Radar: Java-Version');
  assert.equal(claudeTitleOfLine(title(7)), null);
  assert.equal(claudeTitleOfLine(prompt('{"type":"custom-title"}')), null);
  const t = transcripts();
  const file = t.file('s.jsonl', [title('Hibiscus'), prompt('a secret prompt'), answer({ input_tokens: 5 }), title('Hibiscus Registry-Fehler'), prompt('more')]);
  const names: string[] = [];
  const reader = new ContextReader({ root: t.root, onUsage: () => {}, onName: (id, name) => names.push(`${id}: ${name}`) });
  await reader.read('s', file);
  assert.deepEqual(names, ['s: Hibiscus Registry-Fehler']);
  reader.stop();
});

test('the meter shows whole percent, at most 100: grey, attention from 80 %, red from 90 %', () => {
  assert.equal(contextPercent({ used: 591_500, size: 1_000_000 }), 59);
  assert.equal(contextPercent({ used: 2_000_000, size: 1_000_000 }), 100);
  assert.equal(contextPercent(null), null);
  assert.equal(contextPercent({ used: 5, size: 0 }), null);
  assert.deepEqual([null, 0, 79, 80, 89, 90, 97, 100].map(meterTone), ['neutral', 'neutral', 'neutral', 'warning', 'warning', 'danger', 'danger', 'danger']);
});
