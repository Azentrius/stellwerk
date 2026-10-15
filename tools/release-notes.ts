// Prints the section of CHANGELOG.md for one version ("## 0.1.0 – 2026-10-20" up to the next "## ").
// With --require-date a section that has no date yet ("not released yet") counts as missing.
// Exits with 1 when there is no such section.
//
// Usage: node tools/release-notes.ts VERSION [--require-date] [CHANGELOG.md]
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';

const HEADING = /^## +\[?([^\]\s]+)\]?(?:\s+[–-]\s+(.*))?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function releaseNotes(changelog: string, version: string, { requireDate = false } = {}): string | null {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => {
    const match = HEADING.exec(line);
    return match?.[1] === version && (!requireDate || DATE.test((match[2] ?? '').trim()));
  });
  if (start < 0) return null;
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  const body = lines.slice(start + 1, next < 0 ? undefined : next);
  while (body.length > 0 && body[0]!.trim() === '') body.shift();
  while (body.length > 0 && body.at(-1)!.trim() === '') body.pop();
  return `${body.join('\n')}\n`;
}

if (import.meta.main) {
  const [version, ...rest] = process.argv.slice(2);
  if (!version) {
    console.error('usage: node tools/release-notes.ts VERSION [--require-date] [CHANGELOG.md]');
    process.exit(2);
  }
  const file = rest.find((arg) => !arg.startsWith('--')) ?? 'CHANGELOG.md';
  const notes = fs.existsSync(file)
    ? releaseNotes(fs.readFileSync(file, 'utf8'), version, { requireDate: rest.includes('--require-date') })
    : null;
  if (notes === null) process.exit(1);
  process.stdout.write(notes);
}
