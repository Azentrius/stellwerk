// Stellwerk's entries in Codex' hooks (%USERPROFILE%\.codex\hooks.json): adding them, removing exactly
// them, and showing the difference first. Codex' hooks are commands, so each runs Stellwerk's forwarder
// (dist/codex/hook.js), which passes the event to the hub. The Codex app runs new or changed hooks only
// after they were allowed in it.
//
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
import { CODEX_PERMISSION_TIMEOUT_S } from '../config.ts';

type Settings = Record<string, unknown>;
type HookGroup = { matcher?: string; hooks?: unknown[] } & Record<string, unknown>;

export const CODEX_HOOKS_FILE = 'hooks.json';
/** Status events: the forwarder gives up after 3 s, Codex after this. */
const STATUS_TIMEOUT_S = 5;
/** SessionEnd and Interrupt allow at most 3 s. */
const END_TIMEOUT_S = 3;

/** Stellwerk's forwarder in any folder, so a moved installation is still found when uninstalling. */
const FORWARDER = /[\\/]dist[\\/]codex[\\/]hook\.js"?\s*$/;

export function codexHooksFile(codexHome: string): string {
  return path.join(codexHome, CODEX_HOOKS_FILE);
}

/**
 * The command Codex runs: node from the PATH (as the Codex app finds it) and the forwarder, quoted only if
 * its path has a space, which works in cmd and PowerShell alike.
 */
export function forwarderCommand(script: string): string {
  return `node ${/\s/.test(script) ? `"${script}"` : script}`;
}

function handler(script: string, timeout: number) {
  return { type: 'command', command: forwarderCommand(script), timeout };
}

/** The hooks, by event. No PreToolUse: the hub needs only what was asked and what ran. */
export function stellwerkCodexHooks(script: string): Record<string, HookGroup[]> {
  const status = () => [{ hooks: [handler(script, STATUS_TIMEOUT_S)] }];
  return {
    SessionStart: status(),
    UserPromptSubmit: status(),
    PermissionRequest: [{ hooks: [handler(script, CODEX_PERMISSION_TIMEOUT_S)] }],
    PostToolUse: status(),
    Stop: status(),
    Interrupt: [{ hooks: [handler(script, END_TIMEOUT_S)] }],
    SubagentStart: status(),
    SubagentStop: status(),
    SessionEnd: [{ hooks: [handler(script, END_TIMEOUT_S)] }],
  };
}

export function isStellwerkCodexHandler(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { type, command } = value as Record<string, unknown>;
  return type === 'command' && typeof command === 'string' && FORWARDER.test(command);
}

/** The hooks without any of Stellwerk's handlers; groups and events left empty go as well. */
export function withoutStellwerkCodexHooks(settings: Settings): Settings {
  const next = structuredClone(settings);
  const hooks = next.hooks;
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return next;
  const events = hooks as Record<string, unknown>;
  for (const [event, groups] of Object.entries(events)) {
    if (!Array.isArray(groups)) continue;
    const kept = (groups as HookGroup[])
      .map((group) =>
        Array.isArray(group?.hooks) && group.hooks.some(isStellwerkCodexHandler)
          ? { ...group, hooks: group.hooks.filter((h) => !isStellwerkCodexHandler(h)) }
          : group,
      )
      .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
    if (kept.length > 0) events[event] = kept;
    else delete events[event];
  }
  if (Object.keys(events).length === 0) delete next.hooks;
  return next;
}

/** The hooks with Stellwerk's (replacing earlier ones), everything else unchanged. */
export function withStellwerkCodexHooks(settings: Settings, script: string): Settings {
  const next = withoutStellwerkCodexHooks(settings);
  const hooks = (typeof next.hooks === 'object' && next.hooks !== null ? next.hooks : {}) as Record<string, unknown>;
  for (const [event, groups] of Object.entries(stellwerkCodexHooks(script))) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...existing, ...groups];
  }
  next.hooks = hooks;
  return next;
}

/** The commands of Stellwerk's handlers in Codex' hooks; none when there are none. */
export function stellwerkCodexCommands(settings: Settings): string[] {
  const hooks = settings.hooks;
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return [];
  return Object.values(hooks as Record<string, unknown>)
    .flatMap((groups) => (Array.isArray(groups) ? (groups as HookGroup[]) : []))
    .flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []))
    .filter(isStellwerkCodexHandler)
    .map((handler) => (handler as { command: string }).command);
}
