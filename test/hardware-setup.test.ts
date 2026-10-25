// Setting up LibreHardwareMonitor: only the pinned archive passes, unpacking stays inside the target
// folder, the settings Stellwerk needs, the swap of the folder and the logon task.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { taskXml } from '../src/setup/autostart.ts';
import {
  HARDWARE_TASK,
  LHM_ARCHIVE_BYTES,
  LHM_ARCHIVE_SHA256,
  LHM_ARCHIVE_URL,
  checkArchive,
  downloadArchive,
  hardwareTask,
  installFiles,
  lhmSettings,
  removeFiles,
  safeRelativePath,
  unzip,
} from '../src/setup/hardware.ts';
import { zip } from '../tools/package.ts';

const EPOCH = Date.parse('2026-02-14T10:00:00Z') / 1000;

describe('the LibreHardwareMonitor archive', () => {
  test('comes from the official release, pinned by version, size and SHA-256', () => {
    assert.equal(LHM_ARCHIVE_URL, 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip');
    assert.match(LHM_ARCHIVE_SHA256, /^[0-9a-f]{64}$/);
    assert.throws(() => checkArchive(Buffer.alloc(LHM_ARCHIVE_BYTES)), /not the expected file/);
    assert.throws(() => checkArchive(Buffer.from('small')), /not the expected file/);
  });

  test('a download larger than the pinned file is stopped', async () => {
    const fetch = (async () => new Response(new Uint8Array(LHM_ARCHIVE_BYTES + 1))) as typeof globalThis.fetch;
    await assert.rejects(downloadArchive(fetch), /larger than the expected file/);
    const failing = (async () => new Response('', { status: 404 })) as typeof globalThis.fetch;
    await assert.rejects(downloadArchive(failing), /download failed \(404\)/);
  });

  test('unpacks files and folders, skipping folder entries', () => {
    const archive = zip(
      [
        { name: 'LibreHardwareMonitor.exe', data: Buffer.from('program') },
        { name: 'de/', data: Buffer.alloc(0) },
        { name: 'de/Microsoft.Win32.TaskScheduler.resources.dll', data: Buffer.from('resources'.repeat(100)) },
      ],
      EPOCH,
    );
    assert.deepEqual(
      unzip(archive).map((f) => [f.name, f.data.toString()]),
      [
        ['LibreHardwareMonitor.exe', 'program'],
        ['de/Microsoft.Win32.TaskScheduler.resources.dll', 'resources'.repeat(100)],
      ],
    );
  });

  test('a damaged file in the archive is refused', () => {
    const archive = zip([{ name: 'a.dll', data: Buffer.from('content') }], EPOCH);
    const directory = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt32LE((archive.readUInt32LE(directory + 16) ^ 1) >>> 0, directory + 16);
    assert.throws(() => unzip(archive), /damaged/);
    assert.throws(() => unzip(Buffer.from('not a zip archive at all, not at all')), /not a zip archive/);
  });

  test('names that could leave the target folder are refused', () => {
    for (const name of ['../evil.dll', 'de/../../evil.dll', '/abs.dll', 'C:/x.dll', 'C:x.dll', 'a\\b.dll', 'a//b.dll', 'dot./x', 'nul\u0000.dll']) {
      assert.throws(() => safeRelativePath(name), /not allowed/, name);
    }
    assert.equal(safeRelativePath('de/x.dll'), path.join('de', 'x.dll'));
    const evil = zip([{ name: '../evil.dll', data: Buffer.from('x') }], EPOCH);
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-hw-')), 'LibreHardwareMonitor');
    assert.throws(() => installFiles(dir, unzip(evil), ''), /not allowed/);
    assert.ok(!fs.existsSync(path.join(path.dirname(dir), 'evil.dll')));
  });
});

describe('installing LibreHardwareMonitor', () => {
  test("Stellwerk's settings go over the existing ones, which stay", () => {
    const existing = new Map([
      ['theme', 'dark'],
      ['listenerIp', '192.168.1.20'],
      ['authenticationEnabled', 'false'],
      ['runWebServerMenuItem', 'false'],
    ]);
    const settings = lhmSettings(existing, 'f'.repeat(64));
    assert.deepEqual(Object.fromEntries(settings), {
      theme: 'dark',
      listenerIp: '?',
      authenticationEnabled: 'true',
      runWebServerMenuItem: 'true',
      listenerPort: '8085',
      authenticationUserName: 'stellwerk',
      authenticationPassword: 'f'.repeat(64),
      startMinMenuItem: 'true',
      minTrayMenuItem: 'true',
      minCloseMenuItem: 'true',
    });
    assert.equal(existing.get('listenerIp'), '192.168.1.20', 'the map given is not changed');
  });

  test('the folder is swapped as a whole; uninstalling removes it and an empty parent', () => {
    const parent = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-hw-')), 'Stellwerk');
    const dir = path.join(parent, 'LibreHardwareMonitor');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'old-version-only.dll'), 'old');
    installFiles(dir, [{ name: 'LibreHardwareMonitor.exe', data: Buffer.from('new') }, { name: 'de/r.dll', data: Buffer.from('r') }], '<settings/>');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['LibreHardwareMonitor.config', 'LibreHardwareMonitor.exe', 'de']);
    assert.equal(fs.readFileSync(path.join(dir, 'LibreHardwareMonitor.config'), 'utf8'), '<settings/>');
    assert.ok(!fs.existsSync(`${dir}.new`));

    fs.writeFileSync(path.join(parent, 'other'), 'x');
    removeFiles(dir);
    assert.ok(!fs.existsSync(dir));
    assert.ok(fs.existsSync(parent), 'a parent with other files stays');
    fs.rmSync(path.join(parent, 'other'));
    installFiles(dir, [{ name: 'LibreHardwareMonitor.exe', data: Buffer.from('new') }], '');
    removeFiles(dir);
    assert.ok(!fs.existsSync(parent), 'an empty parent goes');
  });

  test('the task starts the program with administrator rights, without arguments, only when the hub runs it', () => {
    const exe = 'C:\\Program Files\\Stellwerk\\LibreHardwareMonitor\\LibreHardwareMonitor.exe';
    const task = hardwareTask({ exe, dir: path.dirname(exe) });
    assert.equal(task.name, HARDWARE_TASK);
    const xml = taskXml(task, 'DEV\\dev');
    assert.match(xml, /<RunLevel>HighestAvailable<\/RunLevel>/);
    assert.match(xml, /<Command>C:\\Program Files\\Stellwerk\\LibreHardwareMonitor\\LibreHardwareMonitor\.exe<\/Command>/);
    assert.doesNotMatch(xml, /<Arguments>/);
    assert.doesNotMatch(xml, /<Triggers>|<LogonTrigger>/, 'not at logon: the hub runs it while it runs');
    assert.match(xml, /<RestartOnFailure>/);
  });
});
