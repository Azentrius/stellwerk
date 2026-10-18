// Codex' hook events, as its desktop app sends them (probed 2026-10-18): checked, and turned into the shape
// the board knows from the other agents. Fields Stellwerk does not use are dropped.
//
// What differs: Interrupt ends a turn like Stop; there is no Notification and no session title; and the
// app runs short helper sessions of its own for every prompt, which have no transcript and are no agents.
//
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import type { HookEvent } from './hook-input.ts';

const text = (max: number) => z.string().max(max);

const common = {
  session_id: z.string().min(1).max(200),
  cwd: text(4096).optional(),
  /** Missing (or null) for the app's helper sessions. */
  transcript_path: text(4096).nullable().optional(),
  model: text(200).optional(),
};

const toolName = z.string().min(1).max(500);
const toolInput = z.record(z.string(), z.unknown());

const knownEvent = z.discriminatedUnion('hook_event_name', [
  z.object({ hook_event_name: z.literal('SessionStart'), ...common, source: text(50).optional() }),
  z.object({ hook_event_name: z.literal('UserPromptSubmit'), ...common }),
  z.object({ hook_event_name: z.literal('PermissionRequest'), ...common, tool_name: toolName, tool_input: toolInput.default({}) }),
  z.object({ hook_event_name: z.literal('PostToolUse'), ...common, tool_name: toolName, tool_input: toolInput.optional() }),
  z.object({ hook_event_name: z.literal('Stop'), ...common }),
  z.object({ hook_event_name: z.literal('Interrupt'), ...common }),
  z.object({ hook_event_name: z.literal('SessionEnd'), ...common, reason: text(100).optional() }),
  z.object({ hook_event_name: z.literal('SubagentStart'), ...common, agent_id: text(200).optional(), agent_type: text(200).optional() }),
  z.object({ hook_event_name: z.literal('SubagentStop'), ...common, agent_id: text(200).optional() }),
]);
const otherEvent = z.object({ hook_event_name: z.string().min(1).max(100), ...common });

const KNOWN_EVENTS: ReadonlySet<string> = new Set(knownEvent.options.map((option) => option.shape.hook_event_name.value));

export type CodexParseResult =
  | {
      ok: true;
      /** In the board's shape. */
      event: HookEvent;
      /** One of the app's helper sessions (no transcript): not shown. */
      helper: boolean;
      transcriptPath: string | null;
    }
  | { ok: false; error: string };

export function parseCodexInput(body: unknown): CodexParseResult {
  const name = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).hook_event_name : undefined;
  const known = typeof name === 'string' && KNOWN_EVENTS.has(name);
  const parsed = known ? knownEvent.safeParse(body) : otherEvent.safeParse(body);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const data = parsed.data;
  const transcriptPath = data.transcript_path ? data.transcript_path : null;
  const base = { session_id: data.session_id, cwd: data.cwd, transcript_path: transcriptPath ?? undefined };
  let event: HookEvent;
  if (!known) {
    event = { ...base, hook_event_name: data.hook_event_name, other: true } as HookEvent;
  } else {
    const e = data as z.infer<typeof knownEvent>;
    switch (e.hook_event_name) {
      case 'SessionStart':
        event = { ...base, hook_event_name: 'SessionStart', other: true } as HookEvent;
        break;
      case 'Interrupt':
        // The turn ends, as with Stop.
        event = { ...base, hook_event_name: 'Stop' };
        break;
      case 'PermissionRequest':
        event = { ...base, hook_event_name: 'PermissionRequest', tool_name: e.tool_name, tool_input: e.tool_input };
        break;
      case 'PostToolUse':
        event = { ...base, hook_event_name: 'PostToolUse', tool_name: e.tool_name, tool_input: e.tool_input };
        break;
      case 'SessionEnd':
        event = { ...base, hook_event_name: 'SessionEnd', reason: e.reason };
        break;
      case 'SubagentStart':
        event = { ...base, hook_event_name: 'SubagentStart', agent_id: e.agent_id, agent_type: e.agent_type };
        break;
      case 'SubagentStop':
        event = { ...base, hook_event_name: 'SubagentStop', agent_id: e.agent_id };
        break;
      case 'Stop':
        event = { ...base, hook_event_name: 'Stop' };
        break;
      case 'UserPromptSubmit':
        event = { ...base, hook_event_name: 'UserPromptSubmit' };
        break;
    }
  }
  return { ok: true, event, helper: transcriptPath === null, transcriptPath };
}
