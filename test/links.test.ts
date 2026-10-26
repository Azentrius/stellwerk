// What the display may open: the links the hub builds and the only forms it hands to the Windows shell.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_SESSION, isOpenableLink, monitorLink, pullLink, sessionLink } from '../src/hub/links.ts';

const CODEX = '01a16862-8f6e-75f1-bd2e-ebb5eba616ff';
const APP = 'local_a50b48e9-658d-487b-b484-a0fec652f2bf';

test('a Claude session opens in the desktop app by the id the app gave it; without one, nowhere', () => {
  assert.equal(sessionLink({ id: 'f3c1e9d2-0000-4000-8000-000000000001', provider: 'claude', terminal: false, appSession: APP }), `claude://claude.ai/epitaxy/${APP}`);
  assert.equal(sessionLink({ id: 'f3c1e9d2-0000-4000-8000-000000000001', provider: 'claude', terminal: false, appSession: null }), null, 'Claude Code in a terminal');
  for (const forged of ['local_', 'local_a b', 'local_x/../../evil', 'https://example.com', `${APP}&x=1`, 'local_"x"', `local_${'a'.repeat(65)}`]) {
    assert.equal(APP_SESSION.test(forged), false, forged);
    assert.equal(sessionLink({ id: 's', provider: 'claude', terminal: false, appSession: forged }), null, forged);
  }
});

test("a Codex chat opens in the Codex app by its thread; Codex' command line and odd ids open nothing", () => {
  assert.equal(sessionLink({ id: CODEX, provider: 'codex', terminal: false, appSession: null }), `codex://threads/${CODEX}`);
  assert.equal(sessionLink({ id: CODEX, provider: 'codex', terminal: true, appSession: null }), null, 'runs in a terminal');
  for (const id of ['codex-1', `${CODEX}/x`, CODEX.toUpperCase(), ` ${CODEX}`]) {
    assert.equal(sessionLink({ id, provider: 'codex', terminal: false, appSession: null }), null, id);
  }
  // A Codex session's app id, should one come, counts for nothing.
  assert.equal(sessionLink({ id: 'x', provider: 'codex', terminal: false, appSession: APP }), null);
});

test('a pull request opens on github.com, only with plain names and a number', () => {
  assert.equal(pullLink('Azentrius', 'stellwerk', 57), 'https://github.com/Azentrius/stellwerk/pull/57');
  assert.equal(pullLink('example', 'shop-api.v2_x', 1), 'https://github.com/example/shop-api.v2_x/pull/1');
  assert.equal(pullLink('example', '../evil', 1), null);
  assert.equal(pullLink('example', 'a b', 1), null);
  assert.equal(pullLink('exa/mple', 'shop', 1), null);
  assert.equal(pullLink('example', 'shop', 0), null);
  assert.equal(pullLink('example', 'shop', 1.5), null);
});

test('the shell gets only the three forms, whole', () => {
  for (const link of [`claude://claude.ai/epitaxy/${APP}`, `codex://threads/${CODEX}`, 'https://github.com/Azentrius/stellwerk/pull/57']) {
    assert.equal(isOpenableLink(link), true, link);
  }
  for (const link of [
    'https://github.com/Azentrius/stellwerk/pull/57/files',
    'https://github.com.evil.example/a/b/pull/1',
    'http://github.com/a/b/pull/1',
    `claude://claude.ai/epitaxy/${APP} --x`,
    'claude://code/new?source=x',
    'codex://settings',
    'file:///C:/Windows/System32/calc.exe',
    'calc.exe',
    '',
  ]) {
    assert.equal(isOpenableLink(link), false, link);
  }
});

test("a failing monitor opens its page in Uptime Kuma, at the address set up, only by its numeric id", () => {
  assert.equal(monitorLink('http://192.0.2.10:3001', '7'), 'http://192.0.2.10:3001/dashboard/7');
  assert.equal(monitorLink('https://kuma.example.org', '12'), 'https://kuma.example.org/dashboard/12');
  for (const id of ['0', '07', '-1', '1a', '1/../2', '']) assert.equal(monitorLink('http://192.0.2.10:3001', id), null, id);
  for (const origin of ['ftp://192.0.2.10', 'http://user:pw@192.0.2.10', 'http://192.0.2.10/kuma', 'not a url']) assert.equal(monitorLink(origin, '7'), null, origin);
  assert.equal(isOpenableLink('http://192.0.2.10:3001/dashboard/7'), true);
  assert.equal(isOpenableLink('http://192.0.2.10:3001/dashboard/7?x=1'), false);
  assert.equal(isOpenableLink('javascript:alert(1)//dashboard/7'), false);
});
