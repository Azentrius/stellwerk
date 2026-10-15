# Changelog

## 0.2.0 – not released yet

The display in four columns and truly full screen; what waits in the app is listed too.

- **Four columns:** the sessions on the left, what waits for you next to them, a column kept free for
  what comes next, and clock and hub on the right.
- **Names first:** sessions and cards show the session's name in bold and the project below.
- **Answer in the app:** sessions waiting for an answer in the app (a question, some input, a permission
  open there) are listed below the cards, with how long they have been waiting. A column with more than
  fits fades out at the bottom.
- **Full screen:** the display started with Windows opens in Edge's kiosk mode, without title bar and
  over the taskbar. Run `stellwerk autostart install` again to switch an existing setup.
- **Word mark:** "Stell" in the text colour, "werk" in gold and italic.
- **Open pull requests:** with a fine-grained read-only token (`stellwerk github token --owner NAME`), the
  open pull requests of all the owner's repositories are listed under "Waiting for you", each with the
  state of its Actions runs; the status column says when the list was updated or why that failed. This
  is the hub's only outgoing connection, to `api.github.com`, and it exists only with the token.

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
