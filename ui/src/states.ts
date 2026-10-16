// The design system's language for states, as the display speaks it: five kinds, each with its fixed icon,
// always with a word. A state never stands in colour alone, and gold is never a state.
//
// SPDX-License-Identifier: Apache-2.0

import type { ChecksState, SessionStatus } from '../../src/shared/protocol.js';
import type { Texts } from './i18n.ts';
import type { IconName } from './icons.ts';

/** Without judgement, good, a note, attention, an error. */
export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

export interface State {
  tone: Tone;
  /** Neutral states may go without an icon. */
  icon: IconName | null;
  text: string;
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

/** Passed is good, failed an error; running and no runs at all carry no judgement yet. */
const CHECKS_TONE: Record<ChecksState, Tone> = {
  passing: 'success',
  failing: 'danger',
  pending: 'neutral',
  none: 'neutral',
};

export function checksState(checks: ChecksState, texts: Texts): State {
  return state(CHECKS_TONE[checks], texts.checks[checks]);
}

export function hubState(connected: boolean, texts: Texts): State {
  return connected ? state('success', texts.hubConnected) : state('danger', texts.hubDisconnected);
}
