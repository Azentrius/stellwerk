// Where the display's status lines stand: each source's line at the foot of the column that shows what it
// reports, the status column keeps the hub's own state.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const page = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');

/** The column an element stands in: the last column opened before it. */
function columnOf(id: string): string {
  const at = page.indexOf(`id="${id}"`);
  assert.ok(at >= 0, `#${id} is on the page`);
  const columns = [...page.slice(0, at).matchAll(/class="col (col--[a-z]+)"/g)];
  return columns.at(-1)![1]!;
}

test("GitHub's line stands below the pull requests, Uptime Kuma's below the monitors, the hub's in the status column", () => {
  assert.equal(columnOf('pulls'), 'col--waiting');
  assert.equal(columnOf('github-state'), 'col--waiting');
  assert.ok(page.indexOf('id="github-state"') > page.indexOf('id="waiting-empty"'), 'at the foot of the column');
  assert.equal(columnOf('monitors-state'), 'col--monitors');
  assert.equal(columnOf('hub-state'), 'col--status');
  assert.equal(columnOf('hardware-state'), 'col--status');
  assert.equal(columnOf('rejected-state'), 'col--status');
  assert.equal(columnOf('raw-log-state'), 'col--status');
});

test("in the status column the hub's hints and the gauges share one area below the clock and the hub's state", () => {
  const order = ['clock', 'hub-state', 'last-event', 'status-details', 'rejected-state', 'raw-log-state', 'gauge-sections'].map((id) => page.indexOf(`id="${id}"`));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]!)), 'in this order');
  const area = page.slice(page.lastIndexOf('<div', page.indexOf('id="status-details"')), page.indexOf('class="az-signature"'));
  assert.equal((area.match(/<div/g) ?? []).length - (area.match(/<\/div>/g) ?? []).length, 0, 'the area closes before the signature');
});
