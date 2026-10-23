// Stellwerk's entries in Claude Code's settings (%USERPROFILE%\.claude\settings.json): adding them,
// removing exactly them, and showing the difference first.
//
// SPDX-License-Identifier: Apache-2.0

import os from 'node:os';
import path from 'node:path';
import { HOOK_PATH, HOST, PERMISSION_HOOK_TIMEOUT_S } from '../config.ts';

export const TOKEN_ENV = 'STELLWERK_TOKEN';
export const DEFAULT_SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

/** Matches Stellwerk's hook URL on any port, so a changed port is still found when uninstalling. */
const STELLWERK_URL = new RegExp(`^http://${HOST.replaceAll('.', '\\.')}:\\d+${HOOK_PATH}$`);

/** Status hooks answer at once; short timeouts keep a hung hub from slowing Claude Code down. */
const STATUS_TIMEOUT_S = 3;
/** SessionEnd hooks share a budget of 1.5 s. */
const SESSION_END_TIMEOUT_S = 1;

type Settings = Record<string, unknown>;
type HookGroup = { matcher?: string; hooks?: unknown[] } & Record<string, unknown>;

export function hookUrl(port: number): string {
  return `http://${HOST}:${port}${HOOK_PATH}`;
}

/**
 * The desktop app gives each of its sessions its own id in this variable (`local_…`); a hook sends it along,
 * so a tap on the display can open the session in the app. Outside the app it is not set and stays empty.
 */
export const APP_SESSION_ENV = 'CLAUDE_CODE_HOST_SESSION_ID';

function handler(port: number, timeout: number) {
  return {
    type: 'http',
    url: hookUrl(port),
    timeout,
    headers: { Authorization: `Bearer $${TOKEN_ENV}`, 'X-Stellwerk-App-Session': `$${APP_SESSION_ENV}` },
    allowedEnvVars: [TOKEN_ENV, APP_SESSION_ENV],
  };
}

/**
 * The hooks, by event. There is no SessionStart hook: that event takes no HTTP hooks, and a session
 * appears with its first event instead. PostToolUse and PostToolUseFailure tell the display that a
 * request was allowed in the app. Notification takes every type and Elicitation (an MCP server asking the
 * user during its tool call) is answered at once and empty, so the app shows its own dialog: the hub
 * notes in its log what it does not show, to find prompts that never reach the display.
 */
export function stellwerkHooks(port: number): Record<string, HookGroup[]> {
  const status = () => [{ hooks: [handler(port, STATUS_TIMEOUT_S)] }];
  return {
    UserPromptSubmit: status(),
    PermissionRequest: [{ hooks: [handler(port, PERMISSION_HOOK_TIMEOUT_S)] }],
    Notification: status(),
    Elicitation: status(),
    PostToolUse: status(),
    PostToolUseFailure: status(),
    Stop: status(),
    SubagentStart: status(),
    SubagentStop: status(),
    SessionEnd: [{ hooks: [handler(port, SESSION_END_TIMEOUT_S)] }],
  };
}

export function isStellwerkHandler(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const url = (value as Record<string, unknown>).url;
  return typeof url === 'string' && STELLWERK_URL.test(url);
}

/** The settings without any of Stellwerk's handlers; groups and events left empty go as well. */
export function withoutStellwerkHooks(settings: Settings): Settings {
  const next = structuredClone(settings);
  const hooks = next.hooks;
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return next;
  const events = hooks as Record<string, unknown>;
  for (const [event, groups] of Object.entries(events)) {
    if (!Array.isArray(groups)) continue;
    const kept = (groups as HookGroup[])
      .map((group) =>
        Array.isArray(group?.hooks) && group.hooks.some(isStellwerkHandler)
          ? { ...group, hooks: group.hooks.filter((h) => !isStellwerkHandler(h)) }
          : group,
      )
      .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
    if (kept.length > 0) events[event] = kept;
    else delete events[event];
  }
  if (Object.keys(events).length === 0) delete next.hooks;
  return next;
}

/** The settings with Stellwerk's hooks (replacing earlier ones), everything else unchanged. */
export function withStellwerkHooks(settings: Settings, port: number): Settings {
  const next = withoutStellwerkHooks(settings);
  const hooks = (typeof next.hooks === 'object' && next.hooks !== null ? next.hooks : {}) as Record<string, unknown>;
  for (const [event, groups] of Object.entries(stellwerkHooks(port))) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...existing, ...groups];
  }
  next.hooks = hooks;
  return next;
}

export function formatSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** A line diff (longest common subsequence), each line prefixed with "  ", "- " or "+ ". */
export function lineDiff(before: string, after: string): string[] {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(`- ${a[i++]}`);
    } else {
      out.push(`+ ${b[j++]}`);
    }
  }
  while (i < a.length) out.push(`- ${a[i++]}`);
  while (j < b.length) out.push(`+ ${b[j++]}`);
  return out;
}
