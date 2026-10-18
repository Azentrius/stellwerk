// Checks an installed hub as a display uses it: the address alone gets the locked page, the start file
// the hub wrote signs the display in, and the signed-in page and the display's files are served. For CI,
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

const locked = await fetch(`${base}/`);
const lockedPage = await locked.text();
check(locked.status === 401 && !/stellwerk-session" content="[0-9a-f]{64}"/.test(lockedPage), '/ without sign-in: 401, no page token');

const start = fs.readFileSync(path.join(localAppData, 'stellwerk', 'display.html'), 'utf8');
const key = /name="key" value="([0-9a-f]{64})"/.exec(start)?.[1];
check(key !== undefined && start.includes(`action="${base}/login"`), 'the start file posts a key to /login');

const login = await fetch(`${base}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'null' },
  body: `key=${key}`,
  redirect: 'manual',
});
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
check(login.status === 303 && /^stellwerk_display=[0-9a-f]{64}$/.test(cookie), 'sign-in: 303 with the display cookie');

const page = await fetch(`${base}/`, { headers: { Cookie: cookie } });
check(page.status === 200 && /stellwerk-session" content="[0-9a-f]{64}"/.test(await page.text()), '/ signed in: 200 with the page token');

for (const file of ['/app.js', '/app.css', '/static/fonts/RedHatMono/RedHatMonoVF.woff2']) {
  const reply = await fetch(`${base}${file}`);
  await reply.arrayBuffer();
  check(reply.status === 200, `${file} 200`);
}
