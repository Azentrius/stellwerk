# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report them privately through GitHub instead:
[Report a vulnerability](https://github.com/Azentrius/stellwerk/security/advisories/new)
(tab **Security → Report a vulnerability** in this repository).

Please include:

- what is affected (hub, display, hook setup, firewall rule, hardware monitor
  setup; version or commit),
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
- the display signs in before it gets anything: a start file readable by
  the current Windows user only posts a key derived from the hook token, and
  only the hub's answer to it carries the page token the WebSocket needs;
  the display keeps it in storage of the hub's origin (address and port),
  which other sites and ports cannot read, and sends it only in the
  WebSocket handshake; there is no cookie, since cookies of `127.0.0.1` go
  to every port and so to other local services; the address alone gives no
  token; the key is in no address and no log; `tools/check-browser.ts`
  checks this in a real Edge with a second local service;
- decisions travel only over the display's WebSocket, which needs the right
  `Host`, the right `Origin` and the page token from the sign-in; a broken or oversized message (over 4 KB) or an unreadable
  request target closes only its own connection;
- every request is checked against `Host` (DNS rebinding);
- nothing is allowed automatically;
- the hub starts no programs; only the setup commands run `icacls`,
  `powershell`, `netsh` and `schtasks`, with fixed arguments and without a
  shell; `serve` restricts the token file and the display's start file with
  `icacls` when it creates or changes them;
- the hub connects to two other machines at most. One is `api.github.com`
  (fixed in the code), for the list of open pull requests, and only once a GitHub
  token is set up: fine-grained only, meant to read pull requests and Actions
  and nothing else, kept like the hook token, never logged, never sent to the
  display; GitHub's answers are checked before use, redirects are not
  followed, and of the "next" links of long lists only those on
  `api.github.com` are followed, at most 10 pages per list;
- the other is Uptime Kuma at the
  address set up with `stellwerk kuma key` (http or https, host and port,
  no path), only for `/metrics`, only once an API key is set up (which in
  Uptime Kuma 2 opens `/metrics` and nothing else), kept like the hook
  token, never logged, never sent to the display; redirects are not
  followed, and of the answer the hub keeps only each monitor's name and
  status;
- besides that the hub asks only LibreHardwareMonitor on `127.0.0.1:8085`
  for `data.json`, when the hardware monitor is set up, with the password
  from LibreHardwareMonitor's settings file, and never sends that password
  to the display;
- for the context meters the hub reads session transcripts named in hook
  events, only under `%USERPROFILE%\.claude\projects` and
  `%USERPROFILE%\.codex\sessions` (after following links), only from their
  end, and keeps only the token counts, the model, the context window and,
  for Codex, who approves and the usage of the plan's limits; nothing else of
  a transcript reaches its state, the display or its file `plans.json`;
- of what tools return, the hub looks only at the desktop app's answer to
  `get_usage` in a `PostToolUse` hook and keeps only the plan's limits from it;
- for the names of Codex sessions the hub reads Codex' session index
  (`%USERPROFILE%\.codex\session_index.jsonl`, a fixed path, never one from
  hook data) from its end and keeps only the name of a session it shows; for
  their projects it reads the Codex app's state file
  (`%USERPROFILE%\.codex\.codex-global-state.json`, a fixed path) after it
  changed and keeps only project names and which chat belongs to which; the
  title of a Claude Code session comes from its transcript like its token
  counts;
- Codex events reach the hub through Stellwerk's forwarder, which Codex runs
  as a command hook: it reads the hook token from the token file, posts to
  `127.0.0.1` only, prints only the hub's answer and ends at once without a
  hub; the hub checks these events like all others;
- `stellwerk hardware install` downloads exactly one LibreHardwareMonitor
  archive, pinned in the code by URL, size and SHA-256, unpacks it only into
  its own folder in Program Files (refusing any file name that would leave
  it), turns on LibreHardwareMonitor's password and blocks its port for other
  machines; that program runs with administrator rights, from a folder only
  administrators can change;
- the start of the hub and the display with Windows runs as the current user
  without elevation;
- the display loads only the hub's own files under a strict Content Security
  Policy and shows hook data and pull request titles as text only.

## Especially relevant

Reports are particularly welcome for:

- ways to allow or deny a request without the display, or from another
  machine, another user account or a web page,
- ways around the token, the `Host` or `Origin` check, the display's sign-in
  or the page token,
- requests that end the hub instead of only their own connection,
- hook data that the display renders as HTML or script,
- the hook token, the GitHub token or the API key of Uptime Kuma appearing in
  a log, a URL, a page or any file other than its own,
- the hub connecting anywhere but `api.github.com`, Uptime Kuma's `/metrics`
  at the address set up and LibreHardwareMonitor on `127.0.0.1:8085`, or to
  them without being set up,
- a hook event that makes the hub read a file outside the transcripts folders,
  or anything of a transcript beyond its token counts and limits reaching the
  display,
- the forwarder printing anything but the hub's answer, sending the token
  elsewhere, or making Codex wait beyond its hook timeout; `stellwerk codex
  install` or `uninstall` changing more of Codex' hooks than Stellwerk's own,
- `stellwerk hardware install` accepting another file than the pinned one,
  writing outside its folder, or leaving LibreHardwareMonitor's web server
  reachable without the password or from other machines,
- an unanswered or slow hub blocking Claude Code beyond the hook timeouts,
- `stellwerk hooks install` or `uninstall` changing more of Claude Code's
  settings than Stellwerk's own entries,
- `stellwerk autostart install` registering tasks that run with more rights
  or other programs than the ones it shows.
