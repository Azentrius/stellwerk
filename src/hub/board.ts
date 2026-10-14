// The status model: sessions, their status, and the permission requests on the display. Pure and
// synchronous; the hub feeds it hook events, decisions and the time, and releases held requests.
//
// SPDX-License-Identifier: Apache-2.0

import type { PermissionOutcome, PermissionView, SessionStatus, SessionView } from '../shared/protocol.js';
import { isOther, type HookEvent, type PermissionRequestEvent } from './hook-input.ts';

/** Ended sessions disappear after this time. */
export const ENDED_VISIBLE_MS = 10 * 60_000;
/** A settled request stays on the display this long, with its outcome. */
export const SETTLED_VISIBLE_MS = 6_000;
/** Sessions without any event for this long are forgotten; their next event brings them back. */
export const IDLE_FORGET_MS = 12 * 60 * 60_000;
export const MAX_SESSIONS = 100;

/** Notifications that mean the session waits for the user. */
const WAITING_NOTIFICATIONS = new Set(['idle_prompt', 'agent_needs_input', 'elicitation_dialog']);

const STATUS_ORDER: Record<SessionStatus, number> = { permission: 0, waiting: 1, working: 2, done: 3, ended: 4 };

/** The status a session has apart from open requests. */
type BaseStatus = Exclude<SessionStatus, 'permission'>;

interface Session {
  id: string;
  cwd: string;
  title: string | null;
  base: BaseStatus;
  /** Subagents seen starting (by agent_id) and not yet stopped. */
  subagents: Set<string>;
  lastActivity: number;
  endedAt: number | null;
}

export interface Permission {
  id: string;
  sessionId: string;
  /** The subagent that asks, null for the main agent. */
  agentId: string | null;
  tool: string;
  input: Record<string, unknown>;
  /** The input in a canonical form, to recognise it in PostToolUse. */
  inputKey: string;
  mcpServer: string | null;
  receivedAt: number;
  holdUntil: number;
  outcome: PermissionOutcome | null;
  resolvedAt: number | null;
}

/** A request the board settled on its own; the hub releases the held request and writes the audit log. */
export interface Settlement {
  permission: Permission;
  outcome: PermissionOutcome;
}

export class Board {
  readonly sessions = new Map<string, Session>();
  readonly permissions = new Map<string, Permission>();
  lastEventAt: number | null = null;

  /** Applies a hook event other than PermissionRequest. Returns the open requests it settles. */
  apply(event: HookEvent, now: number): Settlement[] {
    const session = this.touch(event, now);
    if (isOther(event)) return [];
    const agentId = event.agent_id ?? null;

    switch (event.hook_event_name) {
      case 'UserPromptSubmit':
        // A new prompt: whatever the main agent asked before was answered in the app.
        session.base = 'working';
        return this.settleWhere((p) => p.sessionId === session.id && p.agentId === null, 'decided-in-app', now);

      case 'Stop':
        session.base = 'done';
        return this.settleWhere((p) => p.sessionId === session.id && p.agentId === null, 'decided-in-app', now);

      case 'PostToolUse':
      case 'PostToolUseFailure': {
        // The tool ran, so a matching open request was allowed in the app.
        session.base = 'working';
        const candidates = this.pendingOf(session.id).filter((p) => p.agentId === agentId && p.tool === event.tool_name);
        const inputKey = event.tool_input ? canonicalJson(event.tool_input) : null;
        const match =
          inputKey !== null ? candidates.find((p) => p.inputKey === inputKey) : candidates.length === 1 ? candidates[0] : undefined;
        return match ? this.settleWhere((p) => p === match, 'decided-in-app', now) : [];
      }

      case 'Notification': {
        const type = event.notification_type ?? '';
        // permission_prompt comes a few seconds after every request; while the display holds it, nothing changes.
        if (type === 'permission_prompt' && this.pendingOf(session.id).length > 0) return [];
        if (type === 'permission_prompt' || WAITING_NOTIFICATIONS.has(type)) session.base = 'waiting';
        return [];
      }

      case 'SubagentStart':
        if (agentId) session.subagents.add(agentId);
        session.base = 'working';
        return [];

      case 'SubagentStop':
        // Only pairs count: the app also reports stops of internal helpers that never started as subagents.
        if (!agentId || !session.subagents.delete(agentId)) return [];
        return this.settleWhere((p) => p.sessionId === session.id && p.agentId === agentId, 'decided-in-app', now);

      case 'SessionEnd':
        session.base = 'ended';
        session.endedAt = now;
        session.subagents.clear();
        return this.settleWhere((p) => p.sessionId === session.id, 'aborted', now);

      default:
        return [];
    }
  }

  /** Puts a permission request on the display. */
  addPermission(id: string, event: PermissionRequestEvent, now: number, holdMs: number): Permission {
    const session = this.touch(event, now);
    const permission: Permission = {
      id,
      sessionId: session.id,
      agentId: event.agent_id ?? null,
      tool: event.tool_name,
      input: event.tool_input,
      inputKey: canonicalJson(event.tool_input),
      mcpServer: event.mcp_server?.name ?? null,
      receivedAt: now,
      holdUntil: now + holdMs,
      outcome: null,
      resolvedAt: null,
    };
    this.permissions.set(id, permission);
    return permission;
  }

