// The display's states in the design system's language: each kind with its fixed icon, always with a word.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChecksState, SessionStatus } from '../src/shared/protocol.js';
import { pickTexts } from '../ui/src/i18n.ts';
import { elapsed } from '../ui/src/time.ts';
import { ICONS } from '../ui/src/icons.ts';
import { checksState, hubState, sessionState, state, type State } from '../ui/src/states.ts';

const languages = ['en', 'de'].map((lang) => pickTexts([lang]).texts);
const en = languages[0]!;
const STATUSES: SessionStatus[] = ['permission', 'waiting', 'working', 'done', 'ended'];
const CHECKS: ChecksState[] = ['passing', 'failing', 'pending', 'none'];

const FIXED_ICON = {
  success: 'check-circle',
  info: 'info-circle',
  warning: 'exclamation-triangle',
  danger: 'exclamation-circle',
} as const;

function assertSpoken(s: State): void {
  assert.ok(s.text.trim().length > 0, 'every state has a word');
  assert.equal(s.text[0], s.text[0]!.toUpperCase(), `a label starts with a capital: ${s.text}`);
  if (s.tone === 'neutral') {
    assert.ok(s.icon === null || s.icon === 'ban' || s.icon === 'pending', `neutral states go without an icon, with ban or pending: ${s.icon}`);
  } else {
    assert.equal(s.icon, FIXED_ICON[s.tone], `${s.tone} has its fixed icon`);
  }
  if (s.icon) assert.ok(s.icon in ICONS);
}

test('sessions: waiting for approval needs attention, waiting for you is a note, working is good', () => {
  const tones = Object.fromEntries(STATUSES.map((status) => [status, sessionState(status, en).tone]));
  assert.deepEqual(tones, { permission: 'warning', waiting: 'info', working: 'success', done: 'neutral', ended: 'neutral' });
  assert.equal(sessionState('ended', en).icon, 'ban');
  assert.equal(sessionState('done', en).icon, null);
  assert.equal(sessionState('permission', en).text, 'Waiting for approval');
});

test('checks of a pull request: passed is good, failed an error, running and none without judgement', () => {
  const tones = Object.fromEntries(CHECKS.map((checks) => [checks, checksState(checks, en).tone]));
  assert.deepEqual(tones, { passing: 'success', failing: 'danger', pending: 'neutral', none: 'neutral' });
});

test('checks stand as an icon alone in the list: each but "none" has one, and the word stays', () => {
  const icons = Object.fromEntries(CHECKS.map((checks) => [checks, checksState(checks, en).icon]));
  assert.deepEqual(icons, { passing: 'check-circle', failing: 'exclamation-circle', pending: 'pending', none: null });
  for (const texts of languages) {
    for (const checks of CHECKS) assert.ok(checksState(checks, texts).text.length > 0, 'the word becomes the icon\'s name');
  }
});

test('every agent says whose it is, all alike, with a short time', () => {
  for (const texts of languages) assert.deepEqual(texts.providers, { claude: 'Claude', codex: 'Codex' });
  assert.equal(elapsed(500, en), 'now');
  assert.equal(elapsed(12_000, en), '12 s');
  assert.equal(elapsed(4 * 60_000 + 5_000, en), '4 min');
  assert.equal(elapsed(2 * 3_600_000, languages[1]!), '2 h');
  assert.equal(elapsed(0, languages[1]!), 'jetzt');
});

test('the hub: connected is good, disconnected an error that says how to fix it', () => {
  assert.deepEqual(hubState(true, en), { tone: 'success', icon: 'check-circle', text: 'Hub connected' });
  assert.deepEqual(hubState(false, en), {
    title: 'Hub disconnected, reconnecting',
    fix: 'If it does not come back, start the task "Stellwerk hub" and reload the display.',
  });
});

test('every state in both languages has its icon and a word, never colour alone', () => {
  for (const texts of languages) {
    for (const status of STATUSES) assertSpoken(sessionState(status, texts));
    for (const checks of CHECKS) assertSpoken(checksState(checks, texts));
    const connected = hubState(true, texts);
    assert.ok('tone' in connected);
    assertSpoken(connected);
    for (const reason of Object.values(texts.waitingFor)) assertSpoken(state('info', reason));
  }
});
