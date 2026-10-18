// The hub: receives Claude Code's hook requests, holds permission requests until the display or the hold
// time decides, and keeps the display current over a WebSocket. It listens on 127.0.0.1 only and starts
// no programs. It asks only api.github.com (with a token set up) and LibreHardwareMonitor on 127.0.0.1
// (when set up). Besides its own files it reads only transcripts named in hook events.
//
// SPDX-License-Identifier: Apache-2.0

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { z } from 'zod';
import type { Decision, DecisionResultMessage, PermissionOutcome, Provider, StateMessage } from '../shared/protocol.js';
import { CODEX_HOOK_PATH, HOOK_PATH, HOST } from '../config.ts';
import { AuditLog } from './audit.ts';
import { Board, QUESTION_TOOLS, projectName, type Permission } from './board.ts';
import { parseCodexInput } from './codex-input.ts';
import { ContextReader } from './context.ts';
import { GitHubWatcher } from './github.ts';
import { HardwareWatcher } from './hardware.ts';
import { isOther, parseHookInput, type HookEvent, type PermissionRequestEvent } from './hook-input.ts';
import { PlanBook } from './plans.ts';
import { displayBuild, loadIndexTemplate, loadStaticFiles, renderIndex } from './static-files.ts';

export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_OPEN_PERMISSIONS = 20;
export const DENY_MESSAGE = 'Denied via Stellwerk';
export const WS_PATH = '/ws';
export const WS_PROTOCOL = 'stellwerk.v1';
/** The display proves it was served by this hub with a second subprotocol: this prefix plus the page's token. */
export const WS_SESSION_PREFIX = 'stellwerk.session.';
const MAX_WS_MESSAGE_BYTES = 4096;
const SWEEP_INTERVAL_MS = 1000;
const BROADCAST_DELAY_MS = 50;
/** A repeated rejection for the same reason is logged at most this often. */
export const REJECTION_LOG_INTERVAL_MS = 60_000;

export interface HubOptions {
  /** 0 picks a free port (tests). */
  port: number;
  /** Claude Code sends it as `Authorization: Bearer <token>`. */
  token: string;
  holdMs: number;
  /**
   * Hold time for Codex requests; shorter, since the Codex app shows its own card only after the hook.
   * Defaults to holdMs.
   */
  codexHoldMs?: number;
  scale: number;
  /** Stellwerk's version, named in the display's signature. */
  version: string;
  sound: boolean;
  auditFile: string;
  /** ui/: index.html, styles, fonts. */
  uiRoot: string;
  /** dist/ui/: the compiled display modules. */
  webRoot: string;
  /** Debug: every hook body goes into this file (it holds prompts and code). */
  rawLogFile?: string | null;
  /** Debug: status hooks are never answered, as if the hub hung. */
  simulateHang?: boolean;
  /** Open pull requests from GitHub; the only outgoing connection, and only with a token. */
  github?: { owner: string; token: string; intervalMs: number; fetch?: typeof fetch } | null;
  /** Hardware values from LibreHardwareMonitor on 127.0.0.1, with the password from its settings file. */
  hardware?: { settingsFile: string; intervalMs: number; fetch?: typeof fetch } | null;
  /**
   * How full each session's context is: the token counts of the last answer in its transcript, read only
   * under `root` (~/.claude/projects). Windows by model from the configuration.
   */
  context?: { root: string; codexRoot?: string | null; windows?: Record<string, number>; intervalMs?: number } | null;
  /** Where the hub remembers the usage of the plans' limits between runs; without it, in memory only. */
  plansFile?: string | null;
  now?: () => number;
  log?: (line: string) => void;
}

export interface Hub {
  readonly port: number;
  readonly board: Board;
  /** True when dist/ui is missing, i.e. `npm run build` has not run. */
  readonly missingBuild: boolean;
  close(): Promise<void>;
}

