// When an open display loads itself again: only for a hub serving another build, once per build.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldReload } from '../ui/src/reload.ts';

const OLD = '0123456789abcdef';
const NEW = 'fedcba9876543210';

test('a page reloads when the hub serves another build', () => {
  assert.equal(shouldReload(OLD, NEW, null), true);
  assert.equal(shouldReload(OLD, OLD, null), false, 'same build');
});

test('a reload is tried once per build, so an old page cannot reload forever', () => {
  assert.equal(shouldReload(OLD, NEW, NEW), false);
  assert.equal(shouldReload(OLD, NEW, 'aaaaaaaaaaaaaaaa'), true, 'a reload for an earlier build does not count');
});

test('without a known build on both sides nothing reloads', () => {
  assert.equal(shouldReload('', NEW, null), false);
  assert.equal(shouldReload('{{build}}', NEW, null), false, 'a page not served by the hub');
  assert.equal(shouldReload(OLD, '', null), false);
});
