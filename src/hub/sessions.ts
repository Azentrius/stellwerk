// The sessions on the display, remembered over a restart of the hub, so that the agents column is not empty
// until each session sends its next event. Only what the display shows of a session: its id, provider,
// folder, title, project, how full its context is, the desktop app's own id of it (to open it there) and when
// it was last active. Never a question, a prompt, a tool's input or a request.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MAX_SESSIONS, type SavedSession } from './board.ts';

/** At most one write in this time: sessions change with every event. */
export const SAVE_EVERY_MS = 5_000;

// The limits of the hook data (hook-input.ts) and of the names the hub takes from elsewhere. Each entry is
// checked on its own: one that does not fit is left out, the others are taken.
const savedSession = z.object({
  id: z.string().min(1).max(200),
  provider: z.enum(['claude', 'codex']),
  cwd: z.string().max(4096),
  title: z.string().max(1000).nullable(),
  project: z.string().max(1000).nullable(),
  context: z.object({ used: z.number().nonnegative(), size: z.number().positive(), model: z.string().max(200).optional() }).nullable(),
  appSession: z.string().max(100).nullable().optional(),
  lastActivity: z.number().nonnegative(),
});
const savedList = z.array(z.unknown()).max(MAX_SESSIONS);

export class SessionFile {
  /** Where the sessions are remembered; null keeps nothing. */
  readonly file: string | null;
  private readonly log: (line: string) => void;
  private pending: string | null = null;
  private written: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private writes: Promise<void> = Promise.resolve();
  private writeFailed = false;

  constructor(file: string | null, log: (line: string) => void = () => {}) {
    this.file = file;
    this.log = log;
  }

  /** The sessions the last run remembered; none for a missing or broken file. */
  load(): SavedSession[] {
    if (!this.file) return [];
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    try {
      const list = savedList.parse(JSON.parse(text));
      this.written = text;
      return list.flatMap((entry) => {
        const session = savedSession.safeParse(entry);
        return session.success ? [session.data] : [];
      });
    } catch {
      this.log(`Sessions: ${this.file} is not readable; it is written again with the next change.`);
      return [];
    }
  }

  /** Remembers the sessions, at most once every SAVE_EVERY_MS; the newest list is the one written. */
  save(sessions: SavedSession[]): void {
    if (!this.file) return;
    this.pending = `${JSON.stringify(sessions)}\n`;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, SAVE_EVERY_MS);
    this.timer.unref();
  }

  /** Writes what is still to be written now and waits for it (closing, tests). */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.write();
    return this.writes;
  }

  private write(): void {
    const file = this.file;
    const text = this.pending;
    this.pending = null;
    if (!file || text === null || text === this.written) return;
    // One write after the other, so the newest list is the one that stays.
    this.writes = this.writes.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, text, { encoding: 'utf8', mode: 0o600 });
        this.written = text;
        this.writeFailed = false;
      } catch (err) {
        // Once, not with every change.
        if (!this.writeFailed) this.log(`Sessions: ${(err as Error).message}`);
        this.writeFailed = true;
      }
    });
  }
}
