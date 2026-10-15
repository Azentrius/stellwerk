# Roadmap

As of 2026-10-15. Each stage is useful on its own and brings its own tests. Stages after 1 are proposals
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

## Stage 1 – Claude Code sessions and permission requests

Built in 0.1.0 (see [CHANGELOG](CHANGELOG.md)): the hub, the display, the hook setup, the firewall rule,
the start with Windows, the release package and workflow. The acceptance tests passed on the real setup.

Still open before the first release:

- A few days in daily use, on the real 12.3″ display.

---

## Stage 2 – System values and alerts

CPU, memory and temperatures from LibreHardwareMonitor's web server (port 8085); server and app alerts
from Uptime Kuma. Shown in the right-hand column.

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

Codex has hooks of its own, permission requests included. Before starting, check against the official
documentation whether the ChatGPT app for Windows runs them, the same way stage 1 began with a probe of
the Claude desktop app.

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
