// Checks an installed hub as a display uses it: the address alone gets the display without its page token,
// the start file the hub wrote signs the display in and gets it, and the display's files are served. For CI,
// after the package is installed and `serve` started.
//
// Usage: node tools/check-install.ts [port]     (LOCALAPPDATA as the hub has it)
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] ?? 4780);
const base = `http://127.0.0.1:${port}`;
const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error('LOCALAPPDATA is not set.');

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
  console.log(`ok  ${message}`);
}

const anonymous = await fetch(`${base}/`);
const anonymousPage = await anonymous.text();
check(anonymous.status === 200 && !/stellwerk-session" content="[0-9a-f]{64}"/.test(anonymousPage) && !anonymous.headers.has('set-cookie'), '/ without sign-in: no page token, no cookie');

const start = fs.readFileSync(path.join(localAppData, 'stellwerk', 'display.html'), 'utf8');
const key = /name="key" value="([0-9a-f]{64})"/.exec(start)?.[1];
check(key !== undefined && start.includes(`action="${base}/login"`), 'the start file posts a key to /login');

const login = await fetch(`${base}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'null' },
  body: `key=${key}`,
});
const signed = await login.text();
check(login.status === 200 && /stellwerk-session" content="[0-9a-f]{64}"/.test(signed) && !login.headers.has('set-cookie'), 'sign-in: the page with its token, no cookie');

for (const file of ['/app.js', '/app.css', '/static/fonts/RedHatMono/RedHatMonoVF.woff2']) {
  const reply = await fetch(`${base}${file}`);
  await reply.arrayBuffer();
  check(reply.status === 200, `${file} 200`);
}
