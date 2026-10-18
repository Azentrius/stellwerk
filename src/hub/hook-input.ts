// Checks the JSON Claude Code posts to the hook endpoint. Fields Stellwerk does not use are dropped
// without complaint, because the input of some events is not fully documented.
//
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';

const text = (max: number) => z.string().max(max);

const common = {
  session_id: z.string().min(1).max(200),
  cwd: text(4096).optional(),
  session_title: text(1000).optional(),
  /** Present when the event comes from a subagent. */
  agent_id: text(200).optional(),
  agent_type: text(200).optional(),
  /** The session's transcript; the hub reads only the token counts of its last answer from it. */
  transcript_path: text(4096).optional(),
};

const toolName = z.string().min(1).max(500);
const toolInput = z.record(z.string(), z.unknown());

const knownEvent = z.discriminatedUnion('hook_event_name', [
  z.object({ hook_event_name: z.literal('UserPromptSubmit'), ...common }),
  z.object({ hook_event_name: z.literal('Stop'), ...common }),
  z.object({
    hook_event_name: z.literal('PermissionRequest'),
    ...common,
    tool_name: toolName,
    tool_input: toolInput.default({}),
    mcp_server: z.object({ name: text(500).optional() }).optional(),
  }),
  z.object({ hook_event_name: z.literal('PostToolUse'), ...common, tool_name: toolName, tool_input: toolInput.optional() }),
  z.object({
    hook_event_name: z.literal('PostToolUseFailure'),
    ...common,
    tool_name: toolName,
    tool_input: toolInput.optional(),
  }),
  z.object({ hook_event_name: z.literal('Notification'), ...common, notification_type: text(100).optional() }),
  // An MCP server asks the user something during its tool call. Only who asks is kept, not what.
  z.object({ hook_event_name: z.literal('Elicitation'), ...common, mcp_server_name: text(500).optional(), mode: text(50).optional() }),
  z.object({ hook_event_name: z.literal('SubagentStart'), ...common }),
  z.object({ hook_event_name: z.literal('SubagentStop'), ...common }),
  z.object({ hook_event_name: z.literal('SessionEnd'), ...common, reason: text(100).optional() }),
]);

/** Any other event still tells which session is alive. */
const otherEvent = z.object({ hook_event_name: z.string().min(1).max(100), ...common });

export type KnownEvent = z.infer<typeof knownEvent>;
export type OtherEvent = z.infer<typeof otherEvent> & { other: true };
export type HookEvent = KnownEvent | OtherEvent;
export type PermissionRequestEvent = Extract<KnownEvent, { hook_event_name: 'PermissionRequest' }>;

const KNOWN_EVENTS: ReadonlySet<string> = new Set(knownEvent.options.map((option) => option.shape.hook_event_name.value));

export type ParseResult = { ok: true; event: HookEvent } | { ok: false; error: string };

export function parseHookInput(body: unknown): ParseResult {
  const name = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).hook_event_name : undefined;
  if (typeof name === 'string' && KNOWN_EVENTS.has(name)) {
    const parsed = knownEvent.safeParse(body);
    return parsed.success ? { ok: true, event: parsed.data } : { ok: false, error: z.prettifyError(parsed.error) };
  }
  const parsed = otherEvent.safeParse(body);
  return parsed.success
    ? { ok: true, event: { ...parsed.data, other: true } }
    : { ok: false, error: z.prettifyError(parsed.error) };
}

export function isOther(event: HookEvent): event is OtherEvent {
  return 'other' in event;
}
