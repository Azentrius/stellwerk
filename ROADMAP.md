# Roadmap

As of 2026-11-07. Each stage is useful on its own and brings its own tests. Stages after 1 are proposals
until they are decided.

**Guardrails for every stage** (they keep applying):

- **Local only:** the hub listens on `127.0.0.1`, fixed in the code. No access from other devices, no
  tablet, no tunnel, in no stage.
- **No automatic decisions:** a request is allowed or denied by a person, on the display or in the app.
- **The hub runs nothing:** it answers requests and shows status. Its two exceptions: a tap on the
  display can have it open a session in its app, a pull request or a failing monitor in the browser,
  through the Windows shell and only as four fixed forms of links it builds itself (since 0.7.0, the
  monitors since 0.9.0); and it runs and ends the task that runs LibreHardwareMonitor (since 0.8.0).
  Stage 4 changes more and gets its own security review first.
- **No outgoing connections** unless a stage needs one for its data source, and then only to that source.
- **Display:** only the hub's own files, strict Content Security Policy, nothing inline, hook data as text
  only. Every text in English and German. Usable with fingers at 1920×720.
- **Tests:** unit tests for the logic, the hub end to end for every change.

### Proposed change to the guardrails

Proposed on 2026-11-07, to be decided before stage 20. Until then the guardrails above stand as they are.
Stages 20 and 21 would have the hub start agents, which "The hub runs nothing" rules out. The proposal
replaces that guardrail with this one:

- **The hub starts nothing by itself:** besides the exceptions above, it may start an agent, and only in
  fixed forms it builds itself (which agent, which mode, which folder, the ticket as data). A read-only
  analysis may start after a person's click on a Jira rule that only a named group may run. Anything
  that writes starts only after a person's tap on the display. Never from the text of a ticket, never on
  an agent's request, never in a mode that skips the agent's own approvals, so every request still comes
  to the display or the app.

"No automatic decisions" stays as it is. The change gets its own security review (see the order below).

---

## Order

Proposed on 2026-11-07. Small stages that touch no guardrail come first; the stages that widen what the
hub may do come once there is one threat model for them.

| # | Stage | Why at this point | Size |
|---|---|---|---|
| 1 | 12 – What each session is doing | Uses events the hub gets already, or gets the same way; touches no guardrail | small |
| 2 | 11 – Errors and a stop | "Done" and "failed" look alike today | small |
| 3 | 7 – macOS and Linux, step 1 | The portable core; everything after it runs on three systems | medium |
| 4 | 8 – Cursor and Copilot CLI | More agents on the same board | medium |
| 5 | 13 – The agents' own numbers | Statusline and OpenTelemetry replace guessing; stage 9 builds on it | large |
| 6 | 9 – Costs and limits | Needs stage 13's numbers, or its own price table without them | medium |
| 7 | 14 – Progress and review | Tasks, branch and pull request at each session | medium |
| 8 | 17 – Shared memory | Read-only check, helps every user at once | small |
| 9 | 18 – The agents as a track diagram | A page of its own, display only | medium |
| 10 | 19 – A window for everyone | Stellwerk without a second screen and without jargon | medium |
| 11 | 15, 16 | Tool statistics, background sessions | medium |
| 12 | 4, 10, 6 | Shortcuts, keys, touch: when the hardware is there | medium |
| 13 | 20 – Jira: a proposal first | Needs the guardrail change | large |
| 14 | 21 – Jira: implement on a tap | Needs stage 20 and the guardrail change | large |

Stages 4, 10, 11 (the stop), 20 and 21 each widen what the hub may do. One threat model for all five,
brought up to date for each of them, costs less than five reviews and keeps their rules consistent.

---

## Stage 1 – Claude Code sessions and permission requests ✅

Done in 0.1.0 (see [CHANGELOG](CHANGELOG.md)): the hub, the display, the hook setup, the firewall rule,
the start with Windows, the release package and workflow. The acceptance tests passed on the real setup.

---

## 0.2.0 – Four columns, open pull requests, hardware ✅

