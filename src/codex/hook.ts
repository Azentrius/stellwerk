// Codex runs this for each of its hook events (set up by `stellwerk codex install`; Codex' hooks are
// commands, not HTTP). It passes the event on stdin to the hub on 127.0.0.1 with the hook token from the
// token file and prints the hub's answer, which for a permission request is the decision.
//
// Codex never waits on it longer than it must: without a hub, a token or an answer in time it ends at once,
// prints nothing and exits 0, and Codex goes on as without Stellwerk. It never prints the token.
//
// SPDX-License-Identifier: Apache-2.0

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_HOOK_PATH, HOST, defaultPaths, loadConfig } from '../config.ts';
import { readToken } from '../token.ts';

/** Larger events are not passed on (the hub takes at most 1 MB). */
const MAX_INPUT = 1024 * 1024;
/** Status events: the hub answers at once. */
export const STATUS_TIMEOUT_MS = 3000;
/** A permission request may be held for the hold time; a little more for the way back. */
export const ANSWER_MARGIN_MS = 5000;

/** Posts one event to the hub; the answer's body, or '' for anything but a 200 in time. */
export function forwardEvent(input: string, options: { port: number; token: string; timeoutMs: number }): Promise<string> {
  return new Promise((resolve) => {
    const body = Buffer.from(input, 'utf8');
    const req = http.request({
      host: HOST,
      port: options.port,
      method: 'POST',
      path: CODEX_HOOK_PATH,
      agent: false,
      timeout: options.timeoutMs,
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json', 'Content-Length': body.length },
    });
    const timer = setTimeout(() => req.destroy(), options.timeoutMs);
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        clearTimeout(timer);
        resolve(res.statusCode === 200 ? Buffer.concat(chunks).toString('utf8').trim() : '');
      });
      res.on('error', () => resolve(''));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    req.end(body);
  });
}

/** How long to wait for the hub: the hold time for a permission request, else briefly. */
export function timeoutFor(input: string, holdSeconds: number): number {
  return /"hook_event_name"\s*:\s*"PermissionRequest"/.test(input) ? holdSeconds * 1000 + ANSWER_MARGIN_MS : STATUS_TIMEOUT_MS;
}

async function readStdin(): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > MAX_INPUT) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
}

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    if (input === null || input.trim() === '') return;
    const paths = defaultPaths();
    const token = readToken(paths.tokenFile);
    if (!token) return;
    const config = loadConfig(paths.configFile);
    const answer = await forwardEvent(input, { port: config.port, token, timeoutMs: timeoutFor(input, config.codexHoldSeconds) });
    if (answer) process.stdout.write(answer);
  } catch {
    // Anything wrong: no answer, and Codex goes on by itself.
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().finally(() => process.exit(0));
}
