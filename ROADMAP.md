# Roadmap

As of 2026-10-18. Each stage is useful on its own and brings its own tests. Stages after 1 are proposals
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

## Stage 2 – System values and alerts

CPU, memory and temperatures from LibreHardwareMonitor: done in 0.2.0. Still open: server and app alerts
from Uptime Kuma, in the column kept free.

---

## Stage 3 – Usage of Claude and ChatGPT

How much of the plans' limits is used. Only unofficial endpoints exist (as used by the Stream Deck
plugins), so this can break at any time and must fail quietly.

---

## Stage 4 – Shortcuts

Buttons for local scripts and Home Assistant webhooks. The hub would then start things itself, so this
stage begins with its own security review.

---

## Stage 5 – Codex agents

The Codex app for Windows: in 0.3.0, after a probe of the app (it runs command hooks once they are
allowed, and shows its own approval card only after the hook). Still open: the Codex command line, and
the usage of the plan, which Codex records in its transcripts (`rate_limits`).

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
