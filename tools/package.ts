// Builds the release package: stellwerk-VERSION.zip with what a user needs to run Stellwerk (the built hub
// and display, the display's files and fonts, package.json and the lockfile, license texts, README,
// changelog) and SHA256SUMS. Reproducible: fixed order, fixed time stamps (SOURCE_DATE_EPOCH, otherwise
// 1980-01-01) and the LF line endings git checks out.
//
// Usage: npm run build && node tools/package.ts [--out build]
//
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';

const ROOT = path.join(import.meta.dirname, '..');
const FILES = ['package.json', 'package-lock.json', 'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md'];
const DIRS = ['dist', 'ui'];
/** The display's sources; the package carries them built, in dist/ui. */
const LEFT_OUT = [/^ui\/src\//, /^ui\/tsconfig\.json$/];
const REQUIRED = ['dist/cli.js', 'dist/ui/app.js'];
/** 1980-01-01, the earliest time a zip file can hold. */
const DOS_EPOCH_S = 315_532_800;

/** The files of the package, relative to the root with forward slashes, sorted. */
export function packageFiles(root = ROOT): string[] {
  for (const file of REQUIRED) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`${file} is missing. Run "npm run build" first.`);
  }
  const files = [...FILES];
  for (const dir of DIRS) files.push(...walk(root, dir));
  return files.filter((file) => !LEFT_OUT.some((pattern) => pattern.test(file))).sort(byBytes);
}

function walk(root: string, dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(root, relative) : entry.isFile() ? [relative] : [];
  });
}

function byBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** A zip archive (deflate, UTF-8 names, no extra fields) whose bytes depend only on the entries and the time. */
export function zip(entries: ZipEntry[], epochSeconds: number): Buffer {
  const { time, date } = dosDateTime(epochSeconds);
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const crc = zlib.crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by: 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directorySize = directory.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}

/** MS-DOS date and time (UTC, two-second steps), as zip stores them. */
export function dosDateTime(epochSeconds: number): { time: number; date: number } {
  const d = new Date(Math.max(epochSeconds, DOS_EPOCH_S) * 1000);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export interface PackageResult {
  file: string;
  sha256: string;
  names: string[];
}

/** Writes stellwerk-VERSION.zip and SHA256SUMS into outDir. */
export function writePackage({ root = ROOT, outDir, epochSeconds }: { root?: string; outDir: string; epochSeconds: number }): PackageResult {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  const base = `stellwerk-${version}`;
  const entries = packageFiles(root).map((file) => ({ name: `${base}/${file}`, data: fs.readFileSync(path.join(root, file)) }));
  const archive = zip(entries, epochSeconds);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${base}.zip`);
  fs.writeFileSync(file, archive);
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), `${sha256}  ${base}.zip\n`);
  return { file, sha256, names: entries.map((entry) => entry.name) };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string', default: path.join(ROOT, 'build') } } });
  const epoch = process.env.SOURCE_DATE_EPOCH ? Number(process.env.SOURCE_DATE_EPOCH) : DOS_EPOCH_S;
  if (!Number.isInteger(epoch)) throw new Error('SOURCE_DATE_EPOCH must be whole seconds.');
  const result = writePackage({ outDir: values.out, epochSeconds: epoch });
  console.log(`${result.file} (${result.names.length} files)`);
  console.log(`SHA-256 ${result.sha256}`);
}
