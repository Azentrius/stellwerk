# Stellwerk

*A signal box for your AI agents.*

A desk display for a wide second screen (made for 1920×720, ready for touch) that shows every running
Claude Code session and lets you answer their permission requests right there. Like a dispatcher who sees
every train on the track diagram and sets the signals.

![The display at 1920×720: the sessions on the left, what waits for you next to them, room for more, clock, hub and hardware on the right](docs/display.png)

## What it does

- **Every session at a glance.** In the left column, each session with its name (bold) and project and
  its status: waiting for approval, waiting for you, working, done, ended. With the number of running
  subagents and the time of the last activity. The most urgent first.
- **Permission requests on the display.** Each request becomes a card with the complete input: a shell
  command in full, a file change with path and content, an MCP call with server, tool and parameters.
  **Allow**, **Deny**, or **In the app** to leave it to the Claude app. The oldest request is on top; the
  card shows how long it has been waiting and how much of the hold time is left.
- **The app works as before.** The Claude desktop app shows its own card at the same time, and whichever
  decides first counts. If nobody decides on the display within the hold time (60 s), the request goes
  back to the app. If the hub is not running, Claude Code simply asks in the app, without error messages.
- **What waits in the app.** When Claude asks you something (multiple choice), needs some input, or has
  a permission open in the app, the session is listed below the cards under "Answer in the app", with
  how long it has been waiting. You answer in the app; allow or deny would not answer a question.
- **Open pull requests, if you like.** With a read-only GitHub token, the open pull requests of one
  owner (all repositories) are listed too, each with the state of its Actions runs.
- **Hardware, if you like.** Load and temperature of processor and graphics card and the memory in use,
  from LibreHardwareMonitor, which Stellwerk sets up for you.
- **Local only.** The hub listens on `127.0.0.1` and nowhere else and needs a token for every hook
  request. The display loads nothing from the internet. The only connection the hub opens to another
  machine is to `api.github.com`, and only once you set up a GitHub token.
- English and German, following the system language (`?lang=en` or `?lang=de` in the address picks
  one). One factor scales every size.

## Requirements

- Windows 10 or 11
- Node.js 24 (LTS)
- Claude Code: the Claude desktop app or the command line
- Microsoft Edge for the display (any Chromium browser works)

## Installation

From a [release](https://github.com/Azentrius/stellwerk/releases): download `stellwerk-VERSION.zip` and
`SHA256SUMS`, then in PowerShell (replace the version):

```powershell
(Get-FileHash stellwerk-0.2.0.zip).Hash    # must match the line in SHA256SUMS
gh attestation verify stellwerk-0.2.0.zip --repo Azentrius/stellwerk    # optional, needs gh
Expand-Archive stellwerk-0.2.0.zip -DestinationPath .
cd stellwerk-0.2.0
npm ci --omit=dev
npm link        # optional: makes the command `stellwerk` available everywhere
```

Or from the source:

```powershell
git clone https://github.com/Azentrius/stellwerk.git
cd stellwerk
npm ci
npm run build
npm link        # optional
```

Without `npm link`, use `node dist/cli.js` wherever this README says `stellwerk`.

1. Start the hub: `stellwerk serve`. On its first start it creates the token for the hooks.
2. Connect Claude Code: `stellwerk hooks install`. It shows what it adds to
   `%USERPROFILE%\.claude\settings.json`, asks before writing, keeps a backup of the previous file and
   sets the user environment variable `STELLWERK_TOKEN`.
3. Restart the Claude desktop app (and terminals that run Claude Code), so they pick up the token.
4. Once, in a terminal opened as administrator: `stellwerk install`. It adds a Windows Firewall rule
   that blocks the port for other machines, a second layer next to the fixed address.
5. Open the display and move the window to the second screen (F11 for full screen):

   ```powershell
   msedge --app=http://127.0.0.1:4780
   ```

## Start with Windows

```powershell
stellwerk autostart install
```

It lists your screens, shows the two tasks it adds to the Task Scheduler for your user and asks before
adding them. Both start at logon, without administrator rights:

- **Stellwerk hub** starts the hub without a window. Its messages go to
  `%LOCALAPPDATA%\stellwerk\hub.log` (moved to `hub.log.1` when it grows beyond 1 MB).
- **Stellwerk display** opens the display 20 s later in Edge's kiosk mode: full screen on the 1920×720
  screen, without title bar and over the taskbar, with an Edge profile of its own. `--screen <number>`
  picks another screen. Alt+F4 closes the display.

The tasks start what is built in this folder. Run the command again after moving the folder, installing
Node.js elsewhere or rearranging the screens. After an update, restarting the hub is enough: the open
display notices that the hub serves a newer version and loads itself again. Stop or start a task in the Task Scheduler or with
`schtasks /End /TN "Stellwerk hub"` and `schtasks /Run /TN "Stellwerk hub"`; the hub ends together with
its task. `stellwerk autostart uninstall` removes both tasks.

## Open pull requests

Optional. On github.com create a fine-grained personal access token (Settings › Developer settings ›
Fine-grained tokens):

- Resource owner: the user or organisation whose pull requests you want to see
- Repository access: All repositories
- Permissions: **Pull requests: Read** and **Actions: Read**, nothing else

Then:

```powershell
stellwerk github token --owner Azentrius
```

It asks for the token without showing it, tries it once against `api.github.com` and keeps it, readable
by your Windows user only, in `%LOCALAPPDATA%\stellwerk\github-token`; the owner goes into
`config.json`. Only fine-grained tokens (`github_pat_…`) are accepted. Restart the hub afterwards.

Every two minutes the hub then asks `api.github.com` for the owner's repositories (archived ones are
left out), their open pull requests, and the Actions runs on each pull request's head commit:

