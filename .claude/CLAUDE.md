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

- **Security.** `SECURITY.md` with private vulnerability reporting; secret scanning with push
  protection; Dependabot alerts and security updates; Dependabot version updates for every
  ecosystem in use and for GitHub Actions; CodeQL default setup.
- **Branches and tags.** Ruleset `main`: pull request, squash only, linear history, no deletion or
  force push, required check `test`. Ruleset `release tags`: `v*` cannot be deleted or moved.
- **CI.** The job `test` runs every test and every lint on each push and pull request. Actions are
  pinned by commit SHA with the version as a comment; checkouts use `persist-credentials: false`;
  the token is read-only unless a job needs more. Check tools are pinned as well, so Dependabot keeps
  them current.
- **Releases.** Only the `release` workflow makes releases, on request, from `main`: it checks the
  version against the code and the existing tags, runs all tests, builds the artifact with
  `SHA256SUMS`, signs a build provenance (`gh attestation verify`) and takes the notes from
  `CHANGELOG.md`. Releases are immutable. Files that are not for users stay out of the artifact.
- **Licensing.** Apache-2.0: `LICENSE` in the root, an SPDX header in every source file, `NOTICE`
  for third-party material.

Here: the job `test` runs on Windows: `npm ci`, typecheck, build, tests, `npm audit`, the changelog section
for the version in `package.json`, and the package (`npm run package`) unpacked and installed as a user
would (`npm ci --omit=dev`), with the hub started and its display files fetched. The `release` workflow
runs the same tests on Windows, then packages on Ubuntu with `SOURCE_DATE_EPOCH` from the commit; it needs
a dated changelog section (`tools/release-notes.ts --require-date`). The packaging job can write releases
and sign the provenance, so it installs with `npm ci --ignore-scripts`. Every job has a `timeout-minutes`.

## Layout

```
src/                       the hub and the command line (TypeScript, built to dist/)
  cli.ts                   stellwerk serve | hooks | install/uninstall | autostart | github | hardware
  config.ts                paths (%APPDATA%, %LOCALAPPDATA%), config.json, fixed address 127.0.0.1
  token.ts                 the hook token and the GitHub token, readable by the current user only
  hub/hub.ts               HTTP endpoint, held requests, WebSocket, security checks
  hub/board.ts             the status model (pure): sessions, statuses, requests, what settles them
  hub/github.ts            open pull requests and their Actions runs from api.github.com
  hub/hardware.ts          values from LibreHardwareMonitor's data.json; its settings file
  hub/hook-input.ts        zod schemas for the hook data; unknown fields are dropped
  hub/audit.ts             audit.jsonl
  hub/static-files.ts      the display's files, an explicit list read at start, and their fingerprint
  setup/claude-settings.ts Stellwerk's entries in Claude Code's settings, diff
  setup/windows.ts         user environment variable, firewall rule, screens, Task Scheduler
  setup/autostart.ts       the two logon tasks (pure): screen choice, command lines, task XML
  setup/hardware.ts        LibreHardwareMonitor: pinned archive, unzip, its settings, its logon task
  shared/protocol.d.ts     types of the WebSocket messages, shared with the display
ui/                        the display: index.html, app.css, shared design files and fonts
  src/                     the display's TypeScript (built to dist/ui/)
test/                      node:test, run on the TypeScript sources directly
tools/
  package.ts               the release zip (own minimal zip writer, reproducible) and SHA256SUMS
  release-notes.ts         a version's section of CHANGELOG.md
  demo.ts                  a hub with made-up sessions and requests (port 4781)
docs/display.png           the README screenshot: the demo, ?lang=en, Edge headless at 1920×720
.github/workflows/         test (every push and PR), release (on request)
```

## Commands

```sh
npm run typecheck
npm test                 # unit tests and the hub end to end
npm run build            # dist/
npm run demo             # demo hub on 4781: own token, audit log in a temporary folder
npm run package          # build/stellwerk-VERSION.zip + SHA256SUMS (needs the build)
node dist/cli.js serve   # --debug-raw writes raw hook data, --simulate-hang leaves status hooks unanswered
```

Node 24 runs the `.ts` sources directly (type stripping), so tests need no build. Imports use `.ts`
extensions; `tsc` rewrites them to `.js` (`rewriteRelativeImportExtensions`). Only erasable syntax
(`erasableSyntaxOnly`): no enums, no namespaces, no parameter properties. Output uses LF line endings
(`newLine`), so the package is the same on every platform.

To look at the display without touching the real token and audit log, use `npm run demo`. The README
screenshot is taken from it:
`msedge --headless=new --window-size=1920,720 --virtual-time-budget=6000 --screenshot=docs\display.png "http://127.0.0.1:4781/?lang=en"`.

## Releases and the repository

- The version lives in `package.json` (`npm version --no-git-tag-version X.Y.Z` keeps the lockfile in
  step).
- Release: raise the version, give its `CHANGELOG.md` section the date, merge, then Actions › release ›
  Run workflow on `main`. The workflow checks the version, runs all tests, builds the package and creates
  tag and release.
- The package takes only `dist/`, `ui/` without its sources, `package.json`, the lockfile and the
  license, readme and changelog (`tools/package.ts`); `test/release.test.ts` checks that.

## Rules (not negotiable)

1. **Local only.** The hub binds to `127.0.0.1` (constant `HOST`); only the port is configurable. No
   remote access of any kind, in any stage.
2. **Every request is checked.** `Host` on every HTTP request and upgrade; hook requests need the bearer
   token and `application/json`; the WebSocket needs our `Origin` and the page token. Tokens are compared
   in constant time and never logged, never put in URLs. Every rejection is reported on the console
   (`reject()` in `hub.ts`, throttled per reason), so a setup problem is visible.
