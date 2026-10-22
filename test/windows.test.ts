// Windows itself, read only: Task Scheduler on this machine, in whatever language it answers, tells a task
// that is not there from one it cannot read. Asks for a made-up task; creates and changes nothing.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { taskDefinition, taskExists } from '../src/setup/windows.ts';

test('a task that is not there is null, by Task Scheduler\'s error code', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  assert.equal(taskDefinition(`Stellwerk test ${randomUUID()}`), null);
});

test('a task that is not there does not exist, by the same code; asking changes nothing', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  assert.equal(taskExists(`Stellwerk test ${randomUUID()}`), false);
});
