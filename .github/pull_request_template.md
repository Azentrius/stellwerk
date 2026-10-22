<!--
Title: short, imperative, English, without a version number. It becomes the commit on main.
Security problems: do not open a pull request, see SECURITY.md.
-->

## What and why

<!-- What does this change, and why? Link the issue if there is one. -->

## How tested

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`, then the four checks in a real Edge (when `ui/` or the hub's answers changed):
      `node tools/check-browser.ts`, `node tools/check-monitors.ts`, `node tools/check-columns.ts`,
      `node tools/check-quiet.ts`
- [ ] The display with `npm run demo` (when `ui/` changed)

<!-- Anything else you tried, and on which setup (Windows version, Claude desktop app, Codex). -->

## Checklist

- [ ] Every new or changed text exists in English and German (both dictionaries in `ui/src/i18n.ts`)
- [ ] The hub still listens on `127.0.0.1` only, checks every request, and allows or denies nothing by itself
- [ ] No new connection to another machine and no program started by the hub (each needs a decision and a review first)
- [ ] The display loads only the hub's own files: nothing inline, no `style` attributes, hook data as text only
- [ ] Tests for the change: the logic in `test/board.test.ts` and friends, behaviour over HTTP and the WebSocket in `test/hub.test.ts`
- [ ] No secrets, tokens, keys, prompts or real data in code, tests or this description
- [ ] SPDX header on every new source file
