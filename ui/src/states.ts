// The design system's language for states, as the display speaks it: five kinds, each with its fixed icon,
// always with a word. A state never stands in colour alone, and gold is never a state. An error the user
// can fix says how, below what happened. The one place without room for the word is the checks of a pull
// request: there the icon stands alone and the word becomes its name and tooltip (`stateIcon`), so the
// repository can be read.
//
// SPDX-License-Identifier: Apache-2.0

import type { ChecksState, FailingMonitor, GitHubView, HardwareView, SessionStatus, UptimeKumaView } from '../../src/shared/protocol.js';
import type { Texts } from './i18n.ts';
import type { IconName } from './icons.ts';
import { ago, elapsed } from './time.ts';

/** Without judgement, good, a note, attention, an error. */
export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

export interface State {
  tone: Tone;
  /** Neutral states may go without an icon. */
  icon: IconName | null;
  text: string;
}

/** An error the user can fix: what happened, and how to fix it (commands in backticks). Shown as an alert. */
export interface Problem {
  title: string;
  fix: string;
}

const TONE_ICON: Record<Exclude<Tone, 'neutral'>, IconName> = {
  success: 'check-circle',
  info: 'info-circle',
  warning: 'exclamation-triangle',
  danger: 'exclamation-circle',
};

export function state(tone: Tone, text: string, neutralIcon: IconName | null = null): State {
  return { tone, icon: tone === 'neutral' ? neutralIcon : TONE_ICON[tone], text };
}

/**
 * Waiting for approval needs attention: the agent stands until someone decides, and the request goes back
 * to the app when the hold time is up. Waiting for you (a question, some input, a permission open in the
 * app, or idle) has no such deadline, so it is a note.
 */
const SESSION_TONE: Record<SessionStatus, Tone> = {
  permission: 'warning',
  waiting: 'info',
  working: 'success',
  done: 'neutral',
  ended: 'neutral',
};

export function sessionState(status: SessionStatus, texts: Texts): State {
  return state(SESSION_TONE[status], texts.status[status], status === 'ended' ? 'ban' : null);
}

/**
 * Passed is good, failed an error; running and no runs at all carry no judgement yet. Running has the
 * hourglass, since the icon stands alone in the list; no runs leave the place empty.
 */
const CHECKS_TONE: Record<ChecksState, Tone> = {
  passing: 'success',
  failing: 'danger',
  pending: 'neutral',
  none: 'neutral',
};

export function checksState(checks: ChecksState, texts: Texts): State {
  return state(CHECKS_TONE[checks], texts.checks[checks], checks === 'pending' ? 'pending' : null);
}

/** Connected is good; disconnected is an error with a way to fix it. */
export function hubState(connected: boolean, texts: Texts, signedIn = true): State | Problem {
  if (!signedIn) return { title: texts.notSignedIn, fix: texts.notSignedInFix };
  return connected ? state('success', texts.hubConnected) : { title: texts.hubDisconnected, fix: texts.hubDisconnectedFix };
}

/**
 * The GitHub line at the foot of the "waiting for you" column, below the pull requests: when GitHub was
 * last asked, or what failed and how to fix it. Null without a token.
 */
export function githubLine(github: GitHubView | null, now: number, texts: Texts): string | Problem | null {
  if (!github) return null;
  if (github.problem) return { title: texts.github.problem[github.problem], fix: texts.github.fix[github.problem] };
  if (github.syncedAt === null) return texts.github.asking;
  return texts.github.synced(ago(now - github.syncedAt, texts));
}

/**
 * The line below the hardware rows: asking, or why there are no values and how to fix it. Null when the
 * values are there.
 */
export function hardwareLine(hardware: HardwareView | null, texts: Texts): string | Problem | null {
  if (!hardware || hardware.values) return null;
  if (hardware.problem) return { title: texts.hardware.problem[hardware.problem], fix: texts.hardware.fix[hardware.problem] };
  return texts.hardware.asking;
}

/** A failing monitor: down is an error, pending (Uptime Kuma tries again before it says down) needs attention. */
export function monitorState(status: FailingMonitor['status'], texts: Texts): State {
  return state(status === 'down' ? 'danger' : 'warning', texts.monitorStatus[status]);
}

/** How long a monitor fails, as far as the hub saw it: "for 4 min"; nothing when it does not know. */
export function failingFor(monitor: FailingMonitor, now: number, texts: Texts): string {
  return monitor.since === null ? '' : texts.since(elapsed(now - monitor.since, texts));
}

/**
 * The line below the monitors: when Uptime Kuma was last asked, or what failed and how to fix it. Null when
 * Uptime Kuma is not set up.
 */
export function uptimeKumaLine(kuma: UptimeKumaView | null, now: number, texts: Texts): string | Problem | null {
  if (!kuma) return null;
  if (kuma.problem) return { title: texts.uptimeKuma.problem[kuma.problem], fix: texts.uptimeKuma.fix[kuma.problem] };
  if (kuma.updatedAt === null) return texts.uptimeKuma.asking;
  return texts.uptimeKuma.synced(ago(now - kuma.updatedAt, texts));
}

/** Splits a text at its backticks: what stands between them is a command, the rest plain text. */
export function splitCode(text: string): Array<{ text: string; code: boolean }> {
  return text
    .split('`')
    .map((part, i) => ({ text: part, code: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}
