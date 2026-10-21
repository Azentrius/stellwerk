// `stellwerk update <zip>`: a release you downloaded (the zip and SHA256SUMS next to it), checked against
// SHA256SUMS, unpacked into a folder of its own under %LOCALAPPDATA%\stellwerk\releases, its dependencies
// installed there (npm ci --omit=dev), and the logon tasks pointed at it. Stellwerk downloads nothing
// itself; npm fetches the dependencies, as for any install. The pure parts are here; cli.ts runs the steps.
//
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import path from 'node:path';
import { safeRelativePath, type ZipFile } from './hardware.ts';

const RELEASE_ZIP = /^stellwerk-(\d+\.\d+\.\d+)\.zip$/;

/** The version from the release's file name, as the release workflow names it; anything else is refused. */
export function releaseVersion(fileName: string): string {
  const version = RELEASE_ZIP.exec(fileName)?.[1];
  if (!version) throw new Error(`${fileName} is not a release of Stellwerk (stellwerk-X.Y.Z.zip).`);
  return version;
}

/** The hash SHA256SUMS gives for a file ("<hash>  <name>" or "<hash> *<name>"); null when it has none. */
export function expectedHash(sums: string, fileName: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line.trim());
    if (match && match[2] === fileName) return match[1]!.toLowerCase();
  }
  return null;
}

/** The release is what SHA256SUMS says; throws otherwise. */
export function checkRelease(zip: Buffer, sums: string, fileName: string): void {
  const expected = expectedHash(sums, fileName);
  if (!expected) throw new Error(`SHA256SUMS has no line for ${fileName}.`);
  const actual = createHash('sha256').update(zip).digest('hex');
  if (actual !== expected) throw new Error(`${fileName} is not the one SHA256SUMS names (SHA-256 ${actual}, expected ${expected}).`);
}

/**
 * The release's files, each with its place inside the release's folder: every one must lie in the folder
 * stellwerk-<version>/ of the archive, and no name may leave it.
 */
export function releaseFiles(files: ZipFile[], version: string): Array<{ path: string; data: Buffer }> {
  const top = `stellwerk-${version}/`;
  return files.map((file) => {
    if (!file.name.startsWith(top)) throw new Error(`The archive holds a file outside ${top}: ${JSON.stringify(file.name)}`);
    return { path: safeRelativePath(file.name.slice(top.length)), data: file.data };
  });
}

/** Where a release is unpacked: its own folder, named like the archive's. */
export function releaseDir(releasesDir: string, version: string): string {
  return path.join(releasesDir, `stellwerk-${version}`);
}

/** The release folders among `names` (named as `releaseDir` names them), other than the one of `version`. */
export function previousReleases(names: string[], version: string): string[] {
  return names.filter((name) => /^stellwerk-\d+\.\d+\.\d+$/.test(name) && name !== `stellwerk-${version}`).sort();
}

/** Whether `dir` holds the file or folder `file` (paths compared as Windows does, without regard to case). */
export function isInside(file: string, dir: string): boolean {
  const relative = path.relative(dir.toLowerCase(), file.toLowerCase());
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
