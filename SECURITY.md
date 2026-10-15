# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report them privately through GitHub instead:
[Report a vulnerability](https://github.com/Azentrius/stellwerk/security/advisories/new)
(tab **Security → Report a vulnerability** in this repository).

Please include:

- what is affected (hub, display, hook setup, firewall rule; version or commit),
- steps to reproduce,
- the impact you expect.

We aim to acknowledge reports within 7 days. This is a small project, so a fix
may take longer; we will keep you informed and credit you in the advisory
unless you prefer to stay anonymous.

## Supported versions

Only the latest release and the latest state of the `main` branch receive
security fixes.

## What Stellwerk does

The hub can allow tool calls of AI agents: a decision on the display lets
Claude Code run a command or change a file. That is why it is built to be
reachable only from the machine it runs on and only by the display it serves:

- it listens on `127.0.0.1` only (fixed in the code), with a firewall rule
  that blocks the port for other machines as a second layer;
- hook requests need a bearer token and `Content-Type: application/json`;
  the token file is readable by the current Windows user only and the token
  is never logged;
- decisions travel only over the display's WebSocket, which needs the right
  `Host`, the right `Origin` and a token the hub puts into the page;
- every request is checked against `Host` (DNS rebinding);
- nothing is allowed automatically;
- the hub starts no programs and opens no outgoing connections; only the
  setup commands run `icacls`, `powershell`, `netsh` and `schtasks`, with
  fixed arguments and without a shell;
- the start with Windows runs as the current user without elevation;
- the display loads only the hub's own files under a strict Content Security
  Policy and shows hook data as text only.

## Especially relevant

Reports are particularly welcome for:

- ways to allow or deny a request without the display, or from another
  machine, another user account or a web page,
- ways around the token, the `Host` or `Origin` check or the page token,
- hook data that the display renders as HTML or script,
- the token appearing in a log, a URL, a page or any file other than its own,
- an unanswered or slow hub blocking Claude Code beyond the hook timeouts,
- `stellwerk hooks install` or `uninstall` changing more of Claude Code's
  settings than Stellwerk's own entries,
- `stellwerk autostart install` registering tasks that run with more rights
  or other programs than the ones it shows.
