// What the hub and the display say to each other over the WebSocket. Types only, shared by both.
//
// SPDX-License-Identifier: Apache-2.0

/** Status of a session as the display shows it, most urgent first. */
export type SessionStatus = 'permission' | 'waiting' | 'working' | 'done' | 'ended';

/**
 * What a waiting session waits for: an answer to a question, some input, a permission whose card is open
 * in the app, or only the next prompt.
 */
export type WaitingFor = 'question' | 'input' | 'permission' | 'idle';

export interface SessionView {
  id: string;
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
  /** Subagents started and not yet stopped. */
  subagents: number;
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

export interface HubView {
  startedAt: number;
  lastEventAt: number | null;
  sound: boolean;
  /** Fingerprint of the display files the hub serves; a page served with another one loads itself again. */
  build: string;
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
export type GitHubProblem = 'rejected' | 'forbidden' | 'not-found' | 'unreachable' | 'unexpected';

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
