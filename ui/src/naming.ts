// How a session is named on the display: its name (the title its app gives it) on top, the project below;
// without a title the project is the name. A project may be empty: a chat the app keeps without one.
// Pure, so the tests can use it; used for agents, cards and answers alike.
//
// SPDX-License-Identifier: Apache-2.0

export function naming(projectName: string, title: string | null, sessionId: string): { name: string; project: string } {
  const trimmed = title?.trim();
  if (trimmed) return { name: trimmed, project: trimmed === projectName ? '' : projectName };
  return { name: projectName || sessionId.slice(0, 8), project: '' };
}
