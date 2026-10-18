// The status model: sessions, their status, and the permission requests on the display. Pure and
// synchronous; the hub feeds it hook events, decisions and the time, and releases held requests.
//
// SPDX-License-Identifier: Apache-2.0

import type {
  ContextUsage,
  PermissionOutcome,
  PermissionView,
  Provider,
  SessionStatus,
  SessionView,
  WaitingFor,
} from '../shared/protocol.js';
import { isOther, type HookEvent, type PermissionRequestEvent } from './hook-input.ts';

/** Ended sessions disappear after this time. */
export const ENDED_VISIBLE_MS = 10 * 60_000;
/** A settled request stays on the display this long, with its outcome. */
export const SETTLED_VISIBLE_MS = 6_000;
/** Sessions without any event for this long are forgotten; their next event brings them back. */
export const IDLE_FORGET_MS = 12 * 60 * 60_000;
export const MAX_SESSIONS = 100;

/** Notifications that mean the session waits for the user, and for what. */
const WAITING_NOTIFICATIONS: Readonly<Record<string, WaitingFor>> = {
  idle_prompt: 'idle',
  agent_needs_input: 'input',
  elicitation_dialog: 'input',
  permission_prompt: 'permission',
};

/**
 * Tools that ask the user something rather than ask for permission. They arrive as PermissionRequest, but
 * allow or deny would not answer them, so they get no card: the session waits for the user in the app.
 */
export const QUESTION_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion']);

/**
 * Tools that ask the user something and return at once (Codex' question card): after their PostToolUse
 * the session waits for the answer, which comes as the next prompt.
 */
export const ASYNC_QUESTION_TOOLS: ReadonlySet<string> = new Set(['request_user_input_async']);

/**
 * The desktop app's box at the end of a turn: a recap, often a question (`ask`) with answers to tap, and
 * whether the session is `blocked` on the user. It ends the turn, so a Stop follows; with a question the
 * session then waits for the user instead of being done.
 */
export const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up';
/** A question longer than this is cut; the display shows it in one line anyway. */
export const MAX_QUESTION = 300;

const STATUS_ORDER: Record<SessionStatus, number> = { permission: 0, waiting: 1, working: 2, done: 3, ended: 4 };

/** The status a session has apart from open requests. */
type BaseStatus = Exclude<SessionStatus, 'permission'>;

interface Session {
  id: string;
  provider: Provider;
  cwd: string;
  title: string | null;
  /** The project as the agent's app names it (Codex); '' for none; null: the last part of cwd. */
  project: string | null;
  base: BaseStatus;
  /** While base is 'waiting': what for, and since when. */
  waitingFor: WaitingFor | null;
  waitingSince: number | null;
  /** While waiting for an answer: the question, if known. */
  question: string | null;
  /** The end-of-turn box asked something; the Stop that follows makes the session wait. */
  wrapUp: { reason: 'question' | 'input'; question: string | null } | null;
  /**
   * A question the main agent asked without waiting for it (Codex' request_user_input_async). It stays
   * open past the end of the turn and past further tool events, until the answer (the next prompt) or the
   * end of the session; while open, the session waits for it.
   */
  openQuestion: { question: string | null; since: number } | null;
  /**
   * Requests of subagents that went to the app's own card (handed over, or the hold time ran out), by
   * request id. Kept apart from the main agent's status: they show only while the main agent waits for
   * nothing else (its question or input comes first), and end with the subagent's next event, its stop,
   * the end of the turn or a new prompt.
   */
  subagentAppRequests: Map<string, { agentId: string; since: number }>;
  /** How full the context is, from the transcript; null until read. */
  context: ContextUsage | null;
  /** Subagents seen starting (by agent_id) and not yet stopped. */
  subagents: Set<string>;
  lastActivity: number;
  endedAt: number | null;
}

/** Any status but waiting; whatever the session waited for is over. */
function setStatus(session: Session, base: Exclude<BaseStatus, 'waiting'>): void {
  session.base = base;
  session.waitingFor = null;
  session.waitingSince = null;
  session.question = null;
}

/** The session waits for the user. Mere idleness never replaces a question, an input or a permission. */
function waitFor(session: Session, reason: WaitingFor, now: number, question: string | null = null): void {
  if (reason === 'idle' && session.base === 'waiting' && session.waitingFor !== null && session.waitingFor !== 'idle') return;
  if (session.base !== 'waiting' || session.waitingFor !== reason) session.waitingSince = now;
  session.base = 'waiting';
  session.waitingFor = reason;
  session.question = reason === 'question' ? question : null;
}

/** A question as text for the display: trimmed, cut to MAX_QUESTION, null when there is none. */
function questionText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (text === '') return null;
  return text.length > MAX_QUESTION ? `${text.slice(0, MAX_QUESTION)}…` : text;
}

/** The first question of a question tool's input: `questions[0]`, its `question` or its `title`. */
function firstQuestion(input: Record<string, unknown> | undefined): string | null {
  const questions = input?.questions;
  const first: unknown = Array.isArray(questions) ? questions[0] : undefined;
  if (typeof first !== 'object' || first === null) return null;
  const q = first as Record<string, unknown>;
  return questionText(q.question) ?? questionText(q.title);
}

