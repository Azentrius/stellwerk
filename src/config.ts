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
  };
}

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
});

export type Config = z.infer<typeof configSchema>;

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
