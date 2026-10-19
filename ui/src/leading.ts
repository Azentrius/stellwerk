// Which waiting request leads: its card is the only one with a filled Allow. Without the DOM, for the tests.
//
// SPDX-License-Identifier: Apache-2.0

import type { PermissionView } from '../../src/shared/protocol.js';

/**
 * The request whose Allow is filled: the oldest open one, the top card that still waits. The page has one
 * filled button however many cards wait; when that request is decided, the next one takes it over.
 */
export function leadingRequest(permissions: readonly PermissionView[]): string | null {
  return permissions.find((view) => view.outcome === null)?.id ?? null;
}
