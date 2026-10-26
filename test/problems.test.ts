// Errors on the display say what happened and how to fix it, in both languages, with commands the command
// line knows.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { GitHubView, HardwareView, HubView, UptimeKumaView } from '../src/shared/protocol.js';
import { pickTexts } from '../ui/src/i18n.ts';
import { githubLine, hardwareDueLine, hardwareLine, newReleaseLine, rawLogLine, rejectedLine, splitCode, uptimeKumaLine } from '../ui/src/states.ts';

const ROOT = path.join(import.meta.dirname, '..');
const cli = fs.readFileSync(path.join(ROOT, 'src', 'cli.ts'), 'utf8');
const languages = ['en', 'de'].map((lang) => pickTexts([lang]).texts);
const en = languages[0]!;

function fixes(texts: (typeof languages)[number]): string[] {
  return [
    ...Object.values(texts.github.fix),
    ...Object.values(texts.hardware.fix),
    ...Object.values(texts.uptimeKuma.fix),
    texts.hubDisconnectedFix,
    texts.rawLog.fix,
    ...Object.values(texts.rejected.reasons).map((reason) => texts.rejected.detail('vor 2 min', reason)),
  ];
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
    fix: 'The hub starts it again by itself; if not, run `stellwerk restart`.',
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

test('requests turned away and the raw log are hints to look at the log, as warnings', () => {
  const hub = (rejected: HubView['rejected'], rawLog = false, newRelease: string | null = null): HubView => ({ startedAt: 0, lastEventAt: null, sound: false, quietAfterMs: 0, remindAfterMs: 0, night: null, build: 'x', rejected, rawLog, newRelease });
  const de = languages[1]!;
  assert.equal(rejectedLine(null, 0, en), null);
  assert.equal(rejectedLine(hub(null), 0, en), null);
  const three = hub({ count: 3, lastAt: 1_000, until: 1_000 + 3_600_000, reason: 'token' });
  assert.deepEqual(rejectedLine(three, 121_000, en), {
    tone: 'warning',
    title: '3 requests turned away',
    fix: 'The last one 2 min ago: missing or wrong token. More in `hub.log`.',
  });
  assert.deepEqual(rejectedLine(hub({ count: 1, lastAt: 0, until: 3_600_000, reason: 'foreign' }), 5_000, de), {
    tone: 'warning',
    title: '1 Anfrage abgelehnt',
    fix: 'Zuletzt vor 5 s: eine Anfrage von außerhalb (Host, Herkunft oder Adresse). Mehr in `hub.log`.',
  });
  assert.equal(rejectedLine(three, 1_000 + 3_600_000, en), null, 'gone an hour after the last one');
  assert.equal(rawLogLine(hub(null), en), null);
  assert.deepEqual(rawLogLine(hub(null, true), de)?.title, 'Rohprotokoll ist an');
  assert.equal(rawLogLine(hub(null, true), en)?.tone, 'warning');
});

test('a newer release is a note that says how to set it up, in both languages', () => {
  const hub = (newRelease: string | null): HubView => ({ startedAt: 0, lastEventAt: null, sound: false, quietAfterMs: 0, remindAfterMs: 0, night: null, build: 'x', rejected: null, rawLog: false, newRelease });
  const de = languages[1]!;
  assert.equal(newReleaseLine(null, en), null, 'nothing while the hub is away');
  assert.equal(newReleaseLine(hub(null), en), null);
  assert.deepEqual(newReleaseLine(hub('0.6.0'), en), {
    tone: 'info',
    title: 'Stellwerk 0.6.0 is out',
    fix: 'Download `stellwerk-0.6.0.zip` and `SHA256SUMS` from its release on GitHub, then run `stellwerk update stellwerk-0.6.0.zip`.',
  });
  assert.equal(newReleaseLine(hub('0.6.0'), de)?.title, 'Stellwerk 0.6.0 ist da');
});

test('a due LibreHardwareMonitor is a note that says to run the hardware setup again, in both languages', () => {
  const hub = (hardwareDue: string | null): HubView => ({ startedAt: 0, lastEventAt: null, sound: false, quietAfterMs: 0, remindAfterMs: 0, night: null, build: 'x', rejected: null, rawLog: false, newRelease: null, hardwareDue });
  const de = languages[1]!;
  assert.equal(hardwareDueLine(null, en), null, 'nothing while the hub is away');
  assert.equal(hardwareDueLine(hub(null), en), null);
  assert.deepEqual(hardwareDueLine(hub('0.9.7'), en), { tone: 'info', title: 'LibreHardwareMonitor 0.9.7 is due', fix: 'Run `stellwerk hardware install` again as administrator.' });
  assert.equal(hardwareDueLine(hub('0.9.7'), de)?.title, 'LibreHardwareMonitor 0.9.7 steht an');
});
