// What the display may open with a tap: a session in its app (the Claude desktop app, the Codex app) and a
// pull request in the default browser. The display only names what to open; the hub builds the link itself
// from what it knows, checks it against three fixed forms and hands it to the Windows shell: explorer.exe
// with the link as its only argument, no shell in between. That is the one program the hub starts (chosen
// by Stefan on 2026-10-23: the display's Edge in kiosk mode cannot hand a link to another program).
//
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Provider } from '../shared/protocol.js';

/** A session of the Claude desktop app, as its own links name it (CLAUDE_CODE_HOST_SESSION_ID). */
export const APP_SESSION = /^local_[A-Za-z0-9-]{1,64}$/;
/** A Codex chat: the hook's session_id, which is the thread's id. */
const CODEX_THREAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** An owner's or a repository's name on GitHub. */
const GITHUB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The only links the hub opens, whole. */
const LINKS = [
  /^claude:\/\/claude\.ai\/epitaxy\/local_[A-Za-z0-9-]{1,64}$/,
  /^codex:\/\/threads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/pull\/[1-9][0-9]{0,9}$/,
];

export function isOpenableLink(link: string): boolean {
  return LINKS.some((form) => form.test(link));
}

/**
 * A session's place in its app: a Claude session of the desktop app by the app's own id, a chat of the
 * Codex app by its thread. None for Claude Code in a terminal (no app id) or Codex' command line.
 */
export function sessionLink(session: { id: string; provider: Provider; terminal: boolean; appSession: string | null }): string | null {
  if (session.provider === 'codex') return !session.terminal && CODEX_THREAD.test(session.id) ? `codex://threads/${session.id}` : null;
  return session.appSession !== null && APP_SESSION.test(session.appSession) ? `claude://claude.ai/epitaxy/${session.appSession}` : null;
}

/** A pull request on github.com. */
export function pullLink(owner: string, repo: string, number: number): string | null {
  if (!GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo) || !Number.isInteger(number) || number < 1 || number > 9_999_999_999) return null;
  return `https://github.com/${owner}/${repo}/pull/${number}`;
}

/**
 * Hands a link to the Windows shell, which opens it with the program registered for it (the app, the
 * default browser). Only the three forms above; anything else throws. explorer.exe ends with 1 even when it
 * opened the link, so its end tells nothing: it is not waited for.
 */
export function openWithShell(link: string, log: (line: string) => void): void {
  if (!isOpenableLink(link)) throw new Error('Not a link Stellwerk opens.');
  if (process.platform !== 'win32') throw new Error('Opening links needs Windows.');
  const explorer = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe');
  const child = spawn(explorer, [link], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (err) => log(`Could not open ${link}: ${err.message}`));
  child.unref();
}
