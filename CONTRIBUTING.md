# Contributing

Bug reports, ideas and pull requests for Stellwerk are welcome. Security problems do not belong in
public issues: report them as described in [SECURITY.md](SECURITY.md). For a larger change, open an
issue first so we can agree on the approach.

## Setup

```powershell
git clone https://github.com/Azentrius/stellwerk.git
cd stellwerk
npm ci
```

- Stellwerk runs on **Windows 10 or 11** with **Node.js 24**, and so do its tests and CI. The browser
  checks need **Microsoft Edge**.
- Node.js runs the TypeScript sources directly (type stripping), so the tests need no build. Imports use
  `.ts` extensions, and only erasable syntax is allowed: no enums, no namespaces, no parameter
  properties.

## Tests and checks

```powershell
npm run typecheck              # the hub, the tests and the display
npm test                       # unit tests and the hub end to end
npm run build                  # dist/: the hub and the display
node tools/check-browser.ts    # in a real Edge (after the build): the display's sign-in
node tools/check-monitors.ts   # many failing monitors scroll to the last one
node tools/check-columns.ts    # the agents and the waiting column, a card far down
node tools/check-quiet.ts      # the display at rest: dims, what wakes it
npm run demo                   # the display with made-up sessions: http://127.0.0.1:4781/?lang=en
```

The tests and checks start isolated hubs with made-up tokens in temporary folders; nothing goes online,
and your own token, settings and audit log stay untouched. `stellwerk update` runs for real against a
made-up Windows that records every program instead of running it; only `test/windows.test.ts` reads the
real Task Scheduler, and changes nothing. The `test` workflow runs all of this on Windows on every push
and pull request, together with `npm audit`, the changelog section for the version and the package
installed as a user would; its job `test` has to be green before a merge.

## How Stellwerk is built

The hub can allow tool calls of AI agents, so its rules are not negotiable: it listens on `127.0.0.1`
only, checks every request, and never allows or denies by itself. It starts no programs (but hands four
fixed forms of links it builds itself to the Windows shell, on a tap on the display, and runs and ends the
task "Stellwerk hardware" so that LibreHardwareMonitor runs while it runs) and connects only to
`api.github.com`, Uptime Kuma's `/metrics` and LibreHardwareMonitor, each only once set up; anything new
there needs a decision and a review first. The display loads only the hub's own files and shows hook
data as text. Details in [SECURITY.md](SECURITY.md).

The shared design file `ui/azentrius.css` and the DM Sans and DM Serif Display fonts are the same as in
the other Azentrius add-ons (only the path to Red Hat Mono differs). Do not edit them here.

## Requirements for a change

- **English and German.** Every user-facing text goes into both dictionaries in `ui/src/i18n.ts`. German
  addresses the user informally ("du").
- **English in the repository.** Code, comments, docs, commit messages and pull requests are in
  English; the only German is the translation.
- **Tests** for every change: the logic in `test/board.test.ts` and friends, behaviour over HTTP and the
  WebSocket in `test/hub.test.ts`. `npm run typecheck` and `npm test` green, and the browser checks when
  the display changed.
- **SPDX header** `SPDX-License-Identifier: Apache-2.0` in every new source file.
- **Versions and changelog** are the maintainer's: the pull request that raises the version adds its
  section to `CHANGELOG.md`. Describe user-visible changes in your pull request.
- **No private data.** No tokens, keys, prompts, transcripts, lines of the audit log or other real data
  in issues, pull requests, tests or fixtures.

## Pull requests

- Open them against `main`. `main` is protected: every change goes through a pull request and is
  squash-merged once the `test` check is green.
- The title becomes the commit on `main`: short, imperative, English, without a version number
  (e.g. "Remind of a request that waits long").
- Keep one topic per pull request and fill in the template: what and why, how it was tested.

## License

Stellwerk is licensed under the [Apache License 2.0](LICENSE); contributions are accepted under the
same license. Third-party material keeps its own license and is listed in [NOTICE](NOTICE); new
third-party material needs a compatible license and an entry there.
