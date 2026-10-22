# Roadmap

As of 2026-10-22. Each stage is useful on its own and brings its own tests. Stages after 1 are proposals
until they are decided.

**Guardrails for every stage** (they keep applying):

- **Local only:** the hub listens on `127.0.0.1`, fixed in the code. No access from other devices, no
  tablet, no tunnel, in no stage.
- **No automatic decisions:** a request is allowed or denied by a person, on the display or in the app.
- **The hub runs nothing:** it answers requests and shows status. Stage 4 changes that and gets its own
  security review first.
- **No outgoing connections** unless a stage needs one for its data source, and then only to that source.
- **Display:** only the hub's own files, strict Content Security Policy, nothing inline, hook data as text
  only. Every text in English and German. Usable with fingers at 1920×720.
- **Tests:** unit tests for the logic, the hub end to end for every change.

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

Buttons for local scripts and Home Assistant webhooks. The hub would then start things itself, so this
stage begins with its own security review.

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

## Technical debt

| Topic | Proposal |
|---|---|
| Shared design files (`azentrius.css`, fonts) are copies | keep them byte-identical with the other Azentrius add-ons; change them only together |
| The shared DM Serif Display file holds only the letters of the Azentrius word mark | the word mark "Stellwerk." uses DM Sans; a fuller subset would have to come from the design system |
