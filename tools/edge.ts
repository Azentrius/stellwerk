// A real Edge for the browser checks: headless, with a fresh profile in a folder of the check's own, driven
// over the DevTools protocol. The user's own Edge and its profile stay untouched.
//
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const EDGE = [
  path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].find((file) => fs.existsSync(file));

export interface Edge {
  /** One DevTools command in the tab; rejects with the browser's error. */
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** An expression in the page, its value as JSON; rejects when it throws. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  close(): Promise<void>;
}

export function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks `probe` until it gives a value. A probe that throws (a page still loading) counts as not yet. */
export async function until<T>(what: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 15_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown = null;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() > end) throw new Error(`FAILED: ${what} (timed out${last ? `; last: ${String(last)}` : ''})`);
    await pause(200);
  }
}

/** Starts Edge with its profile in `profile` (a new, empty folder) and connects to its tab. */
export async function openEdge(profile: string): Promise<Edge> {
  if (!EDGE) throw new Error('Edge is not installed.');
  const edge = spawn(EDGE, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', 'about:blank'], {
    stdio: 'ignore',
  });
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    const debugPort = await until('Edge opens its debugging port', async () => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').split('\n')[0]);
    const target = await until('Edge lists its tab', async () => {
      const list = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
      return list.find((t) => t.type === 'page');
    });
    const socket = await connect(target.webSocketDebuggerUrl);
    let nextId = 1;
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = nextId++;
        const onMessage = (data: unknown) => {
          const message = JSON.parse(String(data)) as { id?: number; result?: Record<string, unknown>; error?: unknown };
          if (message.id !== id) return;
          socket.off('message', onMessage);
          if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
          else resolve(message.result ?? {});
        };
        socket.on('message', onMessage);
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const result = (await send('Runtime.evaluate', { expression, returnByValue: true })) as {
        result?: { value?: unknown };
        exceptionDetails?: unknown;
      };
      if (result.exceptionDetails) throw new Error(`In the page: ${JSON.stringify(result.exceptionDetails)}`);
      return result.result?.value as T;
    };
    const close = async () => {
      await send('Browser.close').catch(() => {});
      socket.close();
      edge.kill();
    };
    return { send, evaluate, close };
  } catch (error) {
    edge.kill();
    throw error;
  }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}
