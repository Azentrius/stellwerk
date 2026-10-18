// Where Stellwerk keeps its files, and its configuration (config.json).
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

/** The hub listens on this address only. Fixed on purpose: only the port can be configured. */
export const HOST = '127.0.0.1';
export const HOOK_PATH = '/hooks/claude-code';
/** Codex' hooks are commands; its forwarder (dist/codex/hook.js) posts their events here. */
export const CODEX_HOOK_PATH = '/hooks/codex';
/**
 * Timeout of Codex' PermissionRequest hook, in seconds. The Codex app shows its own approval card only
 * after the hook, so the hold time is kept short (`codexHoldSeconds`) and at least 10 s below this.
 */
export const CODEX_PERMISSION_TIMEOUT_S = 45;
/** Timeout of the PermissionRequest hook in Claude Code's settings, in seconds. */
export const PERMISSION_HOOK_TIMEOUT_S = 90;
/** The hold time stays at least this much shorter than the hook timeout. */
export const HOLD_MARGIN_S = 10;

export interface Paths {
  configFile: string;
  tokenFile: string;
  auditFile: string;
  rawLogFile: string;
  /** The messages of the hub started at logon, which has no window. */
  hubLogFile: string;
  /** The Edge profile of the display window started at logon. */
  displayProfileDir: string;
  /** The read-only GitHub token for the list of open pull requests. */
  githubTokenFile: string;
  /**
   * LibreHardwareMonitor, set up by `stellwerk hardware install`. In Program Files, where only
   * administrators can change it: it runs with their rights.
   */
  hardwareDir: string;
  /** Codex' home: its hooks.json, and its transcripts under sessions/. */
  codexHome: string;
}

/** %APPDATA%\stellwerk for the configuration, %LOCALAPPDATA%\stellwerk for everything the hub writes. */
export function defaultPaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = os.homedir();
  const configDir = path.join(env.APPDATA ?? path.join(home, '.config'), 'stellwerk');
  const dataDir = path.join(env.LOCALAPPDATA ?? path.join(home, '.local', 'state'), 'stellwerk');
  return {
    configFile: path.join(configDir, 'config.json'),
    tokenFile: path.join(dataDir, 'token'),
    auditFile: path.join(dataDir, 'audit.jsonl'),
    rawLogFile: path.join(dataDir, 'debug-raw.jsonl'),
    hubLogFile: path.join(dataDir, 'hub.log'),
    displayProfileDir: path.join(dataDir, 'edge-display'),
    githubTokenFile: path.join(dataDir, 'github-token'),
    hardwareDir: path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Stellwerk', 'LibreHardwareMonitor'),
    codexHome: env.CODEX_HOME || path.join(home, '.codex'),
  };
}

/** A GitHub user or organisation name. */
export const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

const configSchema = z.strictObject({
  port: z.number().int().min(1024).max(65535).default(4780),
  holdSeconds: z
    .number()
    .int()
    .min(10)
    .max(PERMISSION_HOOK_TIMEOUT_S - HOLD_MARGIN_S)
    .default(60),
  sound: z.boolean().default(false),
  scale: z.number().min(0.5).max(3).default(1),
  debugRawLog: z.boolean().default(false),
  /** Whose open pull requests to show (with a token from `stellwerk github token`). */
  githubOwner: z.string().regex(GITHUB_OWNER).optional(),
  githubIntervalSeconds: z.number().int().min(60).max(3600).default(120),
  /** Show CPU, memory and graphics card from LibreHardwareMonitor (set by `stellwerk hardware install`). */
  hardwareMonitor: z.boolean().default(false),
  /**
   * How long a Codex request waits on the display before the Codex app shows its own card. Short, since
   * the app waits for it; at least 10 s below Codex' hook timeout of 45 s.
   */
  codexHoldSeconds: z
    .number()
    .int()
    .min(10)
    .max(CODEX_PERMISSION_TIMEOUT_S - HOLD_MARGIN_S)
    .default(30),
  /** Context windows by model id, for models Stellwerk does not know (e.g. "claude-sonnet-5-5": 1000000). */
  contextWindows: z.record(z.string().min(1).max(200), z.number().int().min(1000).max(100_000_000)).default({}),
});

export type Config = z.infer<typeof configSchema>;

/** Sets one value in config.json and keeps the others; the result must still be a valid configuration. */
export function setConfigValue(file: string, key: keyof Config, value: unknown): void {
  const raw = fs.existsSync(file) ? readJsonFile(file) : {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${file} does not hold a JSON object.`);
  const next = { ...(raw as Record<string, unknown>), [key]: value };
  const parsed = configSchema.safeParse(next);
  if (!parsed.success) throw new Error(`${file}:\n${z.prettifyError(parsed.error)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}

/** Reads a JSON file, tolerating the byte order mark that Windows editors like to add. */
export function readJsonFile(file: string): unknown {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  try {
    return text.trim() === '' ? {} : JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
  }
}

/** The configuration; a missing file means all defaults. */
export function loadConfig(file: string): Config {
  const raw = fs.existsSync(file) ? readJsonFile(file) : {};
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${file}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