Done in 0.2.0 (see [CHANGELOG](CHANGELOG.md)): the display in four columns, full screen, in the Azentrius
design system, with errors that say how to fix them; sessions waiting for an answer in the app; the open
pull requests of a GitHub owner with the state of their Actions runs. GitHub is the first data source
outside the machine: read only, with a fine-grained token, nothing but `api.github.com`. Processor,
graphics card and memory from LibreHardwareMonitor, which `stellwerk hardware install` sets up (the first
part of stage 2). Allowing and denying by touch were checked on the real 12.3″ display.

---

## 0.3.0 – Codex, context, questions at the end of a turn ✅

Done in 0.3.0 (see [CHANGELOG](CHANGELOG.md)): the Codex app's sessions and approvals next to the others,
every agent marked alike (the first part of stage 5); how full each session's context is; questions in
the app's box at the end of a turn count as waiting for you; the checks of a pull request as an icon.
Allowing and denying a Codex request on the display were checked on the real setup.

---

## 0.4.0 – Plan usage, red when little is left ✅

Done in 0.4.0 (see [CHANGELOG](CHANGELOG.md)): how much of the Claude and Codex plans' limits is used,
below the hardware, from local sources only (stage 3); the context meter and the limits red from 90 %;
the gauges in one grid, each section under a line. Claude's limits reached the real display through the
desktop app's `get_usage` and are kept across a restart.

---

## 0.4.1 – Names as the apps give them ✅

Done in 0.4.1 (see [CHANGELOG](CHANGELOG.md)): Codex chats with their name and the project the Codex app
files them under, Claude sessions with their title also after a restart of the hub. Checked against the
real Codex app's projects and a desktop app session without a group.

---

## 0.4.2 – Review fixes ✅

Done in 0.4.2 (see [CHANGELOG](CHANGELOG.md)), after an external review of 0.4.1: the display signs in
with a start file only the user can read (another account on the computer no longer gets the
decisions); a broken display connection no longer ends the hub; open Codex questions and the main
agent's questions survive turn ends and subagents; GitHub lists are complete, private repositories of a
person included. The sign-in was checked in a real Edge, also with a second local service that must get
nothing.

---

## 0.5.1 – Hints to the log ✅

Done in 0.5.1 (see [CHANGELOG](CHANGELOG.md)): the status column says when the hub turned requests away
(how many, when and why the last) and when its raw hook log is on, so that `hub.log` gets a look before
something stays missing unnoticed.

---

## 0.5.2 – One filled Allow ✅

Done in 0.5.2 (see [CHANGELOG](CHANGELOG.md)): with several requests waiting, only the oldest fills its
**Allow**, so the display keeps the design system's one filled button on a page. More failing monitors
than fit now scroll, down to the last one.

---

## 0.5.3 – At rest and over a restart ✅

Done in 0.5.3 (see [CHANGELOG](CHANGELOG.md)): the display rests, dimmed, when nothing is new; sessions at
rest make way in one line; `stellwerk update` sets up a downloaded release; Codex' command line is marked
as such; the sessions and since when a monitor fails survive a restart of the hub; the status column's
foot scrolls below its hints; the waiting column's fade follows its scrolling; and a release runs the
browser checks too, now also for the agents, the waiting and the status column and for the display at
rest.

---

## 0.5.4 – Review fixes ✅

Done in 0.5.4 (see [CHANGELOG](CHANGELOG.md)), after a review of 0.5.3: the line of the sessions at rest
keeps the keyboard's focus and a press while the display updates; `stellwerk update` keeps the display on
its screen and asks before it would guess.

---

## 0.6.0 – Updates in one step ✅

Done in 0.6.0 (see [CHANGELOG](CHANGELOG.md)): `stellwerk update` also moves Codex' hooks, starts the hub
again and removes the previous releases; the display says when a newer release is out, folds the last
ten decisions in one line of the status column, opens a session's details on a tap, reminds of a
request that waits long, and goes almost black at night.

---

## 0.6.1 – Task Scheduler read safely everywhere ✅

Done in 0.6.1 (see [CHANGELOG](CHANGELOG.md)): `autostart uninstall` and `hardware` tell a missing task
from one Task Scheduler cannot read, as `update` does.

---

## 0.6.2 – Up to date with the other Azentrius repositories ✅

Done in 0.6.2 (see [CHANGELOG](CHANGELOG.md)): the shared design file in its current state; the README
with known limits, `npm link` after an update and Codex' command line; the security policy with the
supported versions and how fixes are announced; templates for issues and pull requests and a guide for
contributors; the test job requires a dated changelog section.

