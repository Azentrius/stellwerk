# Changelog

## 0.5.4 – 2026-10-21

Fixes from a review of 0.5.3: the line of the sessions at rest keeps the keyboard's focus and a press
while the display updates, and `stellwerk update` keeps the display on its screen.

- **The line of the sessions at rest:** each second the display took the line out of the agents list and
  put it back, so it lost the keyboard's focus (Enter then opened nothing), and a mouse button held over
  that moment clicked nothing. Now only the entries around it are drawn anew; the line stays, with its
  focus, a press or key held on it, `aria-expanded` and the list's place. The column check in a real Edge
  covers Tab, Enter and Space over several updates and a press held over one.
- **`stellwerk update` and the screen:** the new version's setup chose the screen anew, so a display put
  on another screen with `autostart install --screen` could move, `update --screen` was ignored, and
  without a single 1920×720 screen the update failed only after unpacking and `npm ci`. Now `update`
  chooses before it changes anything and hands the choice on: the screen given with `--screen`, otherwise
  the one the display task uses now, otherwise (no display task yet) the only 1920×720 screen. When the
  display task's screen is gone or cannot be told, it asks for `--screen` instead of guessing. Tests run
  the real command line with made-up screens and tasks; no program runs and no task changes.

## 0.5.3 – 2026-10-21

The display rests when nothing is new; sessions at rest make way; Codex' command line is marked as such;
sessions and the times of failing monitors are there again after a restart of the hub; the status
column's foot scrolls; the waiting column's fade follows its scrolling; a release runs the browser checks
too.

- **The display at rest:** after 10 minutes with nothing new and no open request, the display dims to
  about a quarter, the clock still readable, so it does not glow on the desk all day and night. An open
  request keeps it awake. Anything new wakes it: a request, an answer due in the app, a monitor going
  down, a new pull request or failed checks, the hub going away; so does a tap, which presses nothing
  else. `quietAfterMinutes` in `config.json` sets the time, 0 turns it off. The display dims its own page:
  the hub starts no programs, so the screen's backlight stays on. Checked in a real Edge
  (`tools/check-quiet.ts`, also in CI and in releases).
- **Sessions at rest make way:** with many sessions the ones at work or waiting got lost among those long
  done. Sessions done or unknown without an event for 30 minutes now wait behind one line at the foot of
  the agents column ("8 more at rest"); a tap opens it, the next closes it, and a minute after the last
  touch it closes by itself. Sessions at work or waiting always stand on their own. While the agents list
  scrolls it is a tab stop of its own. The column check in a real Edge covers it.
- **Codex' command line:** its sessions came to the display already, through the same hooks as the
  app's, but looked like the app's. Now they show as **Codex CLI**, and the third button of their cards
  says **In the terminal**, where Codex then asks. The hub tells them apart by the first line of the
  session's transcript, of which it keeps only who wrote it (`codex-tui` for the command line). The
  README says how Codex' approval settings decide whether it asks at all.
- **Sessions over a restart:** after a restart of the hub the agents column was empty until each session
  sent its next event, and titles were missing until the next prompt. Now the hub keeps the sessions it
  shows in `%LOCALAPPDATA%\stellwerk\sessions.json` (id, folder, title, project, context, last activity;
  no prompt, question, tool input or request) and shows those of the last 12 hours again, grey and
  **Unknown**, since it cannot know what they did in between. A session's next event gives it its real
  status. Open requests never come back: they went back to the app when the hub stopped.
- **Times over a restart:** the hub knew since when a monitor fails only while it ran, so after a restart
  every failing monitor showed no time until it changed again. Now it keeps those times in
  `%LOCALAPPDATA%\stellwerk\uptime-kuma.json` (ids of failing monitors and since when, no names) and
  takes them again if its last answer is no more than 15 minutes old. A monitor that changed while the
  hub was away, or one after a longer break, still shows no time: it may have come back and failed again
  unseen.
- **The status column's foot within reach:** with a hint above them (requests turned away, the raw log
  on), the hardware values and the plans' usage at the foot of the status column were cut off at the
  bottom and could not be reached; with two hints only one row was left. Now the hints and the gauges
  share one area below the clock and the hub's state, which scrolls like the lists by finger, mouse wheel
  and keyboard, the hints first. Without hints the column looks as before. While it scrolls, its values
  keep a little room to the scroll bar, as do the times in the monitor list (seen in a touch test on the
  display). The column check in a real Edge (`tools/check-columns.ts`) covers it.
