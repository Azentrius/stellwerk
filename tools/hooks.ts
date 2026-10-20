// Hook events as the agents' apps send them, for the browser checks: posted to an isolated hub with its
// made-up token.
//
// SPDX-License-Identifier: Apache-2.0

import http from 'node:http';
import { HOOK_PATH } from '../src/config.ts';
import { pause } from './edge.ts';

/** A hook event of `session`; resolves with the hub's answer (for a request: once it is decided). */
export function hook(port: number, token: string, session: string, body: Record<string, unknown>): Promise<string> {
  const payload = JSON.stringify({ session_id: session, cwd: `C:\\Projects\\${session.replace(/-\d+$/, '')}`, ...body });
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: HOOK_PATH,
      agent: false,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    });
    req.on('response', (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve(text));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

/** The hub's answer to a held request, or a failed check when it does not come. */
export function answerOf(reply: Promise<string>, what: string): Promise<string> {
  return Promise.race([reply, pause(10_000).then(() => Promise.reject(new Error(`FAILED: ${what} (no answer)`)))]);
}

/** What the hub decided for a request: 'allow', 'deny', or nothing (back to the app). */
export const behaviorOf = (reply: string) =>
  (JSON.parse(reply || '{}') as { hookSpecificOutput?: { decision?: { behavior?: string } } }).hookSpecificOutput?.decision?.behavior;