---

## 0.6.3 – Updates that move the display and keep what Codex runs ✅

Done in 0.6.3 (see [CHANGELOG](CHANGELOG.md)): `stellwerk update` starts a display moved to another
screen again there, closing only its own Edge; a Codex `hooks.json` that cannot be read stops the
update before it changes anything, and keeps the previous releases when it fails only at the end.

---

## 0.6.4 – The display found in any profile path, and placed where it is told ✅

Done in 0.6.4 (see [CHANGELOG](CHANGELOG.md)): the display's Edge is found by its profile folder also
when that folder's path has umlauts; values reach PowerShell unchanged whatever the console's code page;
`update --screen` starts a display again whose task names no full placement.

---

## 0.7.0 – Open it where it is; the last decisions where the requests are ✅

Done in 0.7.0 (see [CHANGELOG](CHANGELOG.md)): a tap opens a session in the Claude desktop app or in the
Codex app and a pull request in the browser; the last decisions moved from the status column to the foot
of the waiting column, show only the last 24 hours, and open over the requests without moving them.

---

## 0.8.0 – LibreHardwareMonitor runs with Stellwerk ✅

Done in 0.8.0 (see [CHANGELOG](CHANGELOG.md)): the hub runs LibreHardwareMonitor's task when it starts,
again when it stops answering, and ends it when it stops; `stellwerk start`, `stop` and `restart` control
the whole of it. After a tap that opens a session or a pull request, the display says at once where it
opens, while the app takes its time; at night it stays readable.

---

## 0.9.0 – How it stands ✅

Done in 0.9.0 (see [CHANGELOG](CHANGELOG.md)): `stellwerk setup` sets Stellwerk up in one go and
`stellwerk teardown` removes it, `stellwerk status` shows what runs and what is set up, the status column
says when a newer LibreHardwareMonitor is due, a failing monitor opens in Uptime Kuma, and the tones are
quieter at night.

---

## 0.10.0 – Fewer lines for Dependabot ✅

Done in 0.10.0 (see [CHANGELOG](CHANGELOG.md)): Dependabot's pull requests of a repository stand behind
one line, which a tap opens in place; drafts are marked in front of their title, and a conflict with the
base is shown.

---

## 0.10.1 – Marks as icons ✅

Done in 0.10.1 (see [CHANGELOG](CHANGELOG.md)): a conflict and a draft are small icons in front of a pull
request's title, so the title keeps its room.

---

## 0.10.2 – GitHub's answer in the log ✅

Done in 0.10.2 (see [CHANGELOG](CHANGELOG.md)): when the list of pull requests cannot be brought up to
date, the log names the question that failed with GitHub's status, or why it got no answer.

---

## 0.11.0 – A second page: calendar and tasks ✅

Done in 0.11.0 (see [CHANGELOG](CHANGELOG.md)): a swipe goes from the agents to a page with the
calendars' events and the open tasks, with the GitHub issues assigned to you; a new request takes the
display back at once. Next: a page of shortcuts that open links and apps and send key presses, after a
security review of its own (stage 4).

---

## 0.11.1 – The pages' tabs in the status column ✅

Done in 0.11.1 (see [CHANGELOG](CHANGELOG.md)): the dots below the pages, which looked like part of the
middle column, are now a row of tabs in the status column, an icon for each page, and a tap on one goes
there. Five fit, for the pages still to come.

---

## Stage 2 – System values and alerts ✅

CPU, memory and temperatures from LibreHardwareMonitor: done in 0.2.0. Server and app alerts from Uptime
Kuma in the third column: done in 0.5.0 (see [CHANGELOG](CHANGELOG.md)). The hub reads Uptime Kuma's
`/metrics` with an API key that opens nothing else; what is down stands out, retrying is quieter, what
works is a number.

---

## Stage 3 – Usage of Claude and ChatGPT ✅

How much of the plans' limits is used: done in 0.4.0 (see [CHANGELOG](CHANGELOG.md)), below the
hardware, from local sources only. Claude's limits from the desktop app's tool `get_usage`, whose answer
the `PostToolUse` hook carries when a session calls it; Codex' limits (those of the ChatGPT plan for
Codex) from its transcripts. Not possible without a connection to another machine: the limits of chats in
ChatGPT, and Claude's limits for Claude Code in a terminal without the desktop app.

