// Starts a hub with made-up sessions and open requests: for screenshots and for working on the display
// without the real token or audit log (a fresh token, the audit log in a temporary folder).
//
// Usage: npm run build && node tools/demo.ts [port] [--more]     then open http://127.0.0.1:4781/?lang=en
//
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { HOOK_PATH } from '../src/config.ts';
import { startHub } from '../src/hub/hub.ts';

const ROOT = path.join(import.meta.dirname, '..');
const port = Number(process.argv.slice(2).find((arg) => /^\d+$/.test(arg)) ?? 4781);
const token = randomBytes(32).toString('hex');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
// A stand-in for api.github.com: the demo goes to no network and to no LibreHardwareMonitor.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const fakeGitHub: Record<string, unknown> = {
  '/orgs/example/repos': [{ name: 'shop-api' }, { name: 'customer-portal-frontend' }],
  '/repos/example/shop-api/pulls': [
    { number: 41, title: 'Release 2.3', updated_at: hoursAgo(0.2), user: { login: 'dev' }, head: { sha: 'a'.repeat(40) } },
    { number: 39, title: 'Bump zod from 4.1 to 4.2', updated_at: hoursAgo(5), user: { login: 'dependabot[bot]' }, head: { sha: 'b'.repeat(40) } },
  ],
  '/repos/example/customer-portal-frontend/pulls': [
    { number: 12, title: 'New landing page', draft: true, updated_at: hoursAgo(1), user: { login: 'dev' }, head: { sha: 'c'.repeat(40) } },
  ],
};
const runsFor: Record<string, unknown> = {
  ['a'.repeat(40)]: [{ status: 'in_progress', conclusion: null }],
  ['b'.repeat(40)]: [{ status: 'completed', conclusion: 'success' }],
  ['c'.repeat(40)]: [{ status: 'completed', conclusion: 'failure' }],
};
const demoFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const body = url.pathname.endsWith('/actions/runs')
    ? { workflow_runs: runsFor[url.searchParams.get('head_sha') ?? ''] ?? [] }
    : fakeGitHub[url.pathname];
  return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
}) as typeof fetch;
// And one for LibreHardwareMonitor on 127.0.0.1:8085, with values that move a little.
const sensor = (id: string, name: string, type: string, value: string) => ({ Text: name, SensorId: id, Type: type, RawValue: value, Children: [] });
const wobble = (base: number) => (base + Math.random() * 4 - 2).toFixed(1);
const demoHardwareFetch = (async () =>
  new Response(
    JSON.stringify({
      Text: 'Sensor',
      Children: [
        {
          Text: 'DEMO-PC',
          Children: [
            sensor('/intelcpu/0/load/0', 'CPU Total', 'Load', `${wobble(23)} %`),
            sensor('/intelcpu/0/temperature/13', 'CPU Package', 'Temperature', `${wobble(61)} °C`),
            sensor('/gpu-nvidia/0/load/0', 'GPU Core', 'Load', `${wobble(8)} %`),
            sensor('/gpu-nvidia/0/temperature/0', 'GPU Core', 'Temperature', `${wobble(48)} °C`),
            sensor('/ram/load/0', 'Memory', 'Load', '45.2 %'),
            sensor('/ram/data/0', 'Memory Used', 'Data', '14.3 GB'),
            sensor('/ram/data/1', 'Memory Available', 'Data', '17.4 GB'),
          ],
        },
      ],
    }),
    { status: 200 },
  )) as typeof fetch;
const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellwerk-demo-'));

const hub = await startHub({
  port,
  token,
  holdMs: 30 * 60_000,
  scale: 1,
  version,
  sound: false,
  auditFile: path.join(demoDir, 'audit.jsonl'),
  uiRoot: path.join(ROOT, 'ui'),
  webRoot: path.join(ROOT, 'dist', 'ui'),
  github: { owner: 'example', token: `github_pat_${'demo'.repeat(8)}`, intervalMs: 3_600_000, fetch: demoFetch },
  hardware: { settingsFile: path.join(demoDir, 'LibreHardwareMonitor.config'), intervalMs: 5000, fetch: demoHardwareFetch },
});
console.log(`Demo hub on http://127.0.0.1:${hub.port}/  (add ?lang=en or ?lang=de)`);
if (hub.missingBuild) console.log('The display is not built yet. Run "npm run build" first.');

function send(session: string, project: string, body: Record<string, unknown>): void {
  const payload = JSON.stringify({ session_id: session, cwd: `C:\\Projects\\${project}`, ...body });
  const req = http.request({
    host: '127.0.0.1',
    port: hub.port,
    method: 'POST',
    path: HOOK_PATH,
    agent: false,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  });
  req.on('response', (res) => res.resume());
  req.on('error', () => {});
  req.end(payload);
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

send('docs', 'docs', { hook_event_name: 'Stop', session_title: 'Update the install guide' });
send('mobile', 'mobile-app', { hook_event_name: 'UserPromptSubmit', session_title: 'Offline mode' });
send('mobile', 'mobile-app', { hook_event_name: 'SessionEnd', reason: 'other' });
send('pipeline', 'data-pipeline', { hook_event_name: 'UserPromptSubmit', session_title: 'Nightly import' });
send('pipeline', 'data-pipeline', { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' });
send('pipeline', 'data-pipeline', { hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'Plan' });
send('website', 'website', { hook_event_name: 'Notification', notification_type: 'idle_prompt', session_title: 'New landing page' });
// Waiting for an answer in the app: a question, and a permission the app shows itself.
send('design', 'design-tokens', {
  hook_event_name: 'PermissionRequest',
  session_title: 'Dark theme contrast',
  tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Which contrast level?', options: [{ label: 'AA' }, { label: 'AAA' }] }] },
});
await pause(400);
send('infra', 'infrastructure', { hook_event_name: 'UserPromptSubmit', session_title: 'Renew certificates' });
send('infra', 'infrastructure', { hook_event_name: 'Notification', notification_type: 'permission_prompt' });
await pause(300);
send('shop', 'shop-api', {
  hook_event_name: 'PermissionRequest',
  session_title: 'Release 2.3',
  tool_name: 'Bash',
  tool_input: { command: 'git push origin release/2.3', description: 'Push the release branch' },
});
// A second card (an edit) only with "--more"; with it the answers below no longer fit on 720 px.
if (process.argv.includes('--more')) {
  await pause(1200);
  send('checkout', 'shop-api', {
    hook_event_name: 'PermissionRequest',
    session_title: 'Rate limit for the checkout',
    tool_name: 'Edit',
    tool_input: {
      file_path: 'C:\\Projects\\shop-api\\src\\checkout\\limits.ts',
      old_string: 'const limit = 100;',
      new_string: 'const limit = 10; // per minute and address\nconst window = 60_000;',
    },
  });
}
