// The token Claude Code sends with every hook request. Created once, readable only by the current user,
// never logged.
//
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function readToken(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(`${file} does not hold a valid token. Delete it and start Stellwerk again.`);
  }
  return token;
}

/** Returns the token, creating it on first use. */
export function ensureToken(file: string): { token: string; created: boolean } {
  const existing = readToken(file);
  if (existing) return { token: existing, created: false };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(file, `${token}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    // Another process created it in the meantime.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { token: readToken(file)!, created: false };
    throw err;
  }
  try {
    restrictToCurrentUser(file);
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw new Error(`Could not restrict access to ${file}: ${(err as Error).message}`);
  }
  return { token, created: true };
}

/**
 * On Windows the file would inherit the folder's permissions (SYSTEM and Administrators as well), so they
 * are replaced by a single entry for the current user. Fixed program and arguments, no shell. Elsewhere
 * the mode 0600 set when writing is enough.
 */
function restrictToCurrentUser(file: string): void {
  if (process.platform !== 'win32') return;
  const name = os.userInfo().username;
  const account = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${name}` : name;
  execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${account}:F`], {
    stdio: 'ignore',
    windowsHide: true,
  });
}
