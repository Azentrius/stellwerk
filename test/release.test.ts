// The release tools: the notes from CHANGELOG.md and the package, which must be complete, without
// sources or private files, and reproducible byte for byte.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import zlib from 'node:zlib';
import { dosDateTime, writePackage, zip } from '../tools/package.ts';
import { releaseNotes } from '../tools/release-notes.ts';

const ROOT = path.join(import.meta.dirname, '..');
const BUILT = fs.existsSync(path.join(ROOT, 'dist', 'cli.js')) && fs.existsSync(path.join(ROOT, 'dist', 'ui', 'app.js'));

interface Entry {
  name: string;
  data: Buffer;
  time: number;
  date: number;
}

/** Reads a zip archive through its central directory and checks every entry's checksum. */
function readZip(archive: Buffer): Entry[] {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(archive.readUInt32LE(at), 0x02014b50);
    assert.equal(archive.readUInt16LE(at + 8) & 0x0800, 0x0800, 'UTF-8 names');
    const crc = archive.readUInt32LE(at + 16);
    const compressedSize = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
    assert.equal(archive.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(archive.subarray(start, start + compressedSize));
    assert.equal(zlib.crc32(data), crc, `checksum of ${name}`);
    entries.push({ name, data, time: archive.readUInt16LE(at + 12), date: archive.readUInt16LE(at + 14) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe('release notes', () => {
  const changelog = [
    '# Changelog',
    '',
    '## 0.2.0 – not released yet',
    '',
    'Next.',
    '',
    '## 0.1.0 – 2026-10-20',
    '',
    'The first version.',
    '',
    '- One',
    '- Two',
    '',
  ].join('\r\n');

  test('are the section of the version, without the blank lines around it', () => {
    assert.equal(releaseNotes(changelog, '0.1.0'), 'The first version.\n\n- One\n- Two\n');
    assert.equal(releaseNotes(changelog, '0.2.0'), 'Next.\n');
  });

  test('need a dated section for a release, and a section at all', () => {
    assert.equal(releaseNotes(changelog, '0.1.0', { requireDate: true }), 'The first version.\n\n- One\n- Two\n');
    assert.equal(releaseNotes(changelog, '0.2.0', { requireDate: true }), null);
    assert.equal(releaseNotes(changelog, '0.1', {}), null);
    assert.equal(releaseNotes(changelog, '1.0.0'), null);
  });

  test('exist for the version in package.json', () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
    assert.notEqual(releaseNotes(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version), null);
  });
});

describe('zip', () => {
  test('stores names and contents so that they read back unchanged', () => {
    const entries = [
      { name: 'a/b.txt', data: Buffer.from('hello\n') },
      { name: 'a/ä.bin', data: Buffer.from([0, 1, 2, 255]) },
      { name: 'empty', data: Buffer.alloc(0) },
    ];
    const read = readZip(zip(entries, 0));
    assert.deepEqual(read.map((e) => [e.name, e.data]), entries.map((e) => [e.name, e.data]));
  });

  test('uses the given time, never anything earlier than 1980', () => {
    assert.deepEqual(dosDateTime(0), { time: 0, date: (1 << 5) | 1 });
    // 2026-10-20 13:45:30 UTC
    const { time, date } = dosDateTime(Date.UTC(2026, 9, 20, 13, 45, 30) / 1000);
    assert.equal(date, ((2026 - 1980) << 9) | (10 << 5) | 20);
    assert.equal(time, (13 << 11) | (45 << 5) | 15);
  });
});

describe('the package', { skip: BUILT ? false : 'run "npm run build" first' }, () => {
  const epoch = Date.UTC(2026, 9, 20) / 1000;
  const build = () => writePackage({ outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-package-')), epochSeconds: epoch });

  test('is the same, byte for byte, every time it is built', () => {
    const first = build();
    const second = build();
    assert.equal(first.sha256, second.sha256);
    assert.equal(createHash('sha256').update(fs.readFileSync(first.file)).digest('hex'), first.sha256);
    const sums = fs.readFileSync(path.join(path.dirname(first.file), 'SHA256SUMS'), 'utf8');
    assert.equal(sums, `${first.sha256}  ${path.basename(first.file)}\n`);
  });

  test('holds what a user needs, as in the repository, and nothing else', () => {
    const { file } = build();
    const entries = readZip(fs.readFileSync(file));
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
    const prefix = `stellwerk-${version}/`;
    const names = entries.map((e) => e.name);
    assert.ok(names.every((name) => name.startsWith(prefix)), 'one folder');
    const files = names.map((name) => name.slice(prefix.length));
    for (const needed of [
      'package.json',
      'package-lock.json',
      'LICENSE',
      'NOTICE',
      'README.md',
      'CHANGELOG.md',
      'dist/cli.js',
      'dist/hub/hub.js',
      'dist/ui/app.js',
      'ui/index.html',
      'ui/app.css',
      'ui/azentrius.css',
      'ui/OFL.txt',
      'ui/CC-BY-4.0-Font-Awesome.txt',
      'dist/ui/icons.js',
      'ui/static/fonts/RedHatMono/RedHatMonoVF.woff2',
      'ui/static/fonts/RedHatMono/OFL.txt',
    ]) {
      assert.ok(files.includes(needed), `missing ${needed}`);
    }
    for (const file of files) {
      assert.match(file, /^(dist\/|ui\/|[A-Z]+(\.md)?$|package(-lock)?\.json$)/, `not for users: ${file}`);
      assert.doesNotMatch(file, /^ui\/src\/|^ui\/tsconfig\.json$/, `source in the package: ${file}`);
    }
    assert.deepEqual(files, [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), 'sorted');
    for (const entry of entries) {
      assert.deepEqual(entry.data, fs.readFileSync(path.join(ROOT, entry.name.slice(prefix.length))), entry.name);
      assert.deepEqual({ time: entry.time, date: entry.date }, dosDateTime(epoch), `time of ${entry.name}`);
    }
  });
});