---

## Stage 4 – Shortcuts

A page of buttons, a swipe or a tap on its tab away like the calendar, that open links and apps and send key presses (chosen
on 2026-11-06: no scripts, no Home Assistant). The hub would then do things itself, so this stage begins
with its own security review, and with a probe of how a key press reaches the app it is meant for while
the display's window has the focus. Not to be confused with stage 10, whose keys only answer requests.

---

## Stage 5 – Codex agents ✅

The Codex app for Windows: in 0.3.0, after a probe of the app (it runs command hooks once they are
allowed, and shows its own approval card only after the hook). The usage of the plan, which Codex records
in its transcripts (`rate_limits`), in 0.4.0. The command line in 0.5.3: it uses the same hooks, so its
sessions came already; now they are marked "Codex CLI", and their cards hand over "In the terminal".

---

## Stage 6 – Touch

Fine-tuning for touch on the 12.3″ display. The start with Windows and the fixed full-screen window on
the second screen came with stage 1.

---

## Stage 7 – macOS and Linux

Decided on 2026-11-03; the steps are proposals. Stellwerk on macOS and Linux as on Windows, accepted on
the real setup: a MacBook and a mini PC with Linux. The hub, the display and the hooks of Claude Code and
Codex stay the same; what differs is how Stellwerk is set up around them. In three steps, each a release
of its own:

1. **A portable core.** Settings and files in each system's usual place
   (`~/Library/Application Support/stellwerk` on macOS, `$XDG_CONFIG_HOME` and `$XDG_STATE_HOME` on
   Linux). Files only the user may read get mode 600 in a folder with mode 700, set by Node itself, so the
   hub needs no `icacls` there. Links open with `open` (macOS) and `xdg-open` (Linux), the link as the
   only argument and no shell, in the same four forms. The `test` workflow runs on Windows, macOS and
   Linux.
2. **Start at logon and the display.** A LaunchAgent (macOS) and a systemd user unit (Linux) start the
   hub; the display opens in Chrome or Edge in kiosk mode with a profile of its own. Under Wayland an app
   cannot place its own window on a screen, so the README says how to put it there. `setup`, `status`,
   `update` and `teardown` know all three systems.
3. **Hardware values.** On Linux processor, graphics card and memory from `/sys/class/hwmon` and
   `/proc`, without root. NVIDIA cards report their values only through `nvidia-smi`, a program the hub
   would have to run: to be decided. macOS has no supported way to read temperatures without root, so
   the hardware rows stay off there at first.

To be decided: the firewall rule. On Windows it is a second layer next to the fixed address. On macOS
and Linux a rule needs root; without it the fixed address `127.0.0.1` is the only layer, and
`stellwerk status` says so. Claude's plan usage still needs the desktop app (see stage 3).

---

## Stage 8 – Cursor and GitHub Copilot CLI

Cursor decided on 2026-11-03; Copilot CLI proposed. Not planned: Gemini CLI and Antigravity. Their
sessions appear next to the others, marked "Cursor" and "Copilot CLI". Both run command hooks, so their
events come through a forwarder, as Codex' do. Each starts with a probe of the real app, as Codex did
(stage 5).

- **Cursor, status first.** Its hooks report a session's start and end, each prompt and tool,
  subagents and the end of a turn. Approvals are harder: `beforeShellExecution` and
  `beforeMCPExecution` run before *every* command, not only before those Cursor would ask about.
  Holding them would slow every command, and Cursor is reported not to honour "ask" in every version.
  So there are no cards for Cursor until a probe shows a way to hold only what Cursor would ask.
- **Cursor's command line** (`cursor-agent`) runs fewer hooks than the editor: in 2026 its forum lists
  shell commands, file edits, tools, `stop` and `sessionStart`. A report from August 2026 says it runs no
  hook at all on Linux while the same version does on macOS. The probe covers the editor and the command
  line on each of the three systems, on the real mini PC for Linux.
