// Setting up the hardware monitor: LibreHardwareMonitor, exactly the version and archive pinned here, from
// its official release on GitHub. `stellwerk hardware install` (as administrator) downloads the archive,
// checks its size and SHA-256, unpacks it to Program Files, where only administrators can change it (it
// runs with their rights), turns on its web server with a password, and adds a firewall rule and a logon
// task. A new version of LibreHardwareMonitor comes as a pull request that changes version, size and hash.
//
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { LHM_PORT, LHM_SETTINGS_FILE } from '../hub/hardware.ts';
import type { Task } from './autostart.ts';

export const LHM_VERSION = '0.9.6';
export const LHM_ARCHIVE_URL = `https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v${LHM_VERSION}/LibreHardwareMonitor.zip`;
export const LHM_ARCHIVE_BYTES = 6_632_626;
export const LHM_ARCHIVE_SHA256 = '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001';
export const LHM_EXE = 'LibreHardwareMonitor.exe';
export const HARDWARE_TASK = 'Stellwerk hardware';
/** The user name Stellwerk gives LibreHardwareMonitor's web server; the password is new at each install. */
export const LHM_USER = 'stellwerk';
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_FILES = 1000;
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;

/** Downloads the archive; GitHub sends it from its storage host, so redirects are followed. */
export async function downloadArchive(fetchFn: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetchFn(LHM_ARCHIVE_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}). Nothing changed.`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > LHM_ARCHIVE_BYTES) throw new Error('The download is larger than the expected file. Nothing changed.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Only the pinned file passes: same size, same SHA-256. */
export function checkArchive(data: Buffer): void {
  const hash = createHash('sha256').update(data).digest('hex');
  if (data.length !== LHM_ARCHIVE_BYTES || hash !== LHM_ARCHIVE_SHA256) {
    throw new Error(`The download is not the expected file (${data.length} bytes, SHA-256 ${hash}). Nothing changed.`);
  }
}

export interface ZipFile {
  /** With forward slashes, as in the archive. */
  name: string;
  data: Buffer;
}

/** The files of a zip archive (stored or deflated, no encryption, no Zip64), each checked against its CRC. */
export function unzip(archive: Buffer): ZipFile[] {
  const end = findEndOfDirectory(archive);
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  if (count > MAX_FILES) throw new Error('The archive holds too many files.');
  const files: ZipFile[] = [];
  let unpacked = 0;
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error('The archive is damaged.');
    const flags = archive.readUInt16LE(at + 8);
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const packedSize = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const skip = nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + skip;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`${name} in the archive is encrypted.`);
    unpacked += size;
    if (unpacked > MAX_UNPACKED_BYTES) throw new Error('The archive unpacks to too much.');
    if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error('The archive is damaged.');
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const packed = archive.subarray(start, start + packedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(packed);
    else if (method === 8) data = zlib.inflateRawSync(packed, { maxOutputLength: Math.max(size, 1) });
    else throw new Error(`${name} in the archive is packed in an unknown way (${method}).`);
    if (data.length !== size || zlib.crc32(data) !== crc) throw new Error(`${name} in the archive is damaged.`);
    files.push({ name, data });
  }
  return files;
}

function findEndOfDirectory(archive: Buffer): number {
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 22 - 0xffff); at--) {
    if (archive.readUInt32LE(at) === 0x06054b50) return at;
  }
  throw new Error('That is not a zip archive.');
}

/** A path inside the target folder for a name from the archive; anything that could leave it is refused. */
export function safeRelativePath(name: string): string {
  const parts = name.split('/');
  if (
    /[\\:<>|?*"\u0000-\u001f]/.test(name) ||
    parts.some((part) => part === '' || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' '))
  ) {
    throw new Error(`The archive holds a file name that is not allowed: ${JSON.stringify(name)}`);
  }
  return path.join(...parts);
}

/**
 * Stellwerk's settings for LibreHardwareMonitor, over the ones it has: the web server on 8085 on every
 * interface (version 0.9.6 cannot listen on 127.0.0.1 alone; the firewall rule keeps other machines out),
 * a user name and password, and start minimized to the tray, where closing the window keeps it running.
 */
export function lhmSettings(existing: Map<string, string>, password: string): Map<string, string> {
  const settings = new Map(existing);
  const ours: Record<string, string> = {
    runWebServerMenuItem: 'true',
    listenerIp: '?',
    listenerPort: String(LHM_PORT),
    authenticationEnabled: 'true',
    authenticationUserName: LHM_USER,
    authenticationPassword: password,
    startMinMenuItem: 'true',
    minTrayMenuItem: 'true',
    minCloseMenuItem: 'true',
  };
  for (const [key, value] of Object.entries(ours)) settings.set(key, value);
  return settings;
}

/**
 * Puts the files and the settings into a fresh folder next to the target, then swaps it in: the target
 * holds the old version or the new one, never a mix.
 */
export function installFiles(dir: string, files: ZipFile[], settingsXml: string): void {
  const staging = `${dir}.new`;
  fs.rmSync(staging, { recursive: true, force: true });
  for (const file of files) {
    const target = path.join(staging, safeRelativePath(file.name));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.data);
  }
  fs.writeFileSync(path.join(staging, LHM_SETTINGS_FILE), settingsXml);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(staging, dir);
}

/** Removes the folder, and its parent (Program Files\Stellwerk) when nothing else is left in it. */
export function removeFiles(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(`${dir}.new`, { recursive: true, force: true });
  try {
    fs.rmdirSync(path.dirname(dir));
  } catch {
    // Not empty, or already gone.
  }
}

export function hardwareTask(paths: { exe: string; dir: string }): Task {
  return {
    name: HARDWARE_TASK,
    description:
      `Starts LibreHardwareMonitor ${LHM_VERSION}, minimized to the tray, for Stellwerk's hardware values: the ` +
      'Stellwerk hub runs this task when it starts and ends it when it stops. It reads the sensors, so it runs ' +
      'with administrator rights.',
    action: { command: paths.exe, args: [], workingDirectory: paths.dir },
    delaySeconds: 0,
    restartOnFailure: true,
    elevated: true,
    atLogon: false,
  };
}