- **The waiting column's fade:** scrolled to its foot, the waiting column kept its fade over the last
  entry for up to a second, since the fade followed only the display's clock. Now it follows the
  scrolling, as in the monitor list. A new check in a real Edge (`tools/check-columns.ts`) scrolls the
  agents and the waiting column to their last entries by mouse wheel, finger and keyboard, and allows a
  request far down by a tap and by Enter.
- **`stellwerk raw-log delete`:** deletes the raw hook log (`debug-raw.jsonl`), which holds prompts and
  code; the display's hint while the raw log is on names it. The demo shows what is new (a session at rest
  behind its line, one unknown, one of Codex' command line), and so does the README's screenshot.
- **`stellwerk update <zip>`:** sets up a release you downloaded: it checks the zip against the
  `SHA256SUMS` next to it, unpacks it into its own folder under `%LOCALAPPDATA%\stellwerk\releases`, runs
  `npm ci --omit=dev` there and points the logon tasks at it. So the display runs a release, not a working
  copy. Stellwerk downloads nothing itself.
- **Release checks:** the release workflow now runs the checks in a real Edge as well (display sign-in,
  failing monitors, agents and waiting column, the display at rest), as the test workflow does.

## 0.5.2 – 2026-10-20

One filled button on the display: only the oldest waiting request fills its **Allow**. And every failing
monitor can be reached.

- **Allow filled once:** with several requests waiting, every card filled its **Allow**, so the column
  showed one gold button per card. Now only the top card fills it: the oldest request, whose hold time
  ends first. The cards below show **Allow** outlined like **Deny** and **In the app**; it works the same.
  When the top request is decided, the next one takes the filled button over. That is the design
  system's rule: one filled button on a page.
- **Every failing monitor within reach:** with more failing monitors than fit, the third column cut the
  list off at the bottom, and the monitors below could not be reached (since 0.5.0). Now the list scrolls
  like the other columns, by finger, mouse wheel and keyboard, and keeps its place while the display
  updates; title and the lines below stay put. The fade shows only while more is below, and long names
  wrap instead of being cut off. Checked in a real Edge (`tools/check-monitors.ts`, also in CI).

## 0.5.1 – 2026-10-18

The status column points to the log when the hub turned requests away or its raw hook log is on.

