// How full a session's context is. Every hook event names the session's transcript, and the hub reads the
// latest token counts from its end:
//
// - Claude Code (~/.claude/projects): the last answer of the main agent carries its usage (input with cache,
//   and output), which together is what the context holds now. The window is not in the data; it comes
//   from the model. The desktop app also writes the session's title into it (custom-title), which not
//   every hook event carries.
// - Codex (~/.codex/sessions): token_count entries carry the last usage and the model's context window,
//   and the usage of the plan's limits (`rate_limits`). Its latest turn_context also says who approves
//   (`approvals_reviewer`), which the hub needs to know. Codex' hook events carry no name for the
//   session; Codex keeps the names of its threads in its session index, read from the end like a
//   transcript. Its first line (session_meta) says who wrote it (`originator`): Codex' command line or its
//   app, which the display tells apart (its own card shows in a terminal, not in the app).
//
// The hub reads only those numbers and settings, only from transcripts in these folders, only from the end
// of the file; nothing of the content goes anywhere.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ContextUsage, PlanLimit, PlanView, Provider } from '../shared/protocol.js';

/** Where Claude Code keeps its transcripts. Any other path in a hook event is ignored. */
export function defaultTranscriptsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/** Where Codex keeps its transcripts ("rollouts"), under its home. */
export function codexTranscriptsRoot(codexHome: string): string {
  return path.join(codexHome, 'sessions');
}

/** Context windows by model, as the app shows them (Opus 5.5: 1M, checked against its context ring). */
export const KNOWN_WINDOWS: Readonly<Record<string, number>> = {
  'claude-opus-5-5': 1_000_000,
};
export const DEFAULT_WINDOW = 200_000;
export const LARGE_WINDOW = 1_000_000;
/** The transcript is read backwards in pieces of this size, and no further than MAX_READ from its end. */
const CHUNK = 256 * 1024;
const MAX_READ = 8 * 1024 * 1024;
/** The app writes the title again and again; a transcript without one in its last MB is not searched on. */
const MAX_TITLE_READ = 1024 * 1024;
/** At most one read per session in this time; a burst of events gets one read after it. */
export const CONTEXT_READ_INTERVAL_MS = 2000;
/** A session's name is cut to this length. */
const MAX_NAME = 200;
/** A Codex transcript's first line holds the instructions too, some 20 KB; longer ones are not read. */
const MAX_FIRST_LINE = 128 * 1024;
/** What Codex' command line writes as the originator of its transcripts; the app writes others. */
export const CODEX_TERMINAL_ORIGINATORS: ReadonlySet<string> = new Set(['codex-tui']);
/** Sessions whose transcript's first line was read, so it is read once; bounded. */
const MAX_ORIGINS = 1000;

