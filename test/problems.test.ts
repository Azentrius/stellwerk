// Errors on the display say what happened and how to fix it, in both languages, with commands the command
// line knows.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { GitHubView, HardwareView, UptimeKumaView } from '../src/shared/protocol.js';
import { pickTexts } from '../ui/src/i18n.ts';
import { githubLine, hardwareLine, splitCode, uptimeKumaLine } from '../ui/src/states.ts';

const ROOT = path.join(import.meta.dirname, '..');
const cli = fs.readFileSync(path.join(ROOT, 'src', 'cli.ts'), 'utf8');
const languages = ['en', 'de'].map((lang) => pickTexts([lang]).texts);
const en = languages[0]!;

function fixes(texts: (typeof languages)[number]): string[] {
  return [...Object.values(texts.github.fix), ...Object.values(texts.hardware.fix), ...Object.values(texts.uptimeKuma.fix), texts.hubDisconnectedFix];
}

test('every problem has a fix in both languages, as a whole sentence', () => {
  for (const texts of languages) {
    assert.deepEqual(Object.keys(texts.github.fix).sort(), Object.keys(texts.github.problem).sort());
    assert.deepEqual(Object.keys(texts.hardware.fix).sort(), Object.keys(texts.hardware.problem).sort());
    assert.deepEqual(Object.keys(texts.uptimeKuma.fix).sort(), Object.keys(texts.uptimeKuma.problem).sort());
    for (const fix of fixes(texts)) {
      assert.match(fix, /^\p{Lu}.*\.$/u, `a sentence: ${fix}`);
      assert.equal(fix.split('`').length % 2, 1, `backticks in pairs: ${fix}`);
    }
  }
});

test('every command named in a fix is one the command line knows', () => {
  for (const texts of languages) {
    for (const fix of fixes(texts)) {
      for (const part of splitCode(fix).filter((p) => p.code && p.text.startsWith('stellwerk '))) {
        const command = part.text.split(' ').slice(0, 3).join(' ');
        assert.ok(cli.includes(`  ${command}`), `${command} is in the usage`);
      }
    }
  }
});

test('commands stand between backticks', () => {
  assert.deepEqual(splitCode('Run `stellwerk github token` again.'), [
    { text: 'Run ', code: false },
    { text: 'stellwerk github token', code: true },
    { text: ' again.', code: false },
  ]);
  assert.deepEqual(splitCode('No command.'), [{ text: 'No command.', code: false }]);
});

test('the status lines are plain text, or a problem with its fix', () => {
  const github = (problem: GitHubView['problem'], syncedAt: number | null): GitHubView => ({ owner: 'example', syncedAt, problem });
  assert.equal(githubLine(null, 0, en), null);
  assert.equal(githubLine(github(null, null), 0, en), 'GitHub: asking');
  assert.equal(githubLine(github(null, 0), 0, en), 'GitHub: updated just now');
  assert.deepEqual(githubLine(github('rejected', 0), 0, en), {
    title: 'GitHub: token rejected',
    fix: 'Create a new token and run `stellwerk github token`.',
  });
  const hardware = (problem: HardwareView['problem']): HardwareView => ({ values: null, updatedAt: null, problem });
  assert.equal(hardwareLine(null, en), null);
  assert.equal(hardwareLine(hardware(null), en), 'Hardware: asking');
  assert.deepEqual(hardwareLine(hardware('not-running'), en), {
    title: 'Hardware: monitor not running',
    fix: 'Start the task "Stellwerk hardware" or sign in again.',
  });
  const kuma = (problem: UptimeKumaView['problem'], updatedAt: number | null): UptimeKumaView => ({ monitors: null, updatedAt, problem });
  assert.equal(uptimeKumaLine(null, 0, en), null);
  assert.equal(uptimeKumaLine(kuma(null, null), 0, en), 'Uptime Kuma: asking');
  assert.equal(uptimeKumaLine(kuma(null, 0), 20_000, en), 'Uptime Kuma: updated 20 s ago');
  assert.deepEqual(uptimeKumaLine(kuma('rejected', 0), 0, en), {
    title: 'Uptime Kuma: key rejected',
    fix: 'Create a new API key in Uptime Kuma and run `stellwerk kuma key`.',
  });
});
