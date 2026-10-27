# Changelog

## 0.9.0 – 2026-10-26

Stellwerk sets itself up in one go, says how it stands and when a newer LibreHardwareMonitor is due, and a
failing monitor opens in Uptime Kuma.

- **`stellwerk setup`:** everything in one go, each step showing what it changes and asking first
  (`--yes` for all): Claude Code's hooks, the start with Windows, Codex' hooks when Codex is used here,
  and in a terminal with administrator rights the firewall rule and LibreHardwareMonitor (in any other it
  names the two commands); then it starts Stellwerk and shows `stellwerk status`.
- **`stellwerk status`:** what runs and what is set up, without changing anything: whether the hub
  answers and which release it runs (from its log) and its task starts, the display, LibreHardwareMonitor
  and its version, and whether the hooks of Claude Code (with the app's session id, the token set) and of
  Codex point at the running release. What needs doing is marked `!!` with the command for it, and the
  command then ends with 1. Task states come from Task Scheduler itself, in any language.
- **A due LibreHardwareMonitor:** `stellwerk hardware install` notes the version it set up
  (`%LOCALAPPDATA%\stellwerk\hardware.json`). When a newer Stellwerk pins a newer one, the status column
  says so, with the command to run as administrator.
- **A failing monitor opens in Uptime Kuma:** a tap on it opens its page there
  (`<uptimeKumaUrl>/dashboard/<id>`) in the default browser, the fourth form of link the hub opens. The
  hub builds it from the address set up and a monitor it shows as failing; the display names only its id.
- **Tests:** `stellwerk setup` against a made-up Windows (the hooks, the two logon tasks, nothing as
  administrator without its rights, started, how it stands); the monitor's link and what it refuses, the hub opening only a failing monitor it shows;
  `stellwerk status` against a made-up Windows (all well; an old hub, old Codex hooks, hooks
  without the app's id, a closed display; missing tasks and an older LibreHardwareMonitor that still starts
  at logon), the due version from the hub to the display, its note in both languages.

## 0.8.0 – 2026-10-26

LibreHardwareMonitor runs while Stellwerk runs, Stellwerk starts, stops and restarts with one command,
the display says where a tap opens something, and it stays readable at night.

- **LibreHardwareMonitor with the hub:** the hub runs the task "Stellwerk hardware" when it starts, runs
  it again when LibreHardwareMonitor has not answered for a minute (at most every two minutes), and ends it
  when it stops. The task no longer starts at logon by itself; run `stellwerk hardware install` again as
  administrator once to register it so. It still runs LibreHardwareMonitor with administrator rights, from
  its folder in Program Files, which only administrators can change; the hub needs none to run or end it.
- **Starting, not failing:** while LibreHardwareMonitor starts (it takes about 20 s), the status column
  says "Hardware: monitor starting …" instead of a warning. The hint for a monitor that does not run says
  that the hub starts it again, or `stellwerk restart`.
- **`stellwerk start`, `stop` and `restart`:** they run or end the tasks in order, without administrator
  rights: the hub, which then runs LibreHardwareMonitor, and the display; stopping the other way round,
  LibreHardwareMonitor's task last.
- **"Opening in Codex …":** after a tap that opens a session or a pull request, the display says for a few
  seconds where it opens: in Claude, in Codex or in the browser. The hub's answer to the display now names
  where it opened. An app can take a few seconds to show a session (Codex the longest, as it loads the
  chat first), and without a word on the display a second tap opened it twice.
- **Readable at night:** at rest at night the columns are dimmed to a fifth and the clock's column to
  three tenths, a little darker than at rest by day (a quarter and four tenths). Before, everything went to
  six hundredths, and on the display nothing could be made out.
- **Tests:** when the hub runs the task again and when not, a task that fails, the task without a start
  at logon (also registered for real once, then deleted), the hub running and ending it, and the commands
  against a made-up Windows: their order, a missing task, a hub that does not follow its task. The hub's
  answer for a Claude session, a Codex chat and a pull request; in a real Edge the words after a tap on the
  button in a session's details and on a pull request, and the night's dimming.

## 0.7.0 – 2026-10-25

A tap opens a session in its app and a pull request in the browser; the last decisions stand where the
requests are, and only those of the last day.

- **Open it where it is:** in a session's details a button opens it in its app, a session of the Claude
  desktop app there and a chat of the Codex app in Codex; a tap on a session waiting for an answer opens
  it where the answer is given, a tap on a pull request opens it in the default browser. The display only
  names what to open; the hub builds the link from what it shows and hands it to the Windows shell
  (`explorer.exe`, the link as its only argument), only as one of three forms
  (`claude://claude.ai/epitaxy/local_…`, `codex://threads/<id>`,
  `https://github.com/<owner>/<repo>/pull/<n>`) and at most one a second. That is the one program the hub
  starts. The desktop app's own id of a session comes with its hooks in a new header
  (`X-Stellwerk-App-Session` from `CLAUDE_CODE_HOST_SESSION_ID`): run `stellwerk hooks install` once.
  The hub keeps that id over a restart and never sends it to the display. Claude Code in a terminal and
  Codex' command line have no app to open.

- **At the foot of the waiting column:** the line with the last decisions moved from the status column to
  the foot of "Waiting for you", above GitHub's line. Open, the decisions lie over the requests, from the
  line upwards, and scroll there; the requests keep their place. A tap on the line closes them, as do a
  minute without a touch and a new request, which is never hidden behind them.
- **Only the last 24 hours:** older decisions are left out, and without any of the last day the line is
  not there. Before, the last ten stayed however old they were, and a test days ago looked like what had
  just happened.
- **Tests:** which decisions are shown, the line closing at once, where the line stands on the page; in a
  real Edge the line at the foot of the column, the decisions over the requests without moving them, a
  new request folding them, and two decisions older than a day left out. For opening: the three forms and
  what they refuse, the app's id from the header (forged ones left out, kept over a restart), the
  display's message over the WebSocket (unknown sessions, pull requests the hub does not list, links the
  display writes, one a second, a failing shell), and in a real Edge the button in the details, a session
  waiting for an answer and a pull request, each pressed over a render.

