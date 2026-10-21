// The audit log: one JSON line per permission request and how it ended. It holds commands and code, so
// it lives in the user's local app data; the token never goes in.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import type { PermissionOutcome, Provider } from '../shared/protocol.js';
import { projectName, type Permission } from './board.ts';

export interface AuditRecord {
  permission: Permission;
  cwd: string;
  outcome: PermissionOutcome;
  at: number;
  /** Whose agent asked, and the session's title, as the display showed them. */
  provider?: Provider;
  title?: string | null;
  /** Why the hub settled it on its own, e.g. too many open requests. */
  note?: string;
}

export class AuditLog {
  readonly file: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  write(record: AuditRecord): void {
    const { permission: p } = record;
    const line = JSON.stringify({
      ts: new Date(record.at).toISOString(),
      request: p.id,
      session: p.sessionId,
      project: projectName(record.cwd),
      ...(record.title ? { title: record.title } : {}),
      ...(record.provider ? { provider: record.provider } : {}),
      cwd: record.cwd,
      agent: p.agentId,
      tool: p.tool,
      mcpServer: p.mcpServer,
      input: p.input,
      result: record.outcome,
      waitedMs: record.at - p.receivedAt,
      ...(record.note ? { note: record.note } : {}),
    });
    // Appends one after the other, in the order the requests were settled.
    this.queue = this.queue
      .then(() => fs.promises.appendFile(this.file, `${line}\n`, { encoding: 'utf8', mode: 0o600 }))
      .catch((err: Error) => console.error(`Audit log: ${err.message}`));
  }

  flush(): Promise<void> {
    return this.queue;
  }
}