- **Copilot CLI, with approvals.** It has an event of its own for a permission request, besides
  notifications, sessions and subagents, so its requests can become cards as Claude Code's do. Its
  HTTP hooks require `https://` for approvals; the forwarder talks to `127.0.0.1` instead. Its hook
  file has a schema of its own (`{"version": 1, "hooks": …}` with `timeoutSec`).
- **Context and costs** where transcripts or hooks carry token counts, to be probed. Cursor's hooks
  carry none.

---

## Stage 9 – Costs and limits

Costs decided on 2026-11-03, the details are proposals; the limits' forecast proposed on 2026-11-07.

- **Costs.** What each session's work would cost at the providers' API prices, from the token counts in
  its transcript: input, output, cache reads and cache writes, per model. The hub reads a transcript once
  to its end and from then on only what is new, instead of only its last lines as today. The prices are
  pinned in the code, like LibreHardwareMonitor's version, and a setting `prices` adds or overrides them;
  a model without a price shows "no price", not a guess. A session's details show its cost, the status
  column the day's total. Where stage 13 brings the agents' own figures (`cost.total_cost_usd` from
  Claude Code's statusline, `claude_code.cost.usage` from its telemetry, `token_usage` from Codex'
  `PostModelRequest`), they take the place of the hub's own sums.
- **A budget.** An optional budget for the day (`dailyBudget`, in the currency of the prices): from 80 %
  of it the day's total needs attention, from 90 % it is red, as the plan usage is. Without a budget the
  total is only a number.
- **The plans' windows.** The plan usage of stage 3 gets the time until each limit is reset and a plain
  forecast ("at this pace the five-hour limit is reached at 15:40"). A session that stops at a limit or
  starts again by itself shows it: Claude Code's `StopFailure` with `rate_limit` or `billing_error`, its
  notifications `quota_auto_resume_*`. Background sessions use a plan as interactive ones do, so ten
  sessions use it about ten times as fast as one; the forecast makes that visible.

On a plan this is what the work would cost on the API, not what is billed, and the display says so. The
agents' own cost figures are estimates too, not invoices. No connection to another machine: no prices are
fetched.

---

## Stage 10 – Keys for decisions

Decided on 2026-11-03; the details are proposals. Answering requests without the touchscreen. Not to be
confused with stage 4: its buttons open links and apps and send key presses, these keys only answer
requests.

