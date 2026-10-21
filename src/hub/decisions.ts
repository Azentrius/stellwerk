// The last decisions on permission requests, for the display: kept as the hub settles them and, at its
// start, read back from the end of its own audit log, so a restart does not empty them. Of a request only
// what the display shows: when, how it ended, the tool, a short "what" (a command's first line, a file, an
// address) and whose session; never the whole input.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import { z } from 'zod';
import type { DecisionView, PermissionOutcome } from '../shared/protocol.js';

/** How many the display gets, newest first. */
export const DECISIONS_KEPT = 10;
const WHAT_MAX = 120;
/** At a start, the audit log is read from its end, at most this much. */
const READ_FROM_END = 256 * 1024;

const OUTCOMES: readonly PermissionOutcome[] = ['allowed', 'denied', 'handed-to-app', 'decided-in-app', 'aborted', 'timed-out'];

/** A short line of what a request was about: the tool's main parameter, on one line, cut to a length. */
export function decisionWhat(tool: string, input: Record<string, unknown>, mcpServer: string | null): string {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
  let what: string;
  if (tool === 'Bash' || tool === 'PowerShell') what = text('command');
  else if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write') what = text('file_path');
  else if (tool === 'NotebookEdit') what = text('notebook_path');
  else if (tool === 'WebFetch') what = text('url');
  else if (tool === 'WebSearch') what = text('query');
  else if (mcpServer) what = mcpServer;
  else what = Object.values(input).find((value): value is string => typeof value === 'string') ?? '';
  const line = what.split(/\r?\n/).find((part) => part.trim() !== '')?.trim() ?? '';
  return line.length > WHAT_MAX ? `${line.slice(0, WHAT_MAX - 1)}…` : line;
}

const auditLine = z.object({
  ts: z.string(),
  request: z.string().max(200),
  project: z.string().max(500).optional(),
  title: z.string().max(500).nullable().optional(),
  provider: z.enum(['claude', 'codex']).optional(),
  tool: z.string().max(200),
  mcpServer: z.string().max(200).nullable().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  result: z.enum(OUTCOMES as [PermissionOutcome, ...PermissionOutcome[]]),
});

/** A decision from one line of the audit log; null for a line that is not one. */
export function decisionOfAuditLine(line: string): DecisionView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const result = auditLine.safeParse(parsed);
  if (!result.success) return null;
  const record = result.data;
  const at = Date.parse(record.ts);
  if (!Number.isFinite(at)) return null;
  return {
    id: record.request,
    at,
    outcome: record.result,
    tool: record.tool,
    what: decisionWhat(record.tool, record.input ?? {}, record.mcpServer ?? null),
    project: record.project ?? '',
    title: record.title ?? null,
    provider: record.provider ?? null,
  };
}

export class Decisions {
  private list: DecisionView[] = [];

  /** The newest first. */
  view(): DecisionView[] {
    return this.list;
  }

  add(decision: DecisionView): void {
    this.list = [decision, ...this.list.filter((d) => d.id !== decision.id)].slice(0, DECISIONS_KEPT);
  }

  /** The last ones of the audit log; a missing or unreadable log gives none. */
  load(file: string): void {
    let text: string;
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        const length = Math.min(size, READ_FROM_END);
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, size - length);
        text = buffer.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return;
    }
    // The first line may be cut in the middle: it fails to parse and is left out.
    const found = text
      .split('\n')
      .map(decisionOfAuditLine)
      .filter((d): d is DecisionView => d !== null);
    for (const decision of found) this.add(decision);
  }
}
