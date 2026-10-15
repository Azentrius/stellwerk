// After an update the hub serves a newer display, but an open page only reconnects its WebSocket and
// keeps running the old code. The page knows the build it was served with, the hub names its own in every
// state; when they differ, the page loads itself again, once per build.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * True when the page should load itself again: both builds are known, they differ, and no reload for the
 * hub's build was tried yet (so a page that somehow stays old cannot reload forever).
 */
export function shouldReload(pageBuild: string, hubBuild: string, triedFor: string | null): boolean {
  return /^[0-9a-f]{16}$/.test(pageBuild) && hubBuild !== '' && pageBuild !== hubBuild && triedFor !== hubBuild;
}