const decideMessage = z.object({
  type: z.literal('decide'),
  id: z.string().max(100),
  decision: z.enum(['allow', 'deny', 'app']),
});

interface Held {
  res: http.ServerResponse;
  timer: NodeJS.Timeout;
}

export async function startHub(options: HubOptions): Promise<Hub> {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));
  const board = new Board();
  const audit = new AuditLog(options.auditFile);
  const held = new Map<string, Held>();
  const startedAt = now();
  const expectedAuthorization = Buffer.from(`Bearer ${options.token}`);
  // Derived from the hook token (which it does not reveal), so an open display reconnects after a restart.
  const sessionToken = createHmac('sha256', options.token).update('stellwerk display session').digest('hex');
  const { files, missingBuild } = loadStaticFiles(options.uiRoot, options.webRoot);
  // The version is part of the page, so a new version alone also gives a new build.
  const template = renderIndex(loadIndexTemplate(options.uiRoot), { version: options.version });
  // An open display reloads itself when this differs from the build it was served with.
  const build = displayBuild(template, files);
  const index = Buffer.from(renderIndex(template, { session: sessionToken, scale: String(options.scale), build }));
  let port = options.port;
  let broadcastTimer: NodeJS.Timeout | null = null;
  let closing = false;
  const rejections = new Map<string, { loggedAt: number; repeats: number }>();

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: Error) => {
      log(`Error: ${err.message}`);
      if (!res.headersSent) send(res, 500);
      else res.destroy();
    });
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_MESSAGE_BYTES,
    perMessageDeflate: false,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
  });
  server.on('upgrade', onUpgrade);
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify(stateMessage()));
    ws.on('message', (data, isBinary) => onMessage(ws, data, isBinary));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  const sweepTimer = setInterval(() => {
    if (board.sweep(now())) scheduleBroadcast();
  }, SWEEP_INTERVAL_MS);
  const github = options.github
    ? new GitHubWatcher({ ...options.github, now, onChange: () => scheduleBroadcast(), log })
    : null;
  github?.start();
  const hardware = options.hardware
    ? new HardwareWatcher({ ...options.hardware, now, onChange: () => scheduleBroadcast(), log })
    : null;
  hardware?.start();
  const plans = new PlanBook(options.plansFile ?? null, log);
  plans.load();
  const context = options.context
    ? new ContextReader({
        ...options.context,
        log,
        onUsage: (sessionId, usage) => {
          if (board.setContext(sessionId, usage)) scheduleBroadcast();
        },
        onPlan: (plan) => {
          if (plans.offer(plan)) scheduleBroadcast();
        },
      })
    : null;

  // ---------- HTTP ----------

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    setSecurityHeaders(res);
    // Only our own name: a page that points its domain at 127.0.0.1 (DNS rebinding) is turned away.
    if (!allowedHost(req.headers.host)) {
      reject('foreign host', `request with the Host header ${quote(req.headers.host)} (403)`);
      return send(res, 403);
    }
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname === HOOK_PATH || pathname === CODEX_HOOK_PATH) {
      if (req.method !== 'POST') {
        reject('hook method', `${quote(req.method)} request to the hook endpoint (405)`);
        return send(res, 405);
      }
      return onHook(req, res, pathname === CODEX_HOOK_PATH ? 'codex' : 'claude');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405);
    if (pathname === '/' || pathname === '/index.html') return send(res, 200, index, 'text/html; charset=utf-8');
    const file = files.get(pathname);
    if (file) return send(res, 200, file.body, file.type);
    send(res, 404);
  }

  async function onHook(req: http.IncomingMessage, res: http.ServerResponse, provider: Provider): Promise<void> {
    const authorization = req.headers.authorization ?? '';
    // An unset STELLWERK_TOKEN arrives as "Bearer " with nothing after it.
    if (authorization.replace(/^Bearer\b/i, '').trim() === '') {
      reject(
        provider === 'codex' ? 'no token (codex)' : 'no token',
        provider === 'codex'
          ? 'Codex hook request without a token (401). Is the token file there? Run "stellwerk serve" once.'
          : 'hook request without a token (401). Run "stellwerk hooks install" and restart the Claude app, ' +
              'so that it has STELLWERK_TOKEN.',
      );
      return send(res, 401);
    }
    if (!authorized(authorization)) {
      reject(
        provider === 'codex' ? 'wrong token (codex)' : 'wrong token',
        provider === 'codex'
          ? 'Codex hook request with a wrong token (401). The forwarder reads the token file; restart the hub.'
          : 'hook request with a wrong token (401). If the token file was renewed, run "stellwerk hooks install" ' +
              'again and restart the Claude app.',
      );
      return send(res, 401);
    }
    // application/json makes a browser ask first (CORS preflight), which the hub never answers: no web page
    // can post events here.
    if (!isJson(req.headers['content-type'])) {
      reject('content type', `hook request with the content type ${quote(req.headers['content-type'])} (415)`);
      return send(res, 415);
    }
    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) {
      reject('too large', `hook request larger than ${MAX_BODY_BYTES / 1024 / 1024} MB (413)`);
      return send(res, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      reject('json', 'hook request that is not valid JSON (400)');
      return send(res, 400);
    }
    if (options.rawLogFile) appendRawLog(options.rawLogFile, body);
    let event: HookEvent;
    if (provider === 'codex') {
      const parsed = parseCodexInput(body);
      if (!parsed.ok) {
        reject('codex input', `Codex hook data without the expected fields (400): ${parsed.error.replace(/\s*\n\s*/g, '; ')}`);
        return send(res, 400);
      }
      // The app's helper sessions (no transcript) are no agents.
      if (parsed.helper) return send(res, 200);
      event = parsed.event;
    } else {
      const parsed = parseHookInput(body);
      if (!parsed.ok) {
        reject('hook input', `hook data without the expected fields (400): ${parsed.error.replace(/\s*\n\s*/g, '; ')}`);
        return send(res, 400);
      }
      event = parsed.event;
    }
    // How full the session's context is: read from its transcript a little later, outside this request.
    context?.note(event.session_id, event.transcript_path, provider);
    if (!isOther(event) && event.hook_event_name === 'PermissionRequest') return holdPermission(event, res, provider);

    for (const { permission, outcome } of board.apply(event, now(), provider)) closeOut(permission, outcome);
    scheduleBroadcast();
    if (options.simulateHang) return; // Claude Code gives up after the hook's timeout
    send(res, 200);
  }

  function holdPermission(event: PermissionRequestEvent, res: http.ServerResponse, provider: Provider): void {
    if (provider === 'claude' && QUESTION_TOOLS.has(event.tool_name)) {
      // A question, not a permission: straight back to the app, which asks the user.
      board.askUser(event, now());
      scheduleBroadcast();
      return send(res, 200);
    }
    if (provider === 'codex') {
      // The Codex app waits for this hook before it shows anything. With "approve for me" its own reviewer
      // decides and nobody looks at a card, so the request goes straight back.
      void (context?.codexReviewer(event.transcript_path ?? null) ?? Promise.resolve(null)).then((reviewer) => {
        if (res.writableEnded || res.destroyed) return;
        if (reviewer === 'auto_review') {
          board.touch(event, now(), 'codex');
          scheduleBroadcast();
          return send(res, 200);
        }
        hold(event, res, provider, options.codexHoldMs ?? options.holdMs);
      });
      return;
    }
    hold(event, res, provider, options.holdMs);
  }

  function hold(event: PermissionRequestEvent, res: http.ServerResponse, provider: Provider, holdMs: number): void {
    const at = now();
    const tooMany = board.pendingCount() >= MAX_OPEN_PERMISSIONS;
    const id = randomUUID();
    board.addPermission(id, event, at, holdMs, provider);
    const timer = setTimeout(() => finish(id, 'timed-out'), holdMs);
    held.set(id, { res, timer });
    res.on('close', () => {
      // Closed before an answer: the request was answered in the app (allowed, rejected or cancelled with
      // Esc). The hub cannot tell which; the app knows.
      const entry = held.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      held.delete(id);
      const closedAt = now();
      if (board.settle(id, 'decided-in-app', closedAt)) report(board.permissions.get(id)!, 'decided-in-app', closedAt);
      scheduleBroadcast();
    });
    if (tooMany) finish(id, 'handed-to-app', 'too many open requests');
    else scheduleBroadcast();
  }

  /** Settles a held request, answers Claude Code and records it. */
  function finish(id: string, outcome: PermissionOutcome, note?: string): boolean {
    const at = now();
    if (!board.settle(id, outcome, at)) return false;
    report(board.permissions.get(id)!, outcome, at, note);
    release(id, outcome === 'allowed' ? 'allow' : outcome === 'denied' ? 'deny' : null);
    scheduleBroadcast();
    return true;
  }

  /** For requests the board settled on its own (decided in the app, session ended). */
  function closeOut(permission: Permission, outcome: PermissionOutcome): void {
    report(permission, outcome, permission.resolvedAt ?? now());
    release(permission.id, null);
  }

  /** Answers a held request: a decision, or an empty body that leaves it to the app. */
  function release(id: string, decision: 'allow' | 'deny' | null): void {
    const entry = held.get(id);
    if (!entry) return;
    held.delete(id);
    clearTimeout(entry.timer);
    if (entry.res.writableEnded || entry.res.destroyed) return;
    if (!decision) return send(entry.res, 200);
    const body = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: DENY_MESSAGE },
      },
    });
    send(entry.res, 200, body, 'application/json');
  }

  function report(permission: Permission, outcome: PermissionOutcome, at: number, note?: string): void {
    const cwd = board.sessions.get(permission.sessionId)?.cwd ?? '';
    audit.write({ permission, cwd, outcome, at, ...(note ? { note } : {}) });
    log(`${clockTime(at)}  ${projectName(cwd) || permission.sessionId.slice(0, 8)} · ${permission.tool}  ${outcome}`);
  }

  /**
   * Tells the console why a request was turned away, so a missing token or a wrong address shows up.
   * Never with the token. The same reason at most once a minute, with the number of repeats since.
   */
  function reject(key: string, message: string): void {
    const at = now();
    const last = rejections.get(key);
    if (last && at - last.loggedAt < REJECTION_LOG_INTERVAL_MS) {
      last.repeats++;
      return;
    }
    const repeats = last?.repeats ? ` (${last.repeats} more since the last message)` : '';
    rejections.set(key, { loggedAt: at, repeats: 0 });
    log(`${clockTime(at)}  Rejected ${message}${repeats}`);
  }

  // ---------- WebSocket ----------

  function onUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const refuse = (status: number, key: string, message: string) => {
      reject(key, `${message} (${status})`);
      socket.write(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!allowedHost(req.headers.host)) {
      return refuse(403, 'foreign host', `display connection with the Host header ${quote(req.headers.host)}`);
    }
    if (!allowedOrigin(req.headers.origin)) {
      return refuse(403, 'foreign origin', `display connection from the origin ${quote(req.headers.origin)}`);
    }
    if (pathname !== WS_PATH) return refuse(404, 'display path', 'display connection to an unknown path');
    if (!hasSessionToken(req.headers['sec-websocket-protocol'])) {
      return refuse(403, 'page token', 'display connection without the right page token; reload the display');
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }

  function onMessage(ws: WebSocket, data: RawData, isBinary: boolean): void {
    if (isBinary) return;
    let message: z.infer<typeof decideMessage>;
    try {
      message = decideMessage.parse(JSON.parse(String(data)));
    } catch {
      return;
    }
    ws.send(JSON.stringify(decide(message.id, message.decision)));
  }

  /** The first decision counts; any later one, from this display or another, gets "already decided". */
  function decide(id: string, decision: Decision): DecisionResultMessage {
    if (!held.has(id)) {
      return { type: 'decision-result', id, ok: false, reason: board.permissions.has(id) ? 'already-decided' : 'unknown' };
    }
    finish(id, decision === 'allow' ? 'allowed' : decision === 'deny' ? 'denied' : 'handed-to-app');
    return { type: 'decision-result', id, ok: true };
  }

  function stateMessage(): StateMessage {
    return {
      type: 'state',
      now: now(),
      ...board.view(),
      pullRequests: github?.pullRequests ?? [],
      hub: { startedAt, lastEventAt: board.lastEventAt, sound: options.sound, build },
      github: github?.view() ?? null,
      hardware: hardware?.view() ?? null,
      plans: plans.view(),
    };
  }

  function scheduleBroadcast(): void {
    if (broadcastTimer || closing) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      const message = JSON.stringify(stateMessage());
      for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(message);
    }, BROADCAST_DELAY_MS);
  }

  // ---------- checks and helpers ----------

  function allowedHost(host: string | undefined): boolean {
    return host === `${HOST}:${port}` || host === `localhost:${port}`;
  }

  function allowedOrigin(origin: string | undefined): boolean {
    return origin === `http://${HOST}:${port}` || origin === `http://localhost:${port}`;
  }

  function authorized(header: string | undefined): boolean {
    if (!header) return false;
    const given = Buffer.from(header);
    return given.length === expectedAuthorization.length && timingSafeEqual(given, expectedAuthorization);
  }

  function hasSessionToken(header: string | undefined): boolean {
    if (!header) return false;
    const expected = Buffer.from(WS_SESSION_PREFIX + sessionToken);
    return header
      .split(',')
      .map((value) => Buffer.from(value.trim()))
      .some((given) => given.length === expected.length && timingSafeEqual(given, expected));
  }

  function setSecurityHeaders(res: http.ServerResponse): void {
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; ` +
        `connect-src ws://${HOST}:${port} ws://localhost:${port}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
  }

  function appendRawLog(file: string, body: unknown): void {
    const line = `${JSON.stringify({ ts: new Date().toISOString(), body })}\n`;
    fs.appendFile(file, line, { encoding: 'utf8', mode: 0o600 }, (err) => {
      if (err) log(`Raw log: ${err.message}`);
    });
  }

  return {
    get port() {
      return port;
    },
    board,
    missingBuild,
    async close() {
      closing = true;
      clearInterval(sweepTimer);
      github?.stop();
      hardware?.stop();
      context?.stop();
      if (broadcastTimer) clearTimeout(broadcastTimer);
      // Whatever is still held goes back to the app's own card.
      for (const id of [...held.keys()]) finish(id, 'handed-to-app', 'hub stopped');
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await Promise.all([audit.flush(), plans.flush()]);
    },
  };
}

function send(res: http.ServerResponse, status: number, body?: Buffer | string, type?: string): void {
  const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { ...(type ? { 'Content-Type': type } : {}), 'Content-Length': payload?.length ?? 0 });
  res.end(payload);
}

function clockTime(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}

/** A header value for the console: quoted, shortened, control characters escaped. */
function quote(value: string | undefined): string {
  return value === undefined ? '(none)' : JSON.stringify(value.length > 100 ? `${value.slice(0, 100)}…` : value);
}

function isJson(contentType: string | undefined): boolean {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase() === 'application/json';
}

/** The body, or null if it is larger than the limit (it is read to the end but not kept). */
function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = Number(req.headers['content-length'] ?? 0) > limit;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks)));
    req.on('close', () => resolve(null));
    req.on('error', reject);
  });
}