- **A Stream Deck plugin** (Elgato's SDK, TypeScript; Windows and macOS). One key per session shows its
  status; three keys answer the oldest request: Allow, Deny, In the app.
- **Switching.** A key, or a dial of the Stream Deck+, picks the next session that waits for an answer
  in the app and opens it there, as a tap on the display does today. With stage 11, a key stops a
  session.
- **Keyboard shortcuts** that work while another window has the focus need a helper on each system
  (on macOS with the permission for accessibility): after the Stream Deck, if at all.
- **Patterns that proved themselves** (proposed on 2026-11-07): Allow takes two presses, against an
  allow by accident, as TurnDeck does. One tap picks a session, a second within 350 ms brings its window
  to the front, as Codex Micro does. The keys' colours follow Codex Micro's, which have become a common
  language: white idle, blue working, green done and not yet seen, amber needs you, red error.

The rule: a key decides only the oldest request, and only while a signed-in display shows its card in
full, so a decision is still made where it is read. No "always allow", no key for several requests at
once. A second kind of client that can decide changes the hub's security, so this stage begins with its
own security review.

---

## Stage 11 – Errors and a stop

Decided on 2026-11-03; the details are proposals. Each part starts with a probe of the real apps.

- **A session that failed.** A turn that ended with an error (an API error, a reached limit) shows as
  "error", not as "done". Claude Code's `StopFailure` names the kind of error as its matcher
  (`rate_limit`, `overloaded`, `billing_error`, `authentication_failed`, `server_error`,
  `max_output_tokens` and more); it decides nothing, its output and exit code are ignored. Codex'
  `PostModelRequest` carries `status` and `error`. Cursor's `stop` hook reports an error itself.
- **A stop.** A button in a session's details stops it. Claude Code's hooks can answer with
  `continue: false`, which ends the session's turn after the hook; the hub would give this answer to
  the session's next event. So it takes effect at the next tool call, not in the middle of a long
  answer, and the display says so. Claude Code overrides `Stop` hooks after eight blocks in a row, so the
  hub checks `stop_hook_active` and never makes a loop of it. The probe checks it for each event
  Stellwerk uses, and for Codex. Only a person stops a session; the hub never does so by itself.

Not planned: speaking to agents. The hub would have to write prompts into sessions, and anything that
reaches the hub could then instruct them. Hooks are called only by the agent, so an idle session
could not be reached that way anyway. Dictation into the window in front is the operating system's job.

---

## Stage 12 – What each session is doing

Proposed on 2026-11-07, from the research of November 2026. Today a row says *that* a session waits;
these parts say what it runs with and *why* it waits. All display only, in five small releases.

1. **Model, effort and permission mode as chips.** The model the hub knows from the transcript already;
   `permission_mode` comes with every Claude Code event and with most of Codex', `effort.level` with
   some of Claude Code's (Codex documents none). The modes in which an agent stops asking
   (`bypassPermissions`, `dontAsk`, `auto`, `acceptEdits`) are marked in the colour of attention: in them
   requests pass Stellwerk by, and the display says so plainly. `PermissionDenied` shows, as a note, what
   Claude Code's auto mode turned down by itself.
2. **Compaction.** "Compacting…" while it runs, how often a session was compacted, manual or automatic;
   a folded line can show `compact_summary` as plain text. From `PreCompact` and `PostCompact` of both
   agents (Codex since May 2026).
3. **Why it waits, and its last words.** Instead of "waits for you": a question, idle after a turn, a
   dialog of an MCP server, a limit it waits out (the notification types `idle_prompt`,
   `agent_needs_input`, `elicitation_dialog`, `quota_auto_resume_*`). Below it the agent's last one or two
   sentences, shortened, as text only: Codex' `Stop` carries `last_assistant_message`, as Claude Code's
   `StopFailure` does; for Claude Code's `Stop` the probe shows whether it does too, otherwise the end of
   the transcript.
4. **Who waits longest.** Within each group of the order that exists today, the longest wait first. A
   count on top ("3 wait · oldest 4 min"), and a pin for a session that is to stay on top.
5. **Names that tell sessions apart.** Several sessions in one project get their branch or the first
   characters of their id after the name; the colour set with `/color`, if the hooks carry it.

**How the events come.** Claude Code's `SessionStart` takes no HTTP hooks, so the parts that need it get
a small command forwarder for Claude Code, like Codex' (called as `node "<path>"`, no `.cmd` shims). New
fields need new versions of the agents (for example `TaskCreated` from Claude Code 2.1.290); the hub takes
what comes and leaves out what does not, without an error. Events that could block (`PreCompact`,
`TaskCreated`, `TaskCompleted`, `Stop`) are only observed: the hub answers at once and empty, so no
decision comes in through the back door. Whether Codex' hooks fire reliably on Windows is disputed (open
issues on hooks that never run and on quoted paths): the transcripts stay the fallback, and each part is
checked on the real setup.

---

## Stage 13 – The agents' own numbers

Proposed on 2026-11-07. Two ways for the agents to send their own figures to the hub, both incoming on
`127.0.0.1`, neither an outgoing connection. They are the base for stage 9.

1. **A statusline bridge for Claude Code.** A small statusline script hands the JSON that Claude Code
   gives every statusline to the hub, and prints the user's own statusline unchanged if there is one.
   It brings the session's cost (`cost.total_cost_usd`), the context's exact share
   (`context_window.used_percentage`, right for 200k and 1M windows), the plan's windows with their reset
   (`rate_limits.five_hour`, `seven_day`), the session's name, worktree, repository and pull request.
   Claude Code starts the script, not the hub, as with Codex' forwarder. To be probed: whether the
   desktop app runs a statusline at all (likely only the terminal), so the hooks stay the main source.
   A minimum version, because of a fixed bug with summed instead of current token counts. No call to the
   unofficial usage endpoint some statuslines use: that would be an outgoing connection.