## 0.6.4 – 2026-10-23

`stellwerk update` finds the display's Edge in a profile path with umlauts, and starts a display again
on the screen given when its task names no full placement.

- **Values for PowerShell in any letters:** the setup commands hand values (a path, a task's name, the
  token) to PowerShell on standard input as Base64 of their UTF-8, and it decodes them, so the console's
  code page no longer changes them. Before, a profile folder like `C:\Users\Jörg\…` arrived as another
  path: the display's running Edge counted as none, so a moved display was run again without waiting for
  the old one to close, and could open where it was. A user environment variable is read back the same
  way.
- **A display task without a full placement:** with `--screen`, a display task that names no position,
  no size or neither is now ended and run again on the screen given, as for a move; before, its display
  stayed where it was. Without `--screen` such a task still stops the update before anything changes,
  and a display that is on the screen given already still only loads the new page.
- **Tests:** the Edge count against a real, headless Edge with profile folders in umlauts and spaces, in
  any case, against other and shorter paths and after it closed; and the update for a display task
  without its position, its size or both, with and without `--screen`, in the order of its steps.

## 0.6.3 – 2026-10-23

`stellwerk update` starts a display moved to another screen again there, and no longer removes a
release that Codex' hooks may still run.

- **Codex' hooks that cannot be read:** a `hooks.json` that is there but cannot be read, or is no JSON
  object, stops the update before it changes anything. Before, it counted as holding no Stellwerk
  hooks: the update left them on the previous release's forwarder and then removed that release. If
  the file cannot be read only at the end, the previous releases stay. A missing file, or hooks of
  other programs only, work as before.
- **A display moved to another screen** (`--screen` naming another one) is started again there: once
  the hub runs, the update ends the display's task, waits until the Edge with the display's own profile
  has closed (other Edge windows stay open) and runs the task again. Before, only the task changed, and
  the display stayed where it was until the next logon. On its screen the display still loads the new
  page by itself. When it does not close, cannot be counted or its task does not run, the update says
  what to do and keeps the previous releases.
- **Tests** for both, and for the order of the update's steps: the setup, Codex' hooks, the hub, the
  display, then the previous releases.

## 0.6.2 – 2026-10-22

Up to date with the other Azentrius repositories: the shared design file, the documentation, and
templates for issues and pull requests.

