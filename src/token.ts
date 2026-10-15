// The secrets Stellwerk keeps: the token Claude Code sends with every hook request, and (optionally) a
// read-only GitHub token for the list of open pull requests. Both live in files only the current user can
// read, and neither is ever logged.
//
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
/**
 * Only fine-grained personal access tokens: they can be limited to one owner and to reading pull requests
 * and Actions. Classic tokens (ghp_…) carry far more rights and are refused.
 */
const GITHUB_TOKEN_PATTERN = /^github_pat_[A-Za-z0-9_]{22,255}$/;

export function readToken(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(`${file} does not hold a valid token. Delete it and start Stellwerk again.`);
  }
  return token;
}

/** Returns the hook token, creating it on first use. */
export function ensureToken(file: string): { token: string; created: boolean } {
  const existing = readToken(file);
  if (existing) return { token: existing, created: false };
  const token = randomBytes(32).toString('hex');
  try {
    writeSecret(file, token, { onlyIfNew: true });
  } catch (err) {
    // Another process created it in the meantime.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { token: readToken(file)!, created: false };
    throw err;
  }
  return { token, created: true };
}

export function isGitHubToken(value: string): boolean {
  return GITHUB_TOKEN_PATTERN.test(value);
}

export function readGitHubToken(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!isGitHubToken(token)) throw new Error(`${file} does not hold a fine-grained GitHub token. Run "stellwerk github token" again.`);
  return token;
}

export function saveGitHubToken(file: string, token: string): void {
  if (!isGitHubToken(token)) {
    throw new Error('That is not a fine-grained GitHub token (it starts with "github_pat_"). Classic tokens are not accepted.');
  }
  writeSecret(file, token, { onlyIfNew: false });
}

/** Deletes the GitHub token. Returns false if there was none. */
export function removeGitHubToken(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

/**
 * Writes a secret so that it is never readable by others: the file is created empty, restricted to the
 * current user, and only then filled.
 */
function writeSecret(file: string, value: string, { onlyIfNew }: { onlyIfNew: boolean }): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const created = !fs.existsSync(file);
  if (created || onlyIfNew) fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  try {
    restrictToCurrentUser(file);
  } catch (err) {
    if (created) fs.rmSync(file, { force: true });
    throw new Error(`Could not restrict access to ${file}: ${(err as Error).message}`);
  }
  fs.writeFileSync(file, `${value}\n`);
}

/**
 * On Windows the file would inherit the folder's permissions (SYSTEM and Administrators as well), so they
 * are replaced by a single entry for the current user. Fixed program and arguments, no shell. Elsewhere
 * the mode 0600 set when creating it is enough.
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