2. **A local OpenTelemetry receiver.** The hub takes OTLP over HTTP in JSON on `127.0.0.1`
   (`/v1/metrics`, `/v1/logs`). Claude Code: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, the exporters `otlp`, read
   at its start only; metrics every 60 s, events every 5 s. Codex: `[otel]` in `~/.codex/config.toml`
   only, not per project, with `otlp-http`. From this: cost and tokens per session and model, API errors,
   the length of turns, and how many requests were decided by settings and how many by a person.
   Prompts stay out (`OTEL_LOG_USER_PROMPTS` and Codex' `log_user_prompt` off). Codex sends metrics to
   OpenAI by default unless `analytics.enabled = false`; the README says so, and `stellwerk setup` changes
   nothing in Codex' configuration without asking.

---

## Stage 14 – Progress and review

Proposed on 2026-11-07. Review is the second bottleneck after attention, so the display shows how far a
session is and where its work lands.

- **Tasks.** "3/7 tasks · now: …" with a thin bar, from Claude Code's `TaskCreated` and `TaskCompleted`
  (`task_subject`, from 2.1.290), answered at once and empty. Codex documents no such event; the probe
  shows whether its plan can be read from its transcripts.
- **Branch, worktree and pull request at the session.** The folder comes with every event (`cwd`,
  `CwdChanged`), worktree and pull request with stage 13's statusline. A session that opened a pull
  request shows its number with the checks the display knows already, and moves to a group "ready for
  review". For Codex the pull request is found by its branch through `api.github.com`, which is a data
  source already. The hub runs no `git` for this, and never registers `WorktreeCreate`, which replaces
  git's own behaviour.

---

## Stage 15 – Tool statistics

Proposed on 2026-11-07. Which tools and commands run how often and how long, and how often they fail,
by day and week, from the `PostToolUse` and `PostToolUseFailure` events the hub gets already. It shows a
session that runs in circles, for example tests that fail again and again. The length needs the time of
`PreToolUse` too, observed only, if the events do not carry it. Kept on this computer for a limited time
(30 days unless set otherwise), next to the audit log.

---

## Stage 16 – Background sessions

Proposed on 2026-11-07. Claude Code's agent view (`claude agents`, a research preview) runs sessions with
no terminal. They appear like the others, marked "background". Their notifications `agent_needs_input`
and `agent_completed` come as hooks; each such session has `CLAUDE_JOB_DIR`, which shows it is one, if the
probe finds a way to see it from a hook. The supported way to read their state is `claude agents --json`,
a program the hub would run: to be decided, either hooks only or a narrow exception of its own. The files
under `~/.claude/jobs/` are not read, as Claude Code's documentation asks.

---

## Stage 17 – Shared memory

Proposed on 2026-11-07. Agents work better when they share their rules and memory, and it is easy to
miss that one of them does not. For each project the display knows from its sessions, the hub checks, by
reading only:

- whether there is an `AGENTS.md`, and whether `CLAUDE.md` takes it in (`@AGENTS.md`), so Claude Code,
  Codex and Cursor follow the same rules;
- whether Cursor has rules of its own for the project (`.cursor/rules`);
- whether Claude Code (`~/.claude.json`, `.mcp.json`), Codex (`~/.codex/config.toml`) and Cursor
  (`~/.cursor/mcp.json`) have the same memory server among their MCP servers.

The result is a light per project with one sentence of advice ("Codex does not know the project's rules:
add an AGENTS.md"). The advice comes from fixed rules in the hub, not from a model. The hub reads only
the names of MCP servers, never their addresses, keys or environment, and shows nothing but those names.
Fixing what it finds stays the user's or the agent's job; a button that writes the file would need the
guardrail change.

---

## Stage 18 – The agents as a track diagram

Proposed on 2026-11-07. A page of its own, a tab away like the calendar: each session as a track, its
subagents and teammates branching off it, each with its state in the colours of stage 10 (working,
waiting, done, error), its task from stage 14 and how full its context is. A signal box's track diagram,
which is what Stellwerk is named after. From `SubagentStart` and `SubagentStop` of both agents, which the
hub gets already, and the teammates of Claude Code's agent teams (`teammate_name`). Display only; a tap on
a track opens the session's details as on the first page. Drawn by the hub's own code, without a library
from outside, under the display's Content Security Policy.

---

## Stage 19 – A window for everyone

Proposed on 2026-11-07. Stellwerk for people who work with agents but are not developers, and who have no
second screen.

- **Any window.** The display also as an ordinary window on a laptop's screen, its columns stacked when
  the window is narrow. The second screen at 1920×720 stays the main case and keeps its layout.
- **Plain words.** A setting `language: "plain"` puts every state and hint in everyday words ("Claude
  asks whether it may delete a file") in English and German.
- **What a request means.** A permission card gets one line above the full input that says in plain
  words what it would do and how risky it is: delete, overwrite, run, send over the network. The line
  comes from fixed rules in the hub, not from a model, and never takes the place of the full input; a
  request no rule knows says so.
- **A setup that explains.** `stellwerk setup` says what each step does and why, and stops before each
  change to an agent's settings.

Depends on stage 7 for the Mac.

---

## Stage 20 – Jira: a proposal first

Proposed on 2026-11-07; needs the guardrail change. A Jira work item or epic gets a proposal from an agent
the person chooses, in plain words, before anyone writes code. Jira can itself assign work to cloud
agents (Claude's, for example, works in a cloud sandbox and in a GitHub repository); this stage
is the way for agents on the user's own computer, with any git host, under Stellwerk's eyes.

1. **Started in Jira.** A Jira automation rule with a manual trigger, run from the work item's actions,
   asks which agent (a list: Claude Code, Codex, later Cursor) and sets a label. Only a named group may
   run the rule. Typed fields, not free text, choose the agent.
2. **Fetched by the hub.** The hub cannot be reached from outside and stays so: it asks Jira every
   minute for labelled work items (JQL), with an API token kept like the others (readable by the user
   only, never logged, never sent to the display). A setting maps Jira projects to folders on this
   computer. The connection goes to Jira only, its data source.
3. **Analysed, read only.** The hub starts the chosen agent in a fixed form: Claude Code with `claude -p`
   in plan mode and read tools only, Codex with `codex exec --sandbox read-only`. No network tools, no
   MCP servers. The ticket's text goes in as data, marked as such: anyone who can write in Jira can write
   instructions into it. A fixed instruction asks for at most five sentences without jargon: what is to
   be done, in which steps, how much work, what can go wrong, one agent or several. One analysis per
   project at a time, with a time limit.
4. **Answered twice.** The proposal comes back as a comment on the work item and as a card on the
   display, with **Implement** (stage 21) and **Discard**.

Begins with its own security review.

---

## Stage 21 – Jira: implement on a tap

Proposed on 2026-11-07; needs stage 20 and the guardrail change. A tap on **Implement**, on the display
only, never in Jira, has the hub create one worktree per part of the proposal, on a branch named after
the work item, and start the agents there in fixed forms and in a mode that asks, so their requests come
to the display or the app as in any session. A run without a terminal may deny what it would ask
instead, which is safe but stalls; the probe shows which way of starting keeps the requests coming. At
most as many agents at once as a setting allows. Their sessions run as all others do on the display, in
the track diagram of stage 18. When they are done, the work item gets a comment with the branches and,
with stage 14, the pull requests. The hub never merges, never pushes by itself and never decides a
request.

Begins with its own security review.

---

## Not planned

From the research of November 2026 and earlier decisions; each would break a guardrail or turn
Stellwerk from a display that decides with a person into a remote control:

- **Approving by rule:** "always allow", automatic approval, prompt or agent hooks that decide through
  a model.
- **Access from other devices:** the local network, mDNS, Bluetooth or Wi-Fi devices, tunnels.
- **Starting sessions, sending prompts, creating or merging worktrees** as orchestrators do. Stages 20
  and 21 would allow exactly their fixed forms, once decided, and nothing beyond them; merging never.
- **Switching accounts and asking the providers for quotas,** or rewriting an agent's login.
- **Summaries of sessions by a model:** that would send session content to an AI service. The display
  shows the agent's last words as text instead (stage 12).
- **Messages between sessions or answers typed into a session,** and speaking to agents (see stage 11).
- **A full transcript browser with Markdown:** short extracts as text only.
- **Gemini CLI and Antigravity** (decided on 2026-11-03).

---

## Technical debt

| Topic | Proposal |
|---|---|
| Shared design files (`azentrius.css`, fonts) are copies | keep them byte-identical with the other Azentrius add-ons; change them only together |
| The shared DM Serif Display file holds only the letters of the Azentrius word mark | the word mark "Stellwerk." uses DM Sans; a fuller subset would have to come from the design system |
