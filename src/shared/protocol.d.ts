// What the hub and the display say to each other over the WebSocket. Types only, shared by both.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Status of a session as the display shows it, most urgent first. 'unknown': shown since a restart of the
 * hub, which does not know what the session did in between, until its next event.
 */
export type SessionStatus = 'permission' | 'waiting' | 'working' | 'done' | 'unknown' | 'ended';

/**
 * What a waiting session waits for: an answer to a question, some input, a permission whose card is open
 * in the app, or only the next prompt.
 */
export type WaitingFor = 'question' | 'input' | 'permission' | 'idle';

/** Whose agent a session is: Claude Code (the Claude app or CLI) or Codex (the Codex app). */
export type Provider = 'claude' | 'codex';

/** Tokens in a session's context now, and its model's context window. */
export interface ContextUsage {
  used: number;
  size: number;
  /** The model of the last answer, as the transcript names it; absent when not known (Codex). */
  model?: string;
}

export interface SessionView {
  id: string;
  provider: Provider;
  /** Last part of the working directory. */
  project: string;
  cwd: string;
  title: string | null;
  status: SessionStatus;
  /** Set while the status is 'waiting'. */
  waitingFor: WaitingFor | null;
  waitingSince: number | null;
  /** While waiting for an answer: the question asked, from AskUserQuestion or the app's end-of-turn box. */
  question: string | null;
  /** How full the context is, from the transcript's token counts; null until known. */
  context: ContextUsage | null;
  /** Subagents started and not yet stopped. */
  subagents: number;
  /** The tool that ran last in the session (any agent of it), and when; null until one ran. */
  lastTool: { name: string; at: number } | null;
  /** Runs in Codex' command line, not in an app: its own card for a request shows in the terminal. */
  terminal: boolean;
  lastActivity: number;
  endedAt: number | null;
}

/** How a permission request ended. */
export type PermissionOutcome =
  | 'allowed'
  | 'denied'
  | 'handed-to-app'
  | 'decided-in-app'
  | 'aborted'
  | 'timed-out';

export interface PermissionView {
  id: string;
  sessionId: string;
  provider: Provider;
  /** The session runs in Codex' command line: the request's own card shows in the terminal. */
  terminal: boolean;
  project: string;
  title: string | null;
  tool: string;
  /** The complete tool input, as Claude Code sent it. */
  input: Record<string, unknown>;
  mcpServer: string | null;
  receivedAt: number;
  /** When the hub hands the request to the app if nobody decides. */
  holdUntil: number;
  /** Null while the request is open. */
  outcome: PermissionOutcome | null;
  resolvedAt: number | null;
}

/** One of the last decisions on permission requests, for the display; never the whole input. */
export interface DecisionView {
  id: string;
  at: number;
  outcome: PermissionOutcome;
  tool: string;
  /** A short line of what it was about: a command's first line, a file, an address; may be empty. */
  what: string;
  project: string;
  title: string | null;
  /** Null for decisions read from an audit log written before it named the provider. */
  provider: Provider | null;
}

/**
 * Why the hub turned a request away, as the display names it: a missing or wrong token, hook data it could
 * not take, a request from elsewhere (foreign host or origin, an unknown path or target), a display that is
 * not signed in or broke its connection. Never the request's content.
 */
export type RejectionReason = 'token' | 'hook-data' | 'foreign' | 'display';

export interface HubView {
  startedAt: number;
  lastEventAt: number | null;
  sound: boolean;
  /** The display dims after this long without anything new and without an open request; 0: never. */
  quietAfterMs: number;
  /** An open request reminds after this long: its card pulses, with sound the tones come again; 0: never. */
  remindAfterMs: number;
  /** Fingerprint of the display files the hub serves; a page served with another one loads itself again. */
  build: string;
  /**
   * Requests turned away since the last quiet hour: how many, the last one's time and reason, and until
   * when the display mentions them (an hour after the last); null when there were none.
   */
  rejected: { count: number; lastAt: number; until: number; reason: RejectionReason } | null;
  /** The raw hook log is on: it holds prompts and code. */
  rawLog: boolean;
  /** A newer release of Stellwerk on GitHub, its version (X.Y.Z); null when there is none or it is not known. */
  newRelease: string | null;
}