/** The window for a model: configured, known, 1M for a "[1m]" model, else 200k; never below what is used. */
export function contextWindow(model: string | null, used: number, configured: Readonly<Record<string, number>> = {}): number {
  const size =
    (model !== null ? (configured[model] ?? KNOWN_WINDOWS[model]) : undefined) ?? (model?.endsWith('[1m]') ? LARGE_WINDOW : DEFAULT_WINDOW);
  // More in use than the assumed window holds: the model has the large window.
  return used > size ? Math.max(LARGE_WINDOW, used) : size;
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

function parseObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The token counts of one Claude Code transcript line, if it is an answer of the main agent. */
export function usageOfLine(line: string): { used: number; model: string | null } | null {
  // A cheap look first: most lines are no answers.
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null;
  const entry = parseObject(line);
  if (!entry) return null;
  const { type, isSidechain, message } = entry as { type?: unknown; isSidechain?: unknown; message?: unknown };
  if (type !== 'assistant' || isSidechain === true || typeof message !== 'object' || message === null) return null;
  const { usage, model } = message as { usage?: unknown; model?: unknown };
  if (typeof usage !== 'object' || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const used = count(u.input_tokens) + count(u.cache_read_input_tokens) + count(u.cache_creation_input_tokens) + count(u.output_tokens);
  if (used === 0) return null;
  return { used, model: typeof model === 'string' && model.length <= 200 ? model : null };
}

/** A session's title from a Claude Code transcript line: the app writes it as a custom-title entry, often. */
export function claudeTitleOfLine(line: string): string | null {
  if (!line.includes('"custom-title"')) return null;
  const entry = parseObject(line);
  if (entry?.type !== 'custom-title' || typeof entry.customTitle !== 'string') return null;
  const title = entry.customTitle.replace(/\s+/g, ' ').trim();
  return title.length > 0 ? title.slice(0, MAX_NAME) : null;
}

/** The context of one Codex transcript line, if it is a token_count entry with a window. */
export function codexUsageOfLine(line: string): ContextUsage | null {
  if (!line.includes('"token_count"')) return null;
  const entry = parseObject(line);
  const payload = entry?.payload as Record<string, unknown> | undefined;
  if (payload?.type !== 'token_count' || typeof payload.info !== 'object' || payload.info === null) return null;
  const info = payload.info as Record<string, unknown>;
  const last = (typeof info.last_token_usage === 'object' && info.last_token_usage !== null ? info.last_token_usage : {}) as Record<string, unknown>;
  const used = count(last.total_tokens) || count(last.input_tokens) + count(last.output_tokens);
  const size = count(info.model_context_window);
  return used > 0 && size > 0 ? { used, size } : null;
}

/** One limit of Codex' rate_limits: {used_percent, window_minutes, resets_at in seconds}. */
function codexLimit(value: unknown): PlanLimit | null {
  if (typeof value !== 'object' || value === null) return null;
  const { used_percent: used, window_minutes: minutes, resets_at: resets } = value as Record<string, unknown>;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0) return null;
  return {
    used: Math.min(100, Math.max(0, used)),
    windowMinutes: minutes,
    resetsAt: typeof resets === 'number' && Number.isFinite(resets) && resets > 0 ? resets * 1000 : null,
  };
}

/** The usage of the plan's limits in one Codex transcript line, if it is a token_count entry with them. */
export function codexPlanOfLine(line: string): PlanView | null {
  if (!line.includes('"rate_limits"')) return null;
  const entry = parseObject(line);
  const payload = entry?.payload as Record<string, unknown> | undefined;
  if (payload?.type !== 'token_count' || typeof payload.rate_limits !== 'object' || payload.rate_limits === null) return null;
  // The time tells which of several transcripts recorded the newest values.
  const recordedAt = typeof entry?.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN;
  if (!Number.isFinite(recordedAt)) return null;
  const { primary, secondary } = payload.rate_limits as Record<string, unknown>;
  const limits = [codexLimit(primary), codexLimit(secondary)]
    .filter((limit) => limit !== null)
    .sort((a, b) => a.windowMinutes - b.windowMinutes);
  return limits.length > 0 ? { provider: 'codex', limits, recordedAt } : null;
}

/** Who approves in a Codex session, from a turn_context line: "user", "auto_review", … */
export function codexReviewerOfLine(line: string): string | null {
  if (!line.includes('"turn_context"')) return null;
  const entry = parseObject(line);
  if (entry?.type !== 'turn_context') return null;
  const reviewer = (entry.payload as Record<string, unknown> | undefined)?.approvals_reviewer;
  return typeof reviewer === 'string' && reviewer.length <= 100 ? reviewer : null;
}

/** Who wrote a Codex transcript, from its first line (session_meta): "codex-tui" for the command line. */
export function codexOriginatorOfLine(line: string): string | null {
  if (!line.includes('"session_meta"')) return null;
  const entry = parseObject(line);
  if (entry?.type !== 'session_meta') return null;
  const originator = (entry.payload as Record<string, unknown> | undefined)?.originator;
  return typeof originator === 'string' && originator.length <= 100 ? originator : null;
}

/** The first line of a file, if it ends within `maxRead` bytes; null otherwise. */
export async function readFirstLine(file: string, maxRead = MAX_FIRST_LINE): Promise<string | null> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const piece = Buffer.alloc(maxRead);
    const { bytesRead } = await handle.read(piece, 0, maxRead, 0);
    const end = piece.subarray(0, bytesRead).indexOf(0x0a);
    return end < 0 ? null : piece.subarray(0, end).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Where Codex keeps the names of its threads (sessions): one line per naming, newest last. */
export function codexSessionIndex(codexHome: string): string {
  return path.join(codexHome, 'session_index.jsonl');
}

/** A thread's name from a line of Codex' session index ({id, thread_name, updated_at}), if it is this thread's. */
export function codexNameOfLine(line: string, sessionId: string): string | null {
  if (!line.includes(sessionId)) return null;
  const entry = parseObject(line);
  if (entry?.id !== sessionId || typeof entry.thread_name !== 'string') return null;
  const name = entry.thread_name.replace(/\s+/g, ' ').trim();
  return name.length > 0 ? name.slice(0, MAX_NAME) : null;
}

/** Codex names transcripts with the long-path prefix (\\?\C:\…); the plain path is the same file. */
export function plainPath(file: string): string {
  return file.replace(/^\\\\\?\\(?=[A-Za-z]:\\)/, '');
}

/** The transcript's path if it lies under the root (after following links) and is a .jsonl file. */
export async function checkedTranscript(file: string, root: string): Promise<string | null> {
  const plain = plainPath(file);
  if (!path.isAbsolute(plain) || path.extname(plain).toLowerCase() !== '.jsonl') return null;
  // Windows paths compare without case.
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  try {
    const [real, realRoot] = await Promise.all([fs.promises.realpath(plain), fs.promises.realpath(root)]);
    return fold(real).startsWith(fold(realRoot) + path.sep) ? real : null;
  } catch {
    return null;
  }
}

/** The first line from the end of the file that `parse` accepts, within `maxRead` bytes from the end. */
export async function readLastFromEnd<T>(file: string, parse: (line: string) => T | null, maxRead = MAX_READ): Promise<T | null> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    let end = size;
    let carry = Buffer.alloc(0);
    while (end > 0 && size - end < maxRead) {
      const start = Math.max(0, end - CHUNK);
      const piece = Buffer.alloc(end - start);
      await handle.read(piece, 0, piece.length, start);
      const text = Buffer.concat([piece, carry]);
      // The first line of the piece may be cut, unless the piece starts the file; it is completed by the
      // piece before. A piece without any line break is all one cut line.
      const firstBreak = start === 0 ? -1 : text.indexOf(0x0a);
      end = start;
      if (start > 0 && firstBreak < 0) {
        carry = text;
        continue;
      }
      const lines = text.subarray(firstBreak + 1).toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const found = parse(lines[i]!);
        if (found !== null) return found;
      }
      carry = firstBreak >= 0 ? text.subarray(0, firstBreak) : Buffer.alloc(0);
    }
    return null;
  } finally {
    await handle.close();
  }
}