- **The shared design file:** `ui/azentrius.css` is the design system's current one again, as in the
  other Azentrius add-ons (only its path to Red Hat Mono is Stellwerk's own). It adds spacing tokens for
  sections, columns and cards, the dot of the word mark after a page title, a large button and a small
  line above a section title for project pages, and keeps helpers placed in a table that scrolls
  sideways inside it. The display looks the same.
- **README, roadmap and security policy:** a section on known limits; after an update, `npm link` in the
  new release's folder, so the command runs the new version; Codex' command line and the note of a newer
  release under "What it does"; the releases folder in the list of files; what `autostart uninstall`
  leaves running; the four browser checks under "Development". The security policy names the supported
  versions, how fixes are announced and what matters most in `stellwerk update`.
- **Issue and pull request templates and a contributing guide:** a bug report and a feature request
  form, security problems only as a private report, and `CONTRIBUTING.md` with the commands, the tests
  and the rules the hub keeps.
- **Package metadata:** `package.json` has the repository's description, homepage, issue tracker and
  topics.
- **The command's help** says where every setting is described (the README's "Configuration") instead
  of listing some of them.
- **The test job** requires a dated changelog section for the version, as the release does.

## 0.6.1 – 2026-10-22

A task that Task Scheduler cannot read no longer counts as missing anywhere.

- **`autostart uninstall` and `hardware install`/`uninstall`:** they asked whether a task is there with
  `schtasks /Query`, which fails alike for a missing task and one it may not read, and took any failure for
  a missing task: `autostart uninstall` then said there were no Stellwerk tasks, or removed only one of them,
  and `hardware` skipped ending its task. Now they ask Task Scheduler for its error code, as `update` does
  since 0.5.4: only "not there" counts as missing, and anything else stops the command before it changes
  anything. Tested with the real command line against a made-up Windows, and read only against the real
  Task Scheduler.

## 0.6.0 – 2026-10-22

An update in one step, and the display says when there is one; the last decisions and a session's details
on the display; a request that waits long reminds; a night by the clock.

- **`stellwerk update` in one step:** after setting up the release it now also moves Codex' hooks to the
  new forwarder (when they run Stellwerk's), starts the hub again from the new version and removes the
  previous releases in `%LOCALAPPDATA%\stellwerk\releases` (`--keep-previous` keeps them). It lists all
  of it before it asks. The display loads the new page by itself. The hub's task is ended and run; when a
  hub not started by its task holds the port, or the new one does not start, the update says so and keeps
  the previous release. A previous release that Codex' hooks still run, or the command runs in, stays.
  Tests run the real command line against a made-up Windows with a stand-in hub.
- **A newer release on the display:** with a GitHub token set up, the hub asks `api.github.com` at its
  start and then every six hours for the newest release of `Azentrius/stellwerk` (no drafts, no
  pre-releases; nothing is downloaded). When it is newer than the running version, the status column says
  so, with the command that sets it up.
- **The last decisions:** in the status column, below the hub and its hints, one line folds the last ten
  decisions on permission requests: what each was about (a command's first line, a file, an address), when,
  whose session and tool, and how it ended (allowed, denied, in the app, time up …). A click or Enter opens
  it, the next closes it. The hub keeps them as it settles requests and reads them back from the end of its
  audit log at a start, so a restart does not empty them; the display never gets the whole input. The
  audit log now also names the session's title and whose agent asked.
- **A session's details:** a tap on a session (or Enter or Space on it) opens its details below it: its
  folder, model, how much of its context is in use, its subagents, the tool it used last and its id; the
  next closes them. Each session keeps its element while its content is drawn anew, and the content takes
  no pointer events, so a tap that meets an update still reaches the session (a check in a real Edge
  holds a press over an update). Every session is a tab stop now. The hub also sends the model of a
  session's last answer and the tool it used last.
- **A request that waits long reminds:** after `remindAfterSeconds` (20 by default, 0: never) its card
  pulses in the colour of attention, and with `sound` on the tones come once more. Without motion (the
  system's setting) the card keeps a frame instead of pulsing. Codex hands a request back to its app
  after 30 s, so the reminder comes before that.
- **A night by the clock:** with `nightFrom` and `nightTo` in `config.json` (e.g. "23:00" and "07:00",
  also over midnight) the display rests at night after a minute without anything new, also when it never
  rests by day, and goes almost black, the clock's column too. What wakes it by day wakes it at night: a
  tap, an open request, an answer due, a monitor going down, a new pull request or failed checks.

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
  display task's screen is gone or cannot be told, it asks for `--screen` instead of guessing. Only a
  display task that Task Scheduler itself reports as missing counts as a first setup, by its error code,
  not by the words of `schtasks`, which fails alike for a missing task and one it may not read and speaks
  the system's language; a task it cannot read, or a Task Scheduler that does not answer, stops the update
  before anything changes. Tests run the real command line with made-up screens and tasks; no program runs
  and no task changes.

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
