# Stellwerk

*A signal box for your AI agents.*

A desk display for a wide second screen (made for 1920×720, ready for touch) that shows every running
Claude Code session and lets you answer their permission requests right there. Like a dispatcher who sees
every train on the track diagram and sets the signals.

## What it does

- **Every session at a glance.** Project, title and status of each session: waiting for approval, waiting
  for you, working, done, ended. With the number of running subagents and the time of the last activity.
  The most urgent first.
- **Permission requests on the display.** Each request becomes a card with the complete input: a shell
  command in full, a file change with path and content, an MCP call with server, tool and parameters.
  **Allow**, **Deny**, or **In the app** to leave it to the Claude app. The oldest request is on top; the
  card shows how long it has been waiting and how much of the hold time is left.
- **The app works as before.** The Claude desktop app shows its own card at the same time, and whichever
  decides first counts. If nobody decides on the display within the hold time (60 s), the request goes
  back to the app. If the hub is not running, Claude Code simply asks in the app.
- **Local only.** The hub listens on `127.0.0.1` and nowhere else, needs a token for every hook request,
  opens no outgoing connections and loads nothing from the internet.
- English and German, following the system language. One factor scales every size.

## Requirements

- Windows 10 or 11
- Node.js 24 (LTS)
- Claude Code: the Claude desktop app or the command line
- Microsoft Edge for the display (any Chromium browser works)

## Installation

```powershell
git clone https://github.com/Azentrius/stellwerk.git
cd stellwerk
npm ci
npm run build
npm link        # optional: makes the command `stellwerk` available everywhere
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
| Decided in the app | You answered in the app; the card goes with the session's next event. |
| Cancelled | Claude Code dropped the request (Esc, rejected in the app, session ended). |

Every request and its outcome goes into the audit log.

Choosing "allow for this session" in the app switches the session to accepting edits, and later edits
then need no permission at all, so no card appears for them.

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

Restart the hub after a change.

## Files

| Path | What |
|---|---|
| `%APPDATA%\stellwerk\config.json` | Configuration |
| `%LOCALAPPDATA%\stellwerk\token` | The hook token; only your Windows user can read it |
| `%LOCALAPPDATA%\stellwerk\audit.jsonl` | Audit log: every permission request with time, session, project, tool, input and outcome |
| `%LOCALAPPDATA%\stellwerk\debug-raw.jsonl` | Raw hook data, only in debug mode |
| `%USERPROFILE%\.claude\settings.json` | Claude Code's settings with the hooks; backups next to it as `settings.json.stellwerk-….bak` |
| User environment variable `STELLWERK_TOKEN` | The token for Claude Code |
| Firewall rule `Stellwerk-block-inbound-4780` | Blocks the port for other machines |

## Safety

- The hub listens on `127.0.0.1` only; the address is fixed in the code. The firewall rule is a second
  layer.
- Hook requests need the token and `Content-Type: application/json` (otherwise 401 and 415). The content
  type makes a browser ask first (CORS preflight), which the hub never answers, so no web page can post
  events.
- Decisions travel only over the display's WebSocket. The hub checks `Host` and `Origin` (against
  DNS rebinding and foreign pages) and a token it puts into the page it serves.
- Nothing is allowed automatically: no rules, no "always allow".
- The hub starts no programs and opens no outgoing connections. The display loads only the hub's own
  files under a strict Content Security Policy and shows hook data as text, never as HTML.
- Hook requests are limited to 1 MB, open requests to 20 at a time.

Details and how to report a problem: [SECURITY.md](SECURITY.md).

## When nothing shows up

The hub's console says why it turned a request away, at most once a minute per reason and never with
the token:

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
stellwerk hooks uninstall
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
node dist/cli.js serve --debug-raw --simulate-hang
```

`--simulate-hang` leaves status hooks unanswered, to see how Claude Code behaves with a hung hub. The hub
reads the display's files when it starts: after `npm run build`, restart it.

What comes next is in [ROADMAP.md](ROADMAP.md).

## License

Stellwerk is licensed under the [Apache License 2.0](LICENSE); see also [NOTICE](NOTICE). The fonts DM
Sans, DM Serif Display and Red Hat Mono are licensed under the SIL Open Font License 1.1.

Made by [Azentrius](https://azentrius.de).