- **Requests turned away:** a wrong or missing token, hook data the hub could not take, a request from
  elsewhere or a display without sign-in used to show only in `hub.log`, which nobody reads while the hub
  runs without a window. Now the status column says so as a warning, below the last event: how many,
  when and why the last one ("3 requests turned away. The last one 2 min ago: missing or wrong token.
  More in `hub.log`."). The reason is one of four fixed kinds, never anything of the request. An hour
  after the last one the warning goes; a new one then counts from one.
- **Raw hook log on:** while the hub writes `debug-raw.jsonl` (`debugRawLog` or `--debug-raw`), the status
  column reminds you that it holds prompts and code and how to turn it off.
- **When Codex stays away:** the README says what to do when a Codex chat's folder was renamed or
  deleted: Codex then starts no hooks for it, and nothing reaches the hub.

## 0.5.0 – 2026-10-18

Uptime Kuma's monitors in the third column: what is down stands out, what works is a number.

- **Monitors:** with `stellwerk kuma key --url ADDRESS` and an API key of Uptime Kuma 2, the column kept
  free so far shows its monitors. A monitor that is down stands on top, its name in large letters with a
  red label and how long the hub has seen it down; one that Uptime Kuma is trying again ("pending") stands
  quieter below; everything else is only a number ("35 up", "1 in maintenance"). Paused monitors and
  groups are not counted. The column's title counts what fails, its foot says when Uptime Kuma was last
  asked, or what failed and how to fix it.
- **GitHub's line where its list is:** when the pull requests were last brought up to date, or what
  failed and how to fix it, now stands at the foot of the "Waiting for you" column, below the pull
  requests, as Uptime Kuma's line does in its column. The status column keeps the hub's own state.
- **One more connection, and only that:** every minute the hub asks Uptime Kuma at the address set up
  for `/metrics`, with the key as the password; such a key opens nothing else in Uptime Kuma. The address
  is http or https, a host and a port, nothing else; redirects are not followed; of the answer the hub
  keeps each monitor's name and status. The key is kept like the hook token, readable by you only, never
  logged and never sent to the display. On a plain `http://` address key and metrics cross your network
  unencrypted. `stellwerk kuma remove` deletes the key.
- **Since when, honestly:** how long a monitor fails is what the hub saw itself; one already failing
  when the hub started, or that changed while Uptime Kuma did not answer, shows no time until it changes
  again.
- **Prompts the display does not show:** the hooks now take every notification type and `Elicitation`,
  a question an MCP server asks during its tool call. The hub answers an elicitation at once and empty,
  so the app shows its own dialog as before; it never answers one. Each kind it does not show it names
  once in `hub.log`, with the server's name or the notification's type and nothing of what is asked. This
  is to find out how the desktop app's built-in browser asks for a site, whose cards do not reach the
  display. **Updating:** run `stellwerk hooks install` again.

## 0.4.2 – 2026-10-18

The display signs in, so another account on the computer can no longer allow requests; the hub no longer
ends on a broken display connection; open questions stay open; GitHub lists are complete.

- **Display sign-in (security):** the hub served the display, with the token that suffices to allow and
  deny requests, to anyone who could reach `127.0.0.1`, including other Windows accounts on the same
  computer. Now the display signs in first: the hub writes a start file only your account can read
  (`%LOCALAPPDATA%\stellwerk\display.html`), which posts a key derived from the hook token; only the hub's
  answer carries the page token the WebSocket needs. The display keeps it in its tab's storage for the
  hub's address and port and sends it only in the WebSocket handshake. No cookie: browsers send cookies
  of `127.0.0.1` to every port, so another local service would get it. The address alone gives no token
  and the display says it is not signed in. The key is in no address and no log; `Host`, `Origin` and the
  page token are checked as before. A display reconnects after a restart of the hub, and after a reload.
  A test in a real Edge, also in CI, checks that a second local service visited after the sign-in gets
  nothing to decide with.
  **Updating:** run `stellwerk autostart install` again so the display task opens the start file, then
  restart both tasks. Opened by hand, the display is `msedge --app=` with the start file's address.
- **The hub keeps running:** a WebSocket upgrade with an unreadable target (such as `http://[`) is
  answered with 400, and a display message over 4 KB closes only its own connection; both ended the hub
  before.
- **Open questions stay open:** a question Codex asks without waiting (`request_user_input_async`) now
  stays open past the end of the turn and further tool events, until the answer (the next prompt) or the
  end of the session.
- **Subagents leave the main agent alone:** tool events, starts and requests of a subagent, and how its
  requests end (allowed, denied, handed to the app, timed out, decided in the app), no longer change what
  the session shows; a question the main agent asked stays open, with its time. A subagent's request left
  to the app's card shows as waiting for a permission once the main agent waits for nothing else, each
  until its own tool runs or the subagent stops. A tool that ran or failed ends at most one request of
  that subagent and tool, whether still held on the display or at the app's card: the oldest with the same
  input; without the input only when it is the only one.
- **Complete GitHub lists:** repositories, pull requests and Actions runs are read to the last page,
  following GitHub's links only on `api.github.com`. A failed run on a later page now counts. A list of
  more than 1000 entries is reported as a problem of its own ("too many results") instead of being cut.
- **Private repositories of a person:** for a personal account the list now includes the private
  repositories of that owner the token may see; GitHub's list of a user's repositories holds public ones
  only.

## 0.4.1 – 2026-10-18

Sessions are named as their apps name them: Codex chats with their name and project, Claude sessions
with their title also after a restart of the hub.

- **Names for Codex sessions:** Codex' hook events carry no name, so a Codex session showed its folder
  in bold and nothing below. The hub now takes the chat's name, as the Codex app shows it, from Codex'
  session index (`%USERPROFILE%\.codex\session_index.jsonl`): the name stands in bold, the project below,
  as for every other session. A renamed chat shows its new name with its next event. The hub reads that
  file from its end and keeps only the names of the sessions it shows.
- **Codex projects:** below the name stands the project the Codex app files the chat under ("Lautwerk -
  Codex"), not the folder ("OpenAuto AI"); two projects in one folder stay apart, and a chat the app
  keeps without a project shows no second line. The hub takes the projects from the app's state file
  (`%USERPROFILE%\.codex\.codex-global-state.json`), reads it again only after it changed, and keeps
  nothing of it but the names of projects and which chat belongs to which.
- **Claude titles after a restart:** not every hook event carries the session's title, so after a
  restart of the hub a session could show its folder in bold until its next prompt. The hub now also
  takes the title from the end of the transcript it reads for the context meter, where the desktop app
  writes it.

## 0.4.0 – 2026-10-18

How much of the Claude and Codex plans' limits is used, in the status column, from local sources only; a
nearly full context turns red.

- **Plan usage:** below the hardware, per provider a title with how old the values are ("Claude plan
  usage · 2 min ago") and each limit like the hardware values: the window (5 h, Week), a bar, the percent
  used and when the window starts again. From 80 % it needs attention, from 90 % it is red; a window
  whose time is up counts from zero. The hub keeps the latest values in
  `%LOCALAPPDATA%\stellwerk\plans.json`, so they show again after a restart. No connection and no login:
- **Claude's limits** come from the desktop app's tool `get_usage`: when a session calls it, the
  `PostToolUse` hook carries the answer, and the hub keeps only the limits. A line in your own
  instructions for Claude Code has sessions call it at the start of each task (see the README). A model's own weekly limit ("Fable")
  shows only once it needs attention.
- **Codex' limits** come from the transcripts the hub reads for the context meter, where Codex records
  them with its token counts.
- **Red when little is left:** the context meter in front of an agent stays grey up to 79 %, needs
  attention from 80 % and is red from 90 %; the app compacts the context at about 97 %.
- **One grid for the gauges:** the rows of hardware and plan usage share their columns, so the bars line
  up, and each section stands under the same line as the signature. When an alert above leaves too little room, the gauges fade out at the bottom instead of pushing
  the signature off the screen.

## 0.3.0 – 2026-10-18

Codex joins; how full each session's context is; more room for the repository in the list of open pull
requests; questions in the app's box at the end of a turn count as waiting for you.

- **Codex:** `stellwerk codex install` adds command hooks to Codex' `hooks.json` that run Stellwerk's
  forwarder; after allowing them in the Codex app, its sessions and approvals appear among the others,
  marked "Codex". A Codex request waits on the display for 30 s (`codexHoldSeconds`), since the Codex
  app shows its own card only after the hook; with "Approve for me" nothing is held. Codex' questions
  are listed under "Answer in the app"; the app's helper sessions are not shown; the context meter uses
  the window Codex records. `stellwerk codex uninstall` removes exactly these hooks.
- **Whose agent:** every session, answer and card says whose agent it is, all alike: "Claude · 12 s" next
  to the name (the time there is short now), "Claude · 0:42" with the waiting time, "Claude · shop-api"
  on the card.
- **How full the context is:** in front of each agent its percentage of the context window, 0 to 100 %,
  over a thin line, quiet in grey; from 80 % it needs attention. The hub takes the token counts of the
  last answer from the session's transcript, only under `%USERPROFILE%\.claude\projects` (and Codex'
  folder) and only those numbers. Opus 5.5 has a window of 1M; other models can be set with
  `contextWindows` in `config.json`.
- **Columns:** 25 % agents, 35 % waiting for you, 20 % kept free for monitoring, 20 % status.
- **Questions at the end of a turn:** when Claude ends a turn in the desktop app with its box that asks
  you something (a recap, a question and answers to tap), the session no longer shows as done: it waits
  for you and is listed under "Answer in the app" with the question, until your next prompt. A box that
  only says Claude is blocked on you counts as waiting for input.
- **The question itself:** "Answer in the app" shows the question asked, from that box or from a multiple
  choice question, instead of the project.
- **Checks as an icon:** the state of a pull request's checks stands as its icon alone, in front of the
  title: passed, failed, or the hourglass while they run; no checks leave the place empty. The word stays
  as the icon's tooltip and its name for screen readers. The room goes to repository, number and author.
  The hourglass is PatternFly's own icon under the MIT License (see NOTICE).

## 0.2.0 – 2026-10-16

The display in four columns and truly full screen; what waits in the app, open pull requests and the
hardware are shown too.

- **Four columns:** the sessions on the left, what waits for you next to them, a column kept free for
  what comes next, and clock and hub on the right.
- **Names first:** sessions and cards show the session's name in bold and the project below.
- **Answer in the app:** sessions waiting for an answer in the app (a question, some input, a permission
  open there) are listed below the cards, with how long they have been waiting. A column with more than
  fits fades out at the bottom.
- **Full screen:** the display started with Windows opens in Edge's kiosk mode, without title bar and
  over the taskbar. Run `stellwerk autostart install` again to switch an existing setup.
- **Name and signature:** "Stellwerk." in the text colour with the word mark's dot in gold, nothing in
  italics; the Azentrius signature with the version at the foot of the status column.
- **Own sign:** the favicon is Stellwerk's sign from the Azentrius design system, a semaphore signal
  set to clear with the word mark's gold dot, gold on ink. It replaces the gold diamond on a grey mast.
  The sign is a mark of Azentrius and not under the Apache License (see NOTICE).
- **Azentrius design system:** every state carries its icon and a word: waiting for approval needs
  attention, waiting for you is a note, working, a connected hub and passed checks are good, failed
  checks, a disconnected hub and problems with GitHub or the hardware are errors, a temperature from 90 °C
  needs attention. Gold is kept for the dot of the name and the main action: no gold states, counts, bars
  or tool names, no coloured stripes on cards (the old and new text of a change are named "Before" and
  "After"), and new cards no longer pulse. Allow, Deny and In the app are the system's buttons with icons;
  spacing follows its scale. The icons are Font Awesome Free under CC BY 4.0 (see NOTICE).
- **Errors say how to fix them:** a disconnected hub and problems with GitHub or the hardware stand in
  the status column as alerts, with what happened and what to do, such as the command to run again.
  While the hub is away, only its own alert shows.
- **Open pull requests:** with a fine-grained read-only token (`stellwerk github token --owner NAME`), the
  open pull requests of all the owner's repositories are listed under "Waiting for you", each with the
  state of its Actions runs; the status column says when the list was updated or why that failed. This
  is the hub's only connection to another machine, to `api.github.com`, and it exists only with the token.
- **Hardware values:** `stellwerk hardware install` (as administrator) sets up LibreHardwareMonitor 0.9.6
  from its official release, checked by size and SHA-256, in Program Files, with its web server behind a
  password and a firewall rule, started at logon by the task "Stellwerk hardware". The status column then
  shows load and temperature of processor and graphics card and the memory in use. `stellwerk hardware
  uninstall` removes it all.
- **Display follows updates:** the hub names a fingerprint of the display files it serves, in the page
  and in every state. An open display that finds another one after the hub restarts loads itself again,
  so restarting the hub is enough after an update.

## 0.1.0 – 2026-10-15

The first version: Claude Code sessions and their permission requests on a desk display.

- **Hub:** receives Claude Code's HTTP hooks on `127.0.0.1`, keeps the status of every session in
  memory and holds permission requests until the display decides or the hold time (60 s) is up. Writes
  every request and its outcome to an audit log. A request answered in the app counts as "decided in the
  app", whether it was allowed, rejected or cancelled there. Questions to the user (multiple choice) get
  no card: the session waits for the answer in the app.
- **Display:** three columns for 1920×720 in Azentrius dark: the open requests with the complete input
  and Allow, Deny and In the app; the sessions with status, subagents and last activity; clock and the
  hub's state. Buttons 64 px high, no text below 20 px, one scale factor, English and German.
- **Setup:** `stellwerk hooks install` and `uninstall` add and remove exactly Stellwerk's hooks in
  Claude Code's settings (with a diff, a question and a backup) and the token variable;
  `stellwerk install` and `uninstall` add and remove the firewall rule.
- **Safety:** token for hook requests, `Host` and `Origin` checks, page token for the WebSocket, strict
  Content Security Policy, no outgoing connections, no automatic decisions.
- **Rejections on the console:** the hub says why it turned a request away (no token, wrong token, wrong
  content type, foreign host or origin), at most once a minute per reason and never with the token.
- **Start with Windows:** `stellwerk autostart install` and `uninstall` add and remove two Task Scheduler
  tasks for the current user: the hub at logon without a window (messages in `hub.log`), the display
  20 s later full screen on the 1920×720 screen.
- **Language:** `?lang=en` or `?lang=de` in the display's address picks the language.
- **Release package:** `stellwerk-VERSION.zip` with the built hub and display, installed with
  `npm ci --omit=dev`; reproducible, with `SHA256SUMS` and a signed build provenance.