/** The usage of the last answer of the main agent in a Claude Code transcript. */
export function readContextUsage(file: string): Promise<{ used: number; model: string | null } | null> {
  return readLastFromEnd(file, usageOfLine);
}

export interface ContextReaderOptions {
  /** Claude Code's transcripts. */
  root: string;
  /** Codex' transcripts; without it, Codex sessions get no ring. */
  codexRoot?: string | null;
  /** Context windows from the configuration, by model. */
  windows?: Readonly<Record<string, number>>;
  onUsage: (sessionId: string, usage: ContextUsage) => void;
  /** The usage of the plan's limits, as a Codex transcript recorded it last. */
  onPlan?: (plan: PlanView) => void;
  /** Codex' session index with the names of its threads; without it, Codex sessions keep no name. */
  codexIndex?: string | null;
  /**
   * A session's name: for Claude Code the transcript's latest title (events do not all carry it), for
   * Codex the latest in its session index.
   */
  onName?: (sessionId: string, name: string) => void;
  /** A Codex session that runs in Codex' command line, as its transcript's first line says; asked once. */
  onTerminal?: (sessionId: string) => void;
  log?: (line: string) => void;
  intervalMs?: number;
}

/** Reads the context usage of sessions after their events, at most once per interval each. */
export class ContextReader {
  private readonly options: ContextReaderOptions;
  private readonly pending = new Map<string, { file: string; provider: Provider; timer: NodeJS.Timeout | null }>();
  private readonly origins = new Set<string>();
  private warnedOutside = false;
  private stopped = false;