3. **No automatic decisions.** Only a person allows or denies: no rules, no "always allow".
4. **The hub runs nothing, and talks only to GitHub and LibreHardwareMonitor.** It starts no programs.
   Its one connection to another machine is to `api.github.com` (`GITHUB_API` in `hub/github.ts`), only
   with a fine-grained read-only token; locally it asks only `http://127.0.0.1:8085/data.json`
   (`LHM_URL` in `hub/hardware.ts`), only when set up. No redirects, every answer checked with zod. Any
   other destination needs a decision and a review first. Only the setup commands run `icacls`,
   `powershell`, `netsh` and `schtasks`, with fixed arguments, no shell, values on stdin; PowerShell
   scripts go in with `-EncodedCommand`. The only download is `stellwerk hardware install`: one archive,
   pinned by URL, size and SHA-256 in `setup/hardware.ts`; a new version is a pull request.
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
- Answering in the app closes the held request: rejecting (with interrupt) and, since the acceptance on
  2026-10-15, allowing as well. In the first probe allowing kept it open, so `PostToolUse`, `Stop`,
  `UserPromptSubmit` and `SubagentStop` still settle open cards. Either way the outcome is "decided in
  the app"; the hub cannot tell how it was decided.
- `AskUserQuestion` arrives as a `PermissionRequest`. It is a question, not a permission: the hub sends
  it straight back (`QUESTION_TOOLS` in `board.ts`) and the session waits for the user.
- With the hub down, the desktop app shows no hook errors at all; Claude Code just asks in the app.
- A `Notification` with `permission_prompt` follows every request after about 6 s; it must not change
  anything while the card is open.
- Sessions in auto mode report many `SubagentStop` with an empty `agent_type` and no `SubagentStart`
  (internal helpers); subagents are counted only in pairs by `agent_id`.
- After a file edit was allowed in the app, the session switched to `acceptEdits` (the request carries
  that as a `permission_suggestions` entry); later edits then fire no `PermissionRequest` at all. The
  app's card has no separate "for this session" option. Keep that in mind when testing.
- `PermissionRequest` input: the common fields, `tool_name`, `tool_input`, `permission_suggestions`, and
  `mcp_server` for MCP tools; no `tool_use_id`.

## Useful knowledge (GitHub)

- Fine-grained tokens cannot get the "Checks" permission, so check runs are not readable. The state of a
  pull request comes from the Actions runs on its head commit (`/actions/runs?head_sha=`), which needs
  "Actions: Read"; code scanning's default setup and Dependabot show up there too.
- `/orgs/{owner}/repos` answers 404 for a user; the watcher then asks `/users/{owner}/repos`.
- `npm run demo` answers the hub's GitHub questions itself (a stand-in `fetch`), so it never goes online.

## Useful knowledge (LibreHardwareMonitor 0.9.6, from its source)

- The web server falls back to `http://+:8085/` (every interface) when `listenerIp` is not one of the
  host's addresses; 127.0.0.1 never is. Hence the firewall rule for 8085.
- Besides `data.json` it serves `/Sensor?action=Set&id=…&value=…` (also by GET) to set fan controls,
  and answers `data.json` with `Access-Control-Allow-Origin: *`. Without the password any web page in a
  local browser could read the values or set fans; that is why `stellwerk hardware install` turns the
  password on.
- It stores `authenticationPassword` as the SHA-256 of what it expects and hashes it again when it
  starts, so it accepts the value that was in the file at its start, and writes the next one when it
  ends (also at logoff). The hub reads the file again after a 401.
- `data.json` values are strings formatted in LibreHardwareMonitor's language ("45,5 °C" on a German
  Windows); `RawValue` keeps the base unit. Sensor ids are `/<part>/<n>/<type>/<n>`, e.g.
  `/intelcpu/0/temperature/13`, `/ram/load/0`, `/gpu-nvidia/0/load/0`.
- Settings live next to the program in `LibreHardwareMonitor.config` (appSettings XML), written when it
  ends. It makes no outgoing connections of its own (no update check).

## Useful knowledge (start with Windows)

- A Task Scheduler task that runs `node.exe` directly opens a console window. `conhost.exe --headless`
  hosts it without one, but ending the task (`schtasks /End`, Task Scheduler's End) ends only conhost;
  node would run on. Hence `serve --exit-with-parent`: the hub checks its parent every 2 s and stops
  when it is gone. Its output goes to `hub.log` (`--log-file`).
- Edge places its window by `--window-position`/`--window-size` in physical pixels of the virtual
  desktop, as a per-monitor DPI aware process reads them (`listScreens` sets that awareness). An `--app`
  window ignores `--start-fullscreen` and keeps its title bar; `--kiosk URL --edge-kiosk-type=fullscreen`
  fills that screen without title bar and over the taskbar (as InPrivate, which the display does not
  mind). A profile of its own (`--user-data-dir`) keeps the flags from being ignored by an Edge that is
  already running.
- After a hub restart an open display only reconnects its WebSocket and keeps its old page. Hence the
  build fingerprint (`displayBuild` in `static-files.ts`, `{{build}}` in the page, `hub.build` in every
  state, `ui/src/reload.ts`): with other display files the page loads itself again, once per build. It
  needs the same hook token as before; with a new token the page token differs, the WebSocket is turned
  away (403) and the display has to be reloaded by hand (the demo makes a new token at each start).
- Tasks for the current user with an interactive logon token register without elevation. Created with
  `schtasks /Create /XML` (UTF-16 with BOM): defaults of tasks made otherwise stop them on battery and
  after 72 hours.
