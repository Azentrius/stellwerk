// `stellwerk update`: which file is a release, its check against SHA256SUMS, and where its files go.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { checkRelease, expectedHash, releaseDir, releaseFiles, releaseVersion } from '../src/setup/update.ts';

test('a release is stellwerk-X.Y.Z.zip; anything else is refused', () => {
  assert.equal(releaseVersion('stellwerk-0.5.3.zip'), '0.5.3');
  for (const name of ['stellwerk-0.5.3.tar.gz', 'other-0.5.3.zip', 'stellwerk-latest.zip', 'stellwerk-0.5.3.zip.exe']) {
    assert.throws(() => releaseVersion(name), /not a release/);
  }
});

test('the zip must be what SHA256SUMS names', () => {
  const zip = Buffer.from('the release');
  const hash = createHash('sha256').update(zip).digest('hex');
  const sums = `${'0'.repeat(64)}  stellwerk-0.5.2.zip\n${hash}  stellwerk-0.5.3.zip\n`;
  assert.equal(expectedHash(sums, 'stellwerk-0.5.3.zip'), hash);
  assert.equal(expectedHash(`${hash.toUpperCase()} *stellwerk-0.5.3.zip`, 'stellwerk-0.5.3.zip'), hash, 'binary mark and upper case');
  assert.doesNotThrow(() => checkRelease(zip, sums, 'stellwerk-0.5.3.zip'));
  assert.throws(() => checkRelease(Buffer.from('something else'), sums, 'stellwerk-0.5.3.zip'), /is not the one SHA256SUMS names/);
  assert.throws(() => checkRelease(zip, sums, 'stellwerk-0.5.4.zip'), /has no line for/);
});

test("its files go inside the release's own folder; a name outside it or leaving it is refused", () => {
  const file = (name: string) => ({ name, data: Buffer.from(name) });
  assert.deepEqual(
    releaseFiles([file('stellwerk-0.5.3/package.json'), file('stellwerk-0.5.3/dist/cli.js')], '0.5.3').map((f) => f.path),
    ['package.json', path.join('dist', 'cli.js')],
  );
  assert.throws(() => releaseFiles([file('stellwerk-0.5.2/package.json')], '0.5.3'), /outside stellwerk-0.5.3/);
  assert.throws(() => releaseFiles([file('stellwerk-0.5.3/../evil.js')], '0.5.3'), /not allowed/);
  assert.equal(releaseDir(path.join('C:', 'data', 'releases'), '0.5.3'), path.join('C:', 'data', 'releases', 'stellwerk-0.5.3'));
});