  constructor(options: ContextReaderOptions) {
    this.options = options;
  }

  /** A session's event named its transcript: read it soon. */
  note(sessionId: string, file: string | undefined, provider: Provider = 'claude'): void {
    if (!file || this.stopped) return;
    const entry = this.pending.get(sessionId);
    if (entry) {
      entry.file = file;
      entry.provider = provider;
      if (entry.timer) return;
    }
    const next = entry ?? { file, provider, timer: null };
    next.timer = setTimeout(() => {
      next.timer = null;
      void this.read(sessionId, next.file, next.provider);
    }, this.options.intervalMs ?? CONTEXT_READ_INTERVAL_MS);
    this.pending.set(sessionId, next);
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.pending.values()) if (entry.timer) clearTimeout(entry.timer);
    this.pending.clear();
  }

  /** Reads one transcript now (also for tests), and the session's name. */
  async read(sessionId: string, file: string, provider: Provider = 'claude'): Promise<ContextUsage | null> {
    if (provider === 'codex') await this.readName(sessionId);
    const checked = await this.checked(file, provider);
    if (!checked) return null;
    let usage: ContextUsage | null = null;
    try {
      if (provider === 'codex') {
        await this.readOrigin(sessionId, checked);
        usage = await readLastFromEnd(checked, codexUsageOfLine);
        const plan = this.options.onPlan ? await readLastFromEnd(checked, codexPlanOfLine) : null;
        if (plan && !this.stopped) this.options.onPlan?.(plan);
      } else {
        const found = await readContextUsage(checked);
        if (found) {
          usage = { used: found.used, size: contextWindow(found.model, found.used, this.options.windows), ...(found.model ? { model: found.model } : {}) };
        }
        const title = this.options.onName ? await readLastFromEnd(checked, claudeTitleOfLine, MAX_TITLE_READ) : null;
        if (title && !this.stopped) this.options.onName?.(sessionId, title);
      }
    } catch {
      return null;
    }
    if (!usage || this.stopped) return null;
    this.options.onUsage(sessionId, usage);
    return usage;
  }

  /** A Codex session's newest name from Codex' session index, which lies at a fixed place, not in hook data. */
  private async readName(sessionId: string): Promise<void> {
    const index = this.options.codexIndex;
    if (!index || !this.options.onName) return;
    let name: string | null = null;
    try {
      name = await readLastFromEnd(index, (line) => codexNameOfLine(line, sessionId));
    } catch {
      return;
    }
    if (name && !this.stopped) this.options.onName(sessionId, name);
  }

  /** Once per session: whether Codex' command line wrote its transcript (only the first line's originator). */
  private async readOrigin(sessionId: string, file: string): Promise<void> {
    if (!this.options.onTerminal || this.origins.has(sessionId)) return;
    this.origins.add(sessionId);
    if (this.origins.size > MAX_ORIGINS) this.origins.delete(this.origins.values().next().value!);
    const line = await readFirstLine(file);
    const originator = line === null ? null : codexOriginatorOfLine(line);
    if (originator !== null && CODEX_TERMINAL_ORIGINATORS.has(originator) && !this.stopped) this.options.onTerminal(sessionId);
  }

  /** Who approves in a Codex session ("user", "auto_review", …); null when it cannot be read. */
  async codexReviewer(file: string | null): Promise<string | null> {
    if (!file) return null;
    const checked = await this.checked(file, 'codex');
    if (!checked) return null;
    try {
      return await readLastFromEnd(checked, codexReviewerOfLine);
    } catch {
      return null;
    }
  }

  private async checked(file: string, provider: Provider): Promise<string | null> {
    const root = provider === 'codex' ? this.options.codexRoot : this.options.root;
    const checked = root ? await checkedTranscript(file, root) : null;
    if (!checked && !this.warnedOutside) {
      this.warnedOutside = true;
      this.options.log?.('Context: a hook event named a transcript outside the transcripts folders; it is not read.');
    }
    return checked;
  }
}