  /** Notes an event without changing the status, e.g. a request turned away because too many are open. */
  touch(event: HookEvent, now: number): Session {
    this.lastEventAt = now;
    let session = this.sessions.get(event.session_id);
    if (!session) {
      this.makeRoom();
      session = {
        id: event.session_id,
        cwd: event.cwd ?? '',
        title: null,
        base: 'done',
        subagents: new Set(),
        lastActivity: now,
        endedAt: null,
      };
      this.sessions.set(session.id, session);
    }
    if (event.cwd) session.cwd = event.cwd;
    if (event.session_title) session.title = event.session_title;
    session.lastActivity = now;
    if (session.base === 'ended' && event.hook_event_name !== 'SessionEnd') {
      // Resumed after its end.
      session.base = 'done';
      session.endedAt = null;
    }
    return session;
  }

  /**
   * Settles an open request from outside: a decision on the display, the end of the hold time, or Claude
   * Code closing the request. Returns false if it is unknown or already settled.
   */
  settle(id: string, outcome: PermissionOutcome, now: number): boolean {
    const permission = this.permissions.get(id);
    if (!permission || permission.outcome !== null) return false;
    permission.outcome = outcome;
    permission.resolvedAt = now;
    const session = this.sessions.get(permission.sessionId);
    if (session && session.base !== 'ended') {
      if (outcome === 'allowed' || outcome === 'denied') session.base = 'working';
      // The app's own card stays open and waits for the user.
      else if (outcome === 'handed-to-app' || outcome === 'timed-out') session.base = 'waiting';
      // Cancelled or rejected in the app: nothing to do on the display.
      else if (outcome === 'aborted') session.base = 'done';
    }
    return true;
  }

  pendingCount(): number {
    let count = 0;
    for (const p of this.permissions.values()) if (p.outcome === null) count++;
    return count;
  }

  /** Drops what no longer belongs on the display. Returns true if anything changed. */
  sweep(now: number): boolean {
    let changed = false;
    for (const [id, p] of this.permissions) {
      if (p.resolvedAt !== null && now - p.resolvedAt >= SETTLED_VISIBLE_MS) {
        this.permissions.delete(id);
        changed = true;
      }
    }
    for (const [id, s] of this.sessions) {
      const ended = s.endedAt !== null && now - s.endedAt >= ENDED_VISIBLE_MS;
      const idle = now - s.lastActivity >= IDLE_FORGET_MS;
      if ((ended || idle) && !this.hasAnyPermission(id)) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  view(): { sessions: SessionView[]; permissions: PermissionView[] } {
    const sessions = [...this.sessions.values()]
      .map((s): SessionView => ({
        id: s.id,
        project: projectName(s.cwd),
        cwd: s.cwd,
        title: s.title,
        status: this.statusOf(s),
        subagents: s.subagents.size,
        lastActivity: s.lastActivity,
        endedAt: s.endedAt,
      }))
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.lastActivity - a.lastActivity);

    const all = [...this.permissions.values()];
    const open = all.filter((p) => p.outcome === null).sort((a, b) => a.receivedAt - b.receivedAt);
    const settled = all.filter((p) => p.outcome !== null).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
    const permissions = [...open, ...settled].map((p): PermissionView => {
      const session = this.sessions.get(p.sessionId);
      return {
        id: p.id,
        sessionId: p.sessionId,
        project: projectName(session?.cwd ?? ''),
        title: session?.title ?? null,
        tool: p.tool,
        input: p.input,
        mcpServer: p.mcpServer,
        receivedAt: p.receivedAt,
        holdUntil: p.holdUntil,
        outcome: p.outcome,
        resolvedAt: p.resolvedAt,
      };
    });
    return { sessions, permissions };
  }

  private statusOf(session: Session): SessionStatus {
    if (session.base === 'ended') return 'ended';
    return this.pendingOf(session.id).length > 0 ? 'permission' : session.base;
  }

  private pendingOf(sessionId: string): Permission[] {
    return [...this.permissions.values()].filter((p) => p.sessionId === sessionId && p.outcome === null);
  }

  private hasAnyPermission(sessionId: string): boolean {
    for (const p of this.permissions.values()) if (p.sessionId === sessionId) return true;
    return false;
  }

  private settleWhere(test: (p: Permission) => boolean, outcome: PermissionOutcome, now: number): Settlement[] {
    const settled: Settlement[] = [];
    for (const p of this.permissions.values()) {
      if (p.outcome === null && test(p)) {
        p.outcome = outcome;
        p.resolvedAt = now;
        settled.push({ permission: p, outcome });
      }
    }
    return settled;
  }

  /** Keeps the number of sessions bounded: forgets the least recently active one without requests. */
  private makeRoom(): void {
    if (this.sessions.size < MAX_SESSIONS) return;
    const candidates = [...this.sessions.values()].filter((s) => !this.hasAnyPermission(s.id));
    candidates.sort((a, b) => a.lastActivity - b.lastActivity);
    const oldest = candidates[0];
    if (oldest) this.sessions.delete(oldest.id);
  }
}

/** Last part of a path, Windows or POSIX. */
export function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? cwd;
}

/** JSON with sorted object keys, so equal inputs compare equal whatever their key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
