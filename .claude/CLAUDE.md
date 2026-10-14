# Notes for working on this repository

## What this is

Stellwerk, a signal box for AI agents: a desk display (1920×720, touch) that shows every running Claude
Code session and lets the user answer permission requests there. A local hub receives Claude Code's HTTP
hooks, holds permission requests and serves the display; the display talks to the hub over a WebSocket.

- Overview and use: `README.md`
- What comes next: `ROADMAP.md`
- What changed: `CHANGELOG.md`
- The product spec (German, internal) lives in `notes/`, which git ignores.

## Working together

- Big picture first in a few sentences, then details; the recommendation first, then the reasons.
- The hub can allow tool calls of agents. For anything that touches that path (hook endpoint, WebSocket,
  decisions, setup), say briefly what the user has to understand to answer for it.

## Repository conventions

The same in every Azentrius repository.

- **Language.** Everything in the repository is English: code, comments, docs, commit messages, pull
  requests, test names and test data. The only German is the German translation. User-facing texts always
  exist in English and German. Answer the user in the language they write in.
- **Versions.** Semantic Versioning; the version lives in exactly one place (`package.json`). Tags are
  `vX.Y.Z`.
- **Changelog.** `CHANGELOG.md`, newest first. Each version gets `## X.Y.Z – YYYY-MM-DD`, a one-line
  summary, then bullets. The pull request that raises the version adds its section.
- **Pull requests.** `main` is protected: every change goes through a pull request and is squash-merged
  once the `test` check is green; the branch is deleted afterwards. The PR title becomes the commit on
  `main`: short, imperative, English, without version numbers.
- **Authorship.** Commits on `main` are authored by the maintainer (the squash merge takes care of that).
  Commits, pull requests and files carry no co-author trailers and no "generated with" lines.

Here the German translation is in `ui/src/i18n.ts`. Its texts follow the product spec and address the
user informally ("Wartet auf dich").

## Repository baseline

The same in every Azentrius repository; keep it when changing the repository or its settings.

- **Security.** `SECURITY.md` with private vulnerability reporting; secret scanning with push protection;
  Dependabot alerts and security updates; Dependabot version updates for every ecosystem in use and for
  GitHub Actions; CodeQL default setup.
- **Branches and tags.** Ruleset `main`: pull request, squash only, linear history, no deletion or force
  push, required check `test`. Ruleset `release tags`: `v*` cannot be deleted or moved.
- **CI.** The job `test` runs every check on each push and pull request. Actions are pinned by commit SHA
  with the version as a comment; checkouts use `persist-credentials: false`; the token is read-only unless
  a job needs more.
- **Licensing.** Apache-2.0: `LICENSE` in the root, an SPDX header in every source file, `NOTICE` for
  third-party material.

Here: the job `test` runs on Windows: `npm ci`, typecheck, build, tests, `npm audit`, and checks that
`CHANGELOG.md` has a section for the version in `package.json`. There is no release workflow yet.

## Layout

```
src/                       the hub and the command line (TypeScript, built to dist/)
  cli.ts                   stellwerk serve | hooks install/uninstall | install/uninstall
  config.ts                paths (%APPDATA%, %LOCALAPPDATA%), config.json, fixed address 127.0.0.1
  token.ts                 the hook token: created once, readable by the current user only
  hub/hub.ts               HTTP endpoint, held requests, WebSocket, security checks
  hub/board.ts             the status model (pure): sessions, statuses, requests, what settles them
  hub/hook-input.ts        zod schemas for the hook data; unknown fields are dropped
  hub/audit.ts             audit.jsonl
  hub/static-files.ts      the display's files, an explicit list read at start
  setup/claude-settings.ts Stellwerk's entries in Claude Code's settings, diff
  setup/windows.ts         user environment variable, firewall rule
  shared/protocol.d.ts     types of the WebSocket messages, shared with the display
ui/                        the display: index.html, app.css, shared design files and fonts
  src/                     the display's TypeScript (built to dist/ui/)
test/                      node:test, run on the TypeScript sources directly
```

## Commands

```sh
npm run typecheck
npm test                 # unit tests and the hub end to end
npm run build            # dist/
node dist/cli.js serve   # --debug-raw writes raw hook data, --simulate-hang leaves status hooks unanswered
```

Node 24 runs the `.ts` sources directly (type stripping), so tests need no build. Imports use `.ts`
extensions; `tsc` rewrites them to `.js` (`rewriteRelativeImportExtensions`). Only erasable syntax
(`erasableSyntaxOnly`): no enums, no namespaces, no parameter properties.

To look at the display without touching the real token and audit log, start a hub from a script with
`startHub` on another port, a temporary audit file and demo hook requests.

## Rules (not negotiable)

1. **Local only.** The hub binds to `127.0.0.1` (constant `HOST`); only the port is configurable. No
   remote access of any kind, in any stage.
2. **Every request is checked.** `Host` on every HTTP request and upgrade; hook requests need the bearer
   token and `application/json`; the WebSocket needs our `Origin` and the page token. Tokens are compared
   in constant time and never logged, never put in URLs.
3. **No automatic decisions.** Only a person allows or denies: no rules, no "always allow".
4. **The hub runs nothing.** It starts no programs and opens no outgoing connections. Only the setup
   commands run `icacls`, `powershell` and `netsh`, with fixed arguments, no shell, values on stdin.
5. **Claude Code never waits on Stellwerk.** Status hooks answer at once; held requests end by the hold
   time, which stays at least 10 s below the hook timeout. Never `onFailure: "block"`.
6. **Display without network.** Only the hub's own files, strict CSP, no inline scripts or styles, no
   `style` attributes (set styles through the DOM). Hook data goes in with `textContent`, never as HTML.
7. **Two languages.** Every new text in both dictionaries of `ui/src/i18n.ts`.
8. **Tests for every change.** Logic in `test/board.test.ts` and friends, behaviour over HTTP and the
   WebSocket in `test/hub.test.ts`.

## Useful knowledge (from probing the Claude desktop app, 2026-10)

- The desktop app on Windows runs the hooks from `%USERPROFILE%\.claude\settings.json`, HTTP and command
  hooks alike, and picks up changes to the file in running sessions.
- `SessionStart` takes no HTTP hooks (only `command` and `mcp_tool`), so Stellwerk has none; a session
  appears with its first event.
- The app shows its own permission card at once, in parallel to the held hook; the first decision
  counts. `allow` and `deny` from the hook work; `deny`'s message reaches Claude word for word. An empty
  answer leaves the app's card open.
- Rejecting in the app (with interrupt) closes the held request; allowing in the app does not. That is
  why `PostToolUse`, `Stop`, `UserPromptSubmit` and `SubagentStop` settle open cards ("decided in the
  app").
- A `Notification` with `permission_prompt` follows every request after about 6 s; it must not change
  anything while the card is open.
- Sessions in auto mode report many `SubagentStop` with an empty `agent_type` and no `SubagentStart`
  (internal helpers); subagents are counted only in pairs by `agent_id`.
- "Allow for this session" in the app switches the session to `acceptEdits`; later edits then fire no
  `PermissionRequest` at all. Keep that in mind when testing.
- `PermissionRequest` input: the common fields, `tool_name`, `tool_input`, `permission_suggestions`, and
  `mcp_server` for MCP tools; no `tool_use_id`.
