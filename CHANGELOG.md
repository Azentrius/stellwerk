# Changelog

## 0.1.0 – not released yet

The first version: Claude Code sessions and their permission requests on a desk display.

- **Hub:** receives Claude Code's HTTP hooks on `127.0.0.1`, keeps the status of every session in
  memory and holds permission requests until the display decides or the hold time (60 s) is up. Writes
  every request and its outcome to an audit log.
- **Display:** three columns for 1920×720 in Azentrius dark: the open requests with the complete input
  and Allow, Deny and In the app; the sessions with status, subagents and last activity; clock and the
  hub's state. Buttons 64 px high, no text below 20 px, one scale factor, English and German.
- **Setup:** `stellwerk hooks install` and `uninstall` add and remove exactly Stellwerk's hooks in
  Claude Code's settings (with a diff, a question and a backup) and the token variable;
  `stellwerk install` and `uninstall` add and remove the firewall rule.
- **Safety:** token for hook requests, `Host` and `Origin` checks, page token for the WebSocket, strict
  Content Security Policy, no outgoing connections, no automatic decisions.