/** What the end-of-turn box waits for: an answer to its question, some input, or nothing. */
function wrapUpOf(input: Record<string, unknown> | undefined): Session['wrapUp'] {
  const question = questionText(input?.ask);
  if (question !== null) return { reason: 'question', question };
  return input?.blocked === true ? { reason: 'input', question: null } : null;
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
  /** Projects found before their session appeared (a request as its first event); taken when it does. */
  private readonly projectsAhead = new Map<string, string>();
  lastEventAt: number | null = null;

  /** Applies a hook event other than PermissionRequest. Returns the open requests it settles. */
  apply(event: HookEvent, now: number, provider: Provider = 'claude'): Settlement[] {
    const session = this.touch(event, now, provider);
    if (isOther(event)) return [];
    const agentId = event.agent_id ?? null;
    // A subagent's request at the app's card is over with that subagent's next event (the tool ran or
    // failed), its stop, the end of the turn or a new prompt.
    const name = event.hook_event_name;
    if (name === 'UserPromptSubmit' || name === 'Stop' || name === 'SessionEnd') session.subagentAppRequests.clear();
    else if (agentId !== null && (name === 'PostToolUse' || name === 'PostToolUseFailure' || name === 'SubagentStop')) {
      for (const [id, request] of session.subagentAppRequests) if (request.agentId === agentId) session.subagentAppRequests.delete(id);
    }

    switch (event.hook_event_name) {
      case 'UserPromptSubmit':
        // A new prompt: whatever the main agent asked before was answered in the app.
        setStatus(session, 'working');
        session.wrapUp = null;
        session.openQuestion = null;
        return this.settleWhere((p) => p.sessionId === session.id && p.agentId === null, 'decided-in-app', now);

      case 'Stop': {
        // A turn that ended with a question in the app's box waits for the answer; otherwise it is done.
        const wrapUp = session.wrapUp;
        session.wrapUp = null;
        if (wrapUp) waitFor(session, wrapUp.reason, now, wrapUp.question);
        else setStatus(session, 'done');
        return this.settleWhere((p) => p.sessionId === session.id && p.agentId === null, 'decided-in-app', now);
      }

      case 'PostToolUse':
      case 'PostToolUseFailure': {
        // The tool ran, so a matching open request was allowed in the app (and a question answered). Only
        // the main agent's tools say what the session does: a subagent working on leaves a question of the
        // main agent open.
        if (agentId === null) setStatus(session, 'working');
        if (event.hook_event_name === 'PostToolUse' && event.tool_name === WRAP_UP_TOOL && agentId === null) {
          session.wrapUp = wrapUpOf(event.tool_input);
        }
        if (event.hook_event_name === 'PostToolUse' && ASYNC_QUESTION_TOOLS.has(event.tool_name) && agentId === null) {
          session.openQuestion = { question: firstQuestion(event.tool_input), since: now };
        }
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
        const reason = WAITING_NOTIFICATIONS[type];
        if (reason) waitFor(session, reason, now);
        return [];
      }

      case 'SubagentStart':
        // Counted only: the main agent's status stays as it is (a question it asked stays open).
        if (agentId) session.subagents.add(agentId);
        return [];

      case 'SubagentStop':
        // Only pairs count: the app also reports stops of internal helpers that never started as subagents.
        if (!agentId || !session.subagents.delete(agentId)) return [];
        return this.settleWhere((p) => p.sessionId === session.id && p.agentId === agentId, 'decided-in-app', now);

      case 'SessionEnd':
        setStatus(session, 'ended');
        session.endedAt = now;
        session.subagents.clear();
        session.wrapUp = null;
        session.openQuestion = null;
        return this.settleWhere((p) => p.sessionId === session.id, 'aborted', now);

      default:
        return [];
    }
  }

  /** Puts a permission request on the display. */
  addPermission(id: string, event: PermissionRequestEvent, now: number, holdMs: number, provider: Provider = 'claude'): Permission {
    const session = this.touch(event, now, provider);
    // The main agent asking for a permission means working; while the card is open the status shows
    // 'permission'. A subagent's request leaves the main agent's status (a question it asked) as it is.
    if (session.base !== 'ended' && (event.agent_id ?? null) === null) setStatus(session, 'working');
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

  /** A question to the user (see QUESTION_TOOLS): no card, the session waits for the answer in the app. */
  askUser(event: PermissionRequestEvent, now: number, provider: Provider = 'claude'): void {
    waitFor(this.touch(event, now, provider), 'question', now, firstQuestion(event.tool_input));
  }

  /** How full a session's context is now. Returns false for a session the board does not know (any more). */
  /** A name from elsewhere than the session's events (a transcript, Codex' session index); true when it changed. */
  setTitle(sessionId: string, title: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.title === title) return false;
    session.title = title;
    return true;
  }

  /** The project as the agent's app names it ('' for none) instead of the folder; true when it changed. */
  setProject(sessionId: string, project: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      // Kept for the session's first event; bounded like the sessions.
      this.projectsAhead.delete(sessionId);
      this.projectsAhead.set(sessionId, project);
      if (this.projectsAhead.size > MAX_SESSIONS) this.projectsAhead.delete(this.projectsAhead.keys().next().value!);
      return false;
    }
    if (session.project === project) return false;
    session.project = project;
    return true;
  }

  setContext(sessionId: string, usage: ContextUsage): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.context = { used: usage.used, size: usage.size };
    return true;
  }

  /** Notes an event without changing the status. */
  touch(event: HookEvent, now: number, provider: Provider = 'claude'): Session {
    this.lastEventAt = now;
    let session = this.sessions.get(event.session_id);
    if (!session) {
      this.makeRoom();
      session = {
        id: event.session_id,
        provider,
        cwd: event.cwd ?? '',
        title: null,
        project: this.projectsAhead.get(event.session_id) ?? null,
        base: 'done',
        waitingFor: null,
        waitingSince: null,
        question: null,
        wrapUp: null,
        openQuestion: null,
        subagentAppRequests: new Map(),
        context: null,
        subagents: new Set(),
        lastActivity: now,
        endedAt: null,
      };
      this.sessions.set(session.id, session);
      this.projectsAhead.delete(session.id);
    }
    if (event.cwd) session.cwd = event.cwd;
    if (event.session_title) session.title = event.session_title;
    session.lastActivity = now;
    if (session.base === 'ended' && event.hook_event_name !== 'SessionEnd') {
      // Resumed after its end.
      setStatus(session, 'done');
      session.endedAt = null;
    }
    return session;
  }

  /**
   * Settles an open request from outside: a decision on the display, the end of the hold time, or Claude
   * Code closing the request because it was answered in the app. Returns false if it is unknown or
   * already settled.
   */
  settle(id: string, outcome: PermissionOutcome, now: number): boolean {
    const permission = this.permissions.get(id);
    if (!permission || permission.outcome !== null) return false;
    permission.outcome = outcome;
    permission.resolvedAt = now;
    const session = this.sessions.get(permission.sessionId);
    if (session && session.base !== 'ended' && permission.agentId !== null) {
      // A subagent's request: the main agent's status (a question it asked, and since when) stays. One that
      // goes on to the app's card is kept apart, so the session still says something waits in the app.
      if (outcome === 'handed-to-app' || outcome === 'timed-out') {
        session.subagentAppRequests.set(permission.id, { agentId: permission.agentId, since: now });
      }
    } else if (session && session.base !== 'ended') {
      if (outcome === 'allowed' || outcome === 'denied') setStatus(session, 'working');
      // The app's own card stays open and waits for the user.
      else if (outcome === 'handed-to-app' || outcome === 'timed-out') waitFor(session, 'permission', now);
      // Answered in the app, by allowing, rejecting or cancelling. If the tool runs, PostToolUse says so.
      else setStatus(session, 'done');
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
      .map((s): SessionView => {
        const status = this.statusOf(s);
        const waiting = status === 'waiting' ? waitingOf(s) : null;
        return {
          id: s.id,
          provider: s.provider,
          project: s.project ?? projectName(s.cwd),
          cwd: s.cwd,
          title: s.title,
          status,
          waitingFor: waiting?.reason ?? null,
          waitingSince: waiting?.since ?? null,
          question: waiting?.question ?? null,
          context: s.context,
          subagents: s.subagents.size,
          lastActivity: s.lastActivity,
          endedAt: s.endedAt,
        };
      })
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.lastActivity - a.lastActivity);

    const all = [...this.permissions.values()];
    const open = all.filter((p) => p.outcome === null).sort((a, b) => a.receivedAt - b.receivedAt);
    const settled = all.filter((p) => p.outcome !== null).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
    const permissions = [...open, ...settled].map((p): PermissionView => {
      const session = this.sessions.get(p.sessionId);
      return {
        id: p.id,
        sessionId: p.sessionId,
        provider: session?.provider ?? 'claude',
        project: session?.project ?? projectName(session?.cwd ?? ''),
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
    if (this.pendingOf(session.id).length > 0) return 'permission';
    return waitingOf(session) ? 'waiting' : session.base;
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

/**
 * What a session waits for, most telling first: a question the main agent asked without waiting, the main
 * agent's own question, input or permission, a subagent's request open at the app's card, and last the
 * mere next prompt. Null when it waits for nothing.
 */
function waitingOf(session: Session): { reason: WaitingFor; since: number | null; question: string | null } | null {
  if (session.openQuestion) return { reason: 'question', since: session.openQuestion.since, question: session.openQuestion.question };
  const main = session.base === 'waiting' ? session.waitingFor : null;
  if (main !== null && main !== 'idle') return { reason: main, since: session.waitingSince, question: session.question };
  if (session.subagentAppRequests.size > 0) {
    const since = Math.min(...[...session.subagentAppRequests.values()].map((request) => request.since));
    return { reason: 'permission', since, question: null };
  }
  return main === 'idle' ? { reason: 'idle', since: session.waitingSince, question: null } : null;
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