/** The Actions runs on a pull request's head commit, summed up. */
export type ChecksState = 'passing' | 'failing' | 'pending' | 'none';

export interface PullRequestView {
  repo: string;
  number: number;
  title: string;
  author: string;
  draft: boolean;
  updatedAt: number;
  checks: ChecksState;
}

/** Why the last question to GitHub failed. */
export type GitHubProblem = 'rejected' | 'forbidden' | 'not-found' | 'unreachable' | 'unexpected' | 'too-many';

export interface GitHubView {
  owner: string;
  /** When the list was last brought up to date; null before the first success. */
  syncedAt: number | null;
  problem: GitHubProblem | null;
}

/** Load in percent and temperature in °C of a processor; null where the sensor gives nothing. */
export interface Gauge {
  load: number | null;
  temperature: number | null;
}

export interface MemoryGauge {
  /** In percent. */
  load: number | null;
  /** In GB. */
  used: number | null;
  total: number | null;
}

/** What LibreHardwareMonitor reports, picked out: null for a part it does not report. */
export interface HardwareValues {
  cpu: Gauge | null;
  gpu: Gauge | null;
  memory: MemoryGauge | null;
}

/** Why the last question to LibreHardwareMonitor failed. */
export type HardwareProblem = 'not-running' | 'rejected' | 'unexpected';

export interface HardwareView {
  /** Null before the first answer and while there is a problem: old values would mislead. */
  values: HardwareValues | null;
  updatedAt: number | null;
  problem: HardwareProblem | null;
}

/** A monitor of Uptime Kuma that fails: down, or pending (Uptime Kuma tries again before it says down). */
export interface FailingMonitor {
  name: string;
  status: 'down' | 'pending';
  /** Since when the hub sees it so; null when it already was at the first answer the hub got. */
  since: number | null;
}

export interface MonitorCounts {
  /** Down first, then pending; the most recent first within each. */
  failing: FailingMonitor[];
  up: number;
  maintenance: number;
}

/** Why the last question to Uptime Kuma failed. */
export type UptimeKumaProblem = 'unreachable' | 'rejected' | 'unexpected';

export interface UptimeKumaView {
  /** Null before the first answer and while there is a problem: old states would mislead. */
  monitors: MonitorCounts | null;
  updatedAt: number | null;
  problem: UptimeKumaProblem | null;
}

/** One usage limit of a plan: how much of it is used in its window (five hours, a week). */
export interface PlanLimit {
  /** In percent of the limit, 0 to 100. */
  used: number;
  /** The window's length: 300 for five hours, 10080 for a week. */
  windowMinutes: number;
  /** When the window starts again; null when not recorded. */
  resetsAt: number | null;
  /** A model's own limit ("Fable"); absent for the limit of all models. */
  model?: string;
}

/** How much of a plan's usage limits is used, as the agent recorded it last. */
export interface PlanView {
  provider: Provider;
  /** Shortest window first. */
  limits: PlanLimit[];
  /** When the agent recorded these values. */
  recordedAt: number;
}

export interface StateMessage {
  type: 'state';
  /** The hub's clock when it sent the message. */
  now: number;
  sessions: SessionView[];
  /** Open requests (oldest first), then the ones settled in the last few seconds. */
  permissions: PermissionView[];
  /** Open pull requests, most recently updated first; empty without a GitHub token. */
  pullRequests: PullRequestView[];
  hub: HubView;
  /** Null when no GitHub token is set up. */
  github: GitHubView | null;
  /** Null when the hardware monitor is not set up. */
  hardware: HardwareView | null;
  /** The monitors of Uptime Kuma; null when it is not set up. */
  uptimeKuma: UptimeKumaView | null;
  /** The usage of the plans' limits, one entry per provider that recorded any. */
  plans: PlanView[];
  /** The last decisions on permission requests, newest first, also those of before a restart. */
  decisions: DecisionView[];
}

export interface DecisionResultMessage {
  type: 'decision-result';
  id: string;
  ok: boolean;
  reason?: 'already-decided' | 'unknown';
}

export type ServerMessage = StateMessage | DecisionResultMessage;

/** `app` releases the request without a decision; the app's own card then takes it. */
export type Decision = 'allow' | 'deny' | 'app';

export interface DecideMessage {
  type: 'decide';
  id: string;
  decision: Decision;
}

export type ClientMessage = DecideMessage;
