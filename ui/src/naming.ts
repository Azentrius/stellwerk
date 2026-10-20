// How a session is named on the display: its name (the title its app gives it) on top, the project below;
// without a title the project is the name. A project may be empty: a chat the app keeps without one.
// Pure, so the tests can use it; used for agents, cards and answers alike. Whose agent it is: the
// provider's name, and "Codex CLI" for a session of Codex' command line.
//
// SPDX-License-Identifier: Apache-2.0

import type { Provider } from '../../src/shared/protocol.js';
import type { Texts } from './i18n.ts';

export function providerName(provider: Provider, terminal: boolean, texts: Pick<Texts, 'providers' | 'codexCli'>): string {
  return terminal ? texts.codexCli : texts.providers[provider];
}

export function naming(projectName: string, title: string | null, sessionId: string): { name: string; project: string } {
  const trimmed = title?.trim();
  if (trimmed) return { name: trimmed, project: trimmed === projectName ? '' : projectName };
  return { name: projectName || sessionId.slice(0, 8), project: '' };
}
