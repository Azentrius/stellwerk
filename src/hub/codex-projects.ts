// The projects of the Codex app, so a Codex session shows the project the app files its chat under, not
// only its folder: two projects may share a folder, and a project's name is the user's. The app keeps
// them in its state file in Codex' home (`.codex-global-state.json`): `local-projects` (id → {name,
// rootPaths}), `thread-project-assignments` (thread → {projectId}) and `projectless-thread-ids`. The file
// holds much else of the app (drafts, window state); only these three keys are read into the hub, and
// only the names of projects are kept. It is read again only after it changed.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Where the Codex app keeps its state, in Codex' home. */
export function codexStateFile(codexHome: string): string {
  return path.join(codexHome, '.codex-global-state.json');
}

/** The file is looked at no more often than this; a burst of events gets one look. */
export const CODEX_STATE_CHECK_MS = 5000;
/** A larger file is not read. */
const MAX_STATE_BYTES = 20 * 1024 * 1024;
const MAX_NAME = 200;

const stateSchema = z.object({
  'local-projects': z
    .record(z.string().max(200), z.object({ name: z.string().max(1000), rootPaths: z.array(z.string().max(4096)).max(100).default([]) }))
    .default({}),
  'thread-project-assignments': z.record(z.string().max(200), z.object({ projectId: z.string().max(200) })).default({}),
  'projectless-thread-ids': z.array(z.string().max(200)).max(100_000).default([]),
});

interface Projects {
  /** Project name by id. */
  names: Map<string, string>;
  /** Project id by thread. */
  assigned: Map<string, string>;
  projectless: Set<string>;
  /** Folders of the projects, normalized, with the project's name. */
  roots: { root: string; name: string }[];
}

const fold = (p: string) => {
  const plain = p.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? plain.toLowerCase().replaceAll('/', '\\') : plain;
};

/** The projects from the app's state, or null when the file is not as expected. */
export function parseCodexState(text: string): Projects | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) return null;
  const state = parsed.data;
  const names = new Map<string, string>();
  const roots: Projects['roots'] = [];
  for (const [id, project] of Object.entries(state['local-projects'])) {
    const name = project.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!name) continue;
    names.set(id, name);
    for (const root of project.rootPaths) roots.push({ root: fold(root), name });
  }
  const assigned = new Map(Object.entries(state['thread-project-assignments']).map(([thread, a]) => [thread, a.projectId]));
  return { names, assigned, projectless: new Set(state['projectless-thread-ids']), roots };
}

/**
 * A thread's project: the one the app assigned it to, none ('') for a thread the app keeps without a
 * project, else the one project whose folder is the session's; null when not known (the folder shows).
 */
export function projectOf(projects: Projects, threadId: string, cwd: string | undefined): string | null {
  const assignedTo = projects.assigned.get(threadId);
  const assignedName = assignedTo !== undefined ? projects.names.get(assignedTo) : undefined;
  if (assignedName !== undefined) return assignedName;
  if (projects.projectless.has(threadId)) return '';
  if (!cwd) return null;
  const names = new Set(projects.roots.filter((r) => r.root === fold(cwd)).map((r) => r.name));
  return names.size === 1 ? [...names][0]! : null;
}

export class CodexProjects {
  readonly file: string;
  private projects: Projects | null = null;
  private seen: { mtimeMs: number; size: number } | null = null;
  private checkedAt = Number.NEGATIVE_INFINITY;
  private reading: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
  }

  /** The project of a Codex thread, as the app files it; null when not known. */
  async projectOf(threadId: string, cwd: string | undefined): Promise<string | null> {
    await this.refresh();
    return this.projects ? projectOf(this.projects, threadId, cwd) : null;
  }

  private refresh(): Promise<void> {
    if (this.now() - this.checkedAt < CODEX_STATE_CHECK_MS) return this.reading ?? Promise.resolve();
    this.checkedAt = this.now();
    this.reading = this.load().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private async load(): Promise<void> {
    try {
      const stat = await fs.promises.stat(this.file);
      if (this.seen && stat.mtimeMs === this.seen.mtimeMs && stat.size === this.seen.size) return;
      this.seen = { mtimeMs: stat.mtimeMs, size: stat.size };
      if (stat.size > MAX_STATE_BYTES) {
        this.projects = null;
        return;
      }
      // The app writes the file anew while it runs; a half-written one keeps the last good projects.
      const parsed = parseCodexState(await fs.promises.readFile(this.file, 'utf8'));
      if (parsed) this.projects = parsed;
      else this.seen = null;
    } catch {
      this.projects = null;
      this.seen = null;
    }
  }
}
