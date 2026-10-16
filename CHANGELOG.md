# Changelog

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
