// How full a session's context is. Every hook event names the session's transcript; the last answer of
// the main agent there carries its token counts (input with cache, and output), which together are what
// the context holds now. The hub reads only those numbers and the model, only from transcripts under
// ~/.claude/projects, only from the end of the file; nothing of the content goes anywhere.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ContextUsage } from '../shared/protocol.js';

/** Where Claude Code keeps its transcripts. Any other path in a hook event is ignored. */
export function defaultTranscriptsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
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
/** At most one read per session in this time; a burst of events gets one read after it. */
export const CONTEXT_READ_INTERVAL_MS = 2000;

/** The window for a model: configured, known, 1M for a "[1m]" model, else 200k; never below what is used. */
export function contextWindow(model: string | null, used: number, configured: Readonly<Record<string, number>> = {}): number {
  const size =
    (model !== null ? (configured[model] ?? KNOWN_WINDOWS[model]) : undefined) ?? (model?.endsWith('[1m]') ? LARGE_WINDOW : DEFAULT_WINDOW);
  // More in use than the assumed window holds: the model has the large window.
  return used > size ? Math.max(LARGE_WINDOW, used) : size;
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** The token counts of one transcript line, if it is an answer of the main agent. */
export function usageOfLine(line: string): { used: number; model: string | null } | null {
  // A cheap look first: most lines are no answers.
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof entry !== 'object' || entry === null) return null;
  const { type, isSidechain, message } = entry as { type?: unknown; isSidechain?: unknown; message?: unknown };
  if (type !== 'assistant' || isSidechain === true || typeof message !== 'object' || message === null) return null;
  const { usage, model } = message as { usage?: unknown; model?: unknown };
  if (typeof usage !== 'object' || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const used = count(u.input_tokens) + count(u.cache_read_input_tokens) + count(u.cache_creation_input_tokens) + count(u.output_tokens);
  if (used === 0) return null;
  return { used, model: typeof model === 'string' && model.length <= 200 ? model : null };
}

/** The transcript's path if it lies under the root (after following links) and is a .jsonl file. */
export async function checkedTranscript(file: string, root: string): Promise<string | null> {
  if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.jsonl') return null;
  // Windows paths compare without case.
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  try {
    const [real, realRoot] = await Promise.all([fs.promises.realpath(file), fs.promises.realpath(root)]);
    return fold(real).startsWith(fold(realRoot) + path.sep) ? real : null;
  } catch {
    return null;
  }
}

/** The usage of the last answer of the main agent, read from the end of the transcript. */
export async function readContextUsage(file: string): Promise<{ used: number; model: string | null } | null> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    let end = size;
    let carry = Buffer.alloc(0);
    while (end > 0 && size - end < MAX_READ) {
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
        const found = usageOfLine(lines[i]!);
        if (found) return found;
      }
      carry = firstBreak >= 0 ? text.subarray(0, firstBreak) : Buffer.alloc(0);
    }
    return null;
  } finally {
    await handle.close();
  }
}

export interface ContextReaderOptions {
  root: string;
  /** Context windows from the configuration, by model. */
  windows?: Readonly<Record<string, number>>;
  onUsage: (sessionId: string, usage: ContextUsage) => void;
  log?: (line: string) => void;
  intervalMs?: number;
}

/** Reads the context usage of sessions after their events, at most once per interval each. */
export class ContextReader {
  private readonly options: ContextReaderOptions;
  private readonly pending = new Map<string, { file: string; timer: NodeJS.Timeout | null }>();
  private warnedOutside = false;
  private stopped = false;

  constructor(options: ContextReaderOptions) {
    this.options = options;
  }

  /** A session's event named its transcript: read it soon. */
  note(sessionId: string, file: string | undefined): void {
    if (!file || this.stopped) return;
    const entry = this.pending.get(sessionId);
    if (entry) {
      entry.file = file;
      if (entry.timer) return;
    }
    const next = entry ?? { file, timer: null };
    next.timer = setTimeout(() => {
      next.timer = null;
      void this.read(sessionId, next.file);
    }, this.options.intervalMs ?? CONTEXT_READ_INTERVAL_MS);
    this.pending.set(sessionId, next);
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.pending.values()) if (entry.timer) clearTimeout(entry.timer);
    this.pending.clear();
  }

  /** Reads one transcript now (also for tests). */
  async read(sessionId: string, file: string): Promise<ContextUsage | null> {
    const checked = await checkedTranscript(file, this.options.root);
    if (!checked) {
      if (!this.warnedOutside) {
        this.warnedOutside = true;
        this.options.log?.('Context: a hook event named a transcript outside ~/.claude/projects; it is not read.');
      }
      return null;
    }
    let found: Awaited<ReturnType<typeof readContextUsage>>;
    try {
      found = await readContextUsage(checked);
    } catch {
      return null;
    }
    if (!found || this.stopped) return null;
    const usage = { used: found.used, size: contextWindow(found.model, found.used, this.options.windows) };
    this.options.onUsage(sessionId, usage);
    return usage;
  }
}