| State | Checks |
|---|---|
| Checks passed (green, with a check mark) | all runs passed |
| Checks failed (red, with an exclamation mark) | a run failed, timed out or was cancelled |
| Checks running (grey) | runs still going, or waiting for approval |
| No checks (grey) | no runs |

The status column says when the list was last brought up to date, or why that failed (token rejected,
no access, not reachable) and how to fix it. The token is never logged and never sent to the display.
`stellwerk github remove` deletes it; the hub then opens no connection to GitHub.

## Hardware values

Optional. Stellwerk reads the sensors through [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
(MPL-2.0) and sets it up itself, in a terminal opened as administrator with your own account:

```powershell
stellwerk hardware install
```

It shows what it does and asks first:

1. Downloads exactly `LibreHardwareMonitor.zip` of version 0.9.6 from LibreHardwareMonitor's release on
   GitHub and checks its size and SHA-256 against the values in the code. Any other file is refused.
2. Unpacks it to `C:\Program Files\Stellwerk\LibreHardwareMonitor`. Only administrators can change files
   there, which matters because the program runs with administrator rights.
3. Turns on its web server on port 8085 with the user `stellwerk` and a new random password, and starts
   it minimized to the tray (closing its window keeps it running).
4. Adds the firewall rule `Stellwerk-block-inbound-8085`: version 0.9.6 listens on every network
   interface and cannot be limited to `127.0.0.1`.
5. Registers the task **Stellwerk hardware**, which starts it at logon with your administrator rights
   (reading the sensors needs them), and starts it.

Restart the hub afterwards. Every 5 s it asks `http://127.0.0.1:8085/data.json`, with the password it
reads from LibreHardwareMonitor's settings, and shows at the foot of the status column:

| Row | Values |
|---|---|
| CPU | total load, package temperature (AMD: Tctl/Tdie) |
| GPU | load and temperature of the graphics card; a separate card before the one built in |
| RAM | memory in use, in percent and GB |

From 90 °C on a temperature is marked with the warning triangle. If the values cannot be read, the status
column says why and how to fix it. Processor temperatures need the [PawnIO](https://pawnio.eu/) driver,
which you install yourself; without it the row shows the load only.

The password matters: LibreHardwareMonitor's web server can also set fan speeds and answers any web
page in a browser on this machine. With the password, a page can neither read the values nor change
anything. Do not open `http://127.0.0.1:8085` in a browser and let it remember the password.

A newer LibreHardwareMonitor comes with a newer Stellwerk, which pins its version and hash. Run
`stellwerk hardware install` again after updating. `stellwerk hardware uninstall` stops it and removes
the task, the firewall rule and the folder.

## How a permission request goes

1. Claude Code wants to run a tool that needs your permission and sends the request to the hub.
2. The hub holds it and shows a card. The Claude app shows its own card at the same time.
3. Whatever comes first decides:

| Outcome | What happened |
|---|---|
| Allowed | You tapped **Allow**; the tool runs. |
| Denied | You tapped **Deny**; Claude is told "Denied via Stellwerk". |
| Handed to the app | You tapped **In the app**; the app's card stays open. |
| Time is up | Nobody decided within the hold time; the app's card stays open. |
| Decided in the app | You answered in the app: allowed, rejected or cancelled with Esc. The card goes at once. |
| Cancelled | The session ended while the request was open. |

Every request and its outcome goes into the audit log. For a request decided in the app, the hub only
knows that it was answered there, not how; the tool's run (or its absence) shows in the session.

Once a file edit was allowed in the app, Claude Code may switch the session to accepting edits. Later
edits then need no permission at all, so no card appears for them.

## The hooks

`stellwerk hooks install` adds these HTTP hooks, all to `http://127.0.0.1:4780/hooks/claude-code` with the
header `Authorization: Bearer $STELLWERK_TOKEN`:

| Event | Used for | Timeout |
|---|---|---|
| `UserPromptSubmit` | working | 3 s |
| `PermissionRequest` | the card; the hub holds the request | 90 s |
| `Notification` (`idle_prompt`, `agent_needs_input`, `elicitation_dialog`, `permission_prompt`) | waiting for you | 3 s |
| `PostToolUse`, `PostToolUseFailure` | working; a card allowed in the app goes at once | 3 s |
| `Stop` | done | 3 s |
| `SubagentStart`, `SubagentStop` | counting subagents (pairs by `agent_id`) | 3 s |
| `SessionEnd` | ended, hidden after 10 minutes | 1 s |

The short timeouts keep a hung hub from slowing Claude Code down. None of the hooks blocks Claude Code
when the hub is not running. There is no `SessionStart` hook, because that event takes no HTTP hooks: a
session appears with its first event, which in the desktop app is the first prompt.
`stellwerk hooks uninstall` removes exactly these entries and the environment variable.

## Configuration

`%APPDATA%\stellwerk\config.json`, all optional:

```json
{ "port": 4780, "holdSeconds": 60, "sound": false, "scale": 1, "debugRawLog": false }
```

| Setting | Meaning |
|---|---|
| `port` | Port on 127.0.0.1. After a change run `stellwerk hooks install` again. The address cannot be changed. |
| `holdSeconds` | How long a request waits on the display before it goes back to the app: 10 to 80 (at least 10 s below the hook timeout of 90 s). |
| `sound` | A soft chime for each new request. |
| `scale` | Scales every size of the display (0.5 to 3). At 1, no text is smaller than 20 px and no button lower than 64 px. |
| `debugRawLog` | Writes every hook request as received to `debug-raw.jsonl`, like `stellwerk serve --debug-raw`. It holds prompts and code. |
| `githubOwner` | Whose open pull requests to list; set by `stellwerk github token --owner`. Needs the GitHub token. |
| `githubIntervalSeconds` | How often to ask GitHub: 60 to 3600, 120 by default. |
| `hardwareMonitor` | Show the hardware values; set by `stellwerk hardware install` and `uninstall`. |

Restart the hub after a change.

## Files

| Path | What |
|---|---|
| `%APPDATA%\stellwerk\config.json` | Configuration |
| `%LOCALAPPDATA%\stellwerk\token` | The hook token; only your Windows user can read it |
| `%LOCALAPPDATA%\stellwerk\audit.jsonl` | Audit log: every permission request with time, session, project, tool, input and outcome |
| `%LOCALAPPDATA%\stellwerk\debug-raw.jsonl` | Raw hook data, only in debug mode |
| `%LOCALAPPDATA%\stellwerk\hub.log` | Messages of the hub started at logon |
| `%LOCALAPPDATA%\stellwerk\edge-display\` | Edge profile of the display started at logon |
| `%LOCALAPPDATA%\stellwerk\github-token` | The read-only GitHub token, if set up; only your Windows user can read it |
| Tasks `Stellwerk hub`, `Stellwerk display` | Start with Windows, in the Task Scheduler |
| `%USERPROFILE%\.claude\settings.json` | Claude Code's settings with the hooks; backups next to it as `settings.json.stellwerk-….bak` |
| User environment variable `STELLWERK_TOKEN` | The token for Claude Code |
| Firewall rule `Stellwerk-block-inbound-4780` | Blocks the port for other machines |
| `C:\Program Files\Stellwerk\LibreHardwareMonitor\` | LibreHardwareMonitor with its settings, if set up |
| Task `Stellwerk hardware`, firewall rule `Stellwerk-block-inbound-8085` | Its start at logon, and its port closed to other machines |

## Safety

- The hub listens on `127.0.0.1` only; the address is fixed in the code. The firewall rule is a second
  layer.
- Hook requests need the token and `Content-Type: application/json` (otherwise 401 and 415). The content
  type makes a browser ask first (CORS preflight), which the hub never answers, so no web page can post
  events.
- Decisions travel only over the display's WebSocket. The hub checks `Host` and `Origin` (against
  DNS rebinding and foreign pages) and a token it puts into the page it serves.
- Nothing is allowed automatically: no rules, no "always allow".
- The hub starts no programs. Its only connection to another machine is to `api.github.com`, for the
  list of pull requests, and only with a fine-grained read-only token you set up. Besides that it asks
  LibreHardwareMonitor on `127.0.0.1:8085` for the sensor values, if you set it up, and nothing else of
  it. The display loads only the hub's own files under a strict Content Security Policy and shows hook
  data and pull request titles as text, never as HTML.
- `stellwerk hardware install` downloads one file, pinned by size and SHA-256, and unpacks it only into
  its own folder in Program Files. LibreHardwareMonitor runs with administrator rights; its web server
  needs a password and is closed to other machines by a firewall rule.
- Hook requests are limited to 1 MB, open requests to 20 at a time.

Details and how to report a problem: [SECURITY.md](SECURITY.md).

## When nothing shows up

The hub's console (or `hub.log`, when it started with Windows) says why it turned a request away, at most
once a minute per reason and never with the token:

| Message | What to do |
|---|---|
| `hook request without a token (401)` | Claude Code has no `STELLWERK_TOKEN`: run `stellwerk hooks install`, then restart the Claude app. |
| `hook request with a wrong token (401)` | The token file was renewed: run `stellwerk hooks install` again, then restart the Claude app. |
| `request with the Host header … (403)` | Open the display at `http://127.0.0.1:4780` or `http://localhost:4780`, not under another name. |
| `display connection without the right page token` | Reload the display. |

If the console stays silent, Claude Code sends nothing: check that the hooks are in
`%USERPROFILE%\.claude\settings.json` and that the session was started after `stellwerk hooks install`.

## Uninstall

```powershell
stellwerk autostart uninstall
stellwerk github remove
stellwerk hooks uninstall
stellwerk hardware uninstall # as administrator: LibreHardwareMonitor, its task and firewall rule
stellwerk uninstall          # as administrator: removes the firewall rule
npm rm -g stellwerk          # if you used npm link
Remove-Item -Recurse "$env:LOCALAPPDATA\stellwerk", "$env:APPDATA\stellwerk"
```

Restart the Claude desktop app afterwards.

## Development

```powershell
npm run typecheck
npm test                 # unit tests and the hub end to end; runs the TypeScript sources directly
npm run build            # dist/: the hub and the display
npm run demo             # a hub on port 4781 with made-up sessions and requests, own token and audit log
npm run package          # build/: stellwerk-VERSION.zip and SHA256SUMS, reproducible
node dist/cli.js serve --debug-raw --simulate-hang
```

`--simulate-hang` leaves status hooks unanswered, to see how Claude Code behaves with a hung hub. The hub
reads the display's files when it starts: after `npm run build`, restart it. The screenshot above is the
demo at `http://127.0.0.1:4781/?lang=en`, taken with Edge at 1920×720.

What comes next is in [ROADMAP.md](ROADMAP.md).

## Releasing

1. Set the version in `package.json` (with `npm version --no-git-tag-version X.Y.Z`, which updates the
   lockfile too) and give its section in `CHANGELOG.md` the date: `## X.Y.Z – YYYY-MM-DD`.
2. Merge to `main`.
3. On GitHub: Actions › **release** › Run workflow (branch `main`). The workflow runs all tests on
   Windows, checks that the version is new and matches `package.json` and that its changelog section has
   a date, builds `stellwerk-X.Y.Z.zip` with `SHA256SUMS` (reproducible, from the time of the commit),
   signs a build provenance for it and creates the tag `vX.Y.Z` with a release whose notes come from
   `CHANGELOG.md`. Releases cannot be changed afterwards.

## License

Stellwerk is licensed under the [Apache License 2.0](LICENSE); see also [NOTICE](NOTICE). The fonts DM
Sans, DM Serif Display and Red Hat Mono are licensed under the SIL Open Font License 1.1. The icons are
Font Awesome Free 5.15.4 by Fonticons, Inc., taken over through `@patternfly/react-icons` 6.4.0 and
licensed under CC BY 4.0 ([ui/CC-BY-4.0-Font-Awesome.txt](ui/CC-BY-4.0-Font-Awesome.txt)). The Stellwerk
sign (`ui/icon.svg`) is a mark of Azentrius and is not licensed under the Apache License.

Made by [Azentrius](https://azentrius.de).
