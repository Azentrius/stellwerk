// The hardware values on the display: processor, graphics card and memory from LibreHardwareMonitor,
// which `stellwerk hardware install` sets up. Every few seconds the hub asks its web server on
// 127.0.0.1:8085 for data.json, with the user name and password from LibreHardwareMonitor's settings
// file, and picks out a few values. It asks for nothing else and sets nothing.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import { z } from 'zod';
import type { Gauge, HardwareProblem, HardwareValues, HardwareView, MemoryGauge } from '../shared/protocol.js';

export const LHM_PORT = 8085;
export const LHM_URL = `http://127.0.0.1:${LHM_PORT}/data.json`;
/** LibreHardwareMonitor keeps its settings next to its program. */
export const LHM_SETTINGS_FILE = 'LibreHardwareMonitor.config';
export const HARDWARE_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 3000;
const MAX_ANSWER_BYTES = 4 * 1024 * 1024;

// ---------- LibreHardwareMonitor's settings file ----------

/** The key/value pairs of LibreHardwareMonitor's settings file, an XML appSettings section as it writes it. */
export function parseAppSettings(xml: string): Map<string, string> {
  const settings = new Map<string, string>();
  for (const match of xml.matchAll(/<add\s+key="([^"]*)"\s+value="([^"]*)"\s*\/>/g)) {
    settings.set(unescapeXml(match[1]!), unescapeXml(match[2]!));
  }
  return settings;
}

export function appSettingsXml(settings: Map<string, string>): string {
  const lines = [...settings].map(([key, value]) => `    <add key="${escapeXml(key)}" value="${escapeXml(value)}" />`);
  return `<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <appSettings>\n${lines.join('\n')}\n  </appSettings>\n</configuration>\n`;
}

/**
 * The Basic authorization LibreHardwareMonitor expects, or null when its password check is off.
 *
 * Version 0.9.6 keeps a hash of the password in the file and hashes the file's value once more when it
 * starts, so the password it accepts is the value in the file at its start; when it ends it writes the
 * next one. Hence the hub reads the file again when it is turned away.
 */
export function lhmAuthorization(settings: Map<string, string>): string | null {
  if (settings.get('authenticationEnabled') !== 'true') return null;
  const user = settings.get('authenticationUserName') ?? '';
  const password = settings.get('authenticationPassword') ?? '';
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function unescapeXml(value: string): string {
  return value.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g, (_, hex: string, dec: string, name: string) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name]!;
  });
}

// ---------- data.json ----------

/** A node of LibreHardwareMonitor's tree: the computer, a part, a sensor type or a sensor. */
interface LhmNode {
  Text: string;
  SensorId?: string | undefined;
  Type?: string | undefined;
  /** Formatted in LibreHardwareMonitor's language: "45,5 °C" on a German Windows. */
  RawValue?: string | undefined;
  Value?: string | undefined;
  Children: LhmNode[];
}

const lhmNode: z.ZodType<LhmNode> = z.lazy(() =>
  z.object({
    Text: z.string(),
    SensorId: z.string().optional(),
    Type: z.string().optional(),
    RawValue: z.string().optional(),
    Value: z.string().optional(),
    Children: z.array(lhmNode),
  }),
);

export interface Sensor {
  /** For example /intelcpu/0/temperature/3: the part, the sensor type, a number. */
  id: string;
  name: string;
  type: string;
  value: number | null;
}

export function readSensors(data: unknown): Sensor[] | null {
  const parsed = lhmNode.safeParse(data);
  if (!parsed.success) return null;
  const sensors: Sensor[] = [];
  const visit = (node: LhmNode) => {
    if (node.SensorId && node.Type) {
      sensors.push({ id: node.SensorId, name: node.Text, type: node.Type, value: sensorNumber(node.RawValue ?? node.Value) });
    }
    node.Children.forEach(visit);
  };
  visit(parsed.data);
  return sensors;
}

/** The number at the start of a formatted value, with a decimal point or comma. */
export function sensorNumber(text: string | undefined): number | null {
  const match = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(text ?? '');
  if (!match) return null;
  const n = Number(match[1]!.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** The temperatures that stand for the whole processor, best first (Intel, then AMD). */
const CPU_TEMPERATURES = ['CPU Package', 'Core (Tctl/Tdie)', 'Core (Tdie)', 'Core (Tctl)', 'Core Max'];

/** The part a sensor belongs to: its id without type and number. */
function part(id: string): string {
  return id.split('/').slice(0, -2).join('/');
}

function value(sensors: Sensor[], of: string, type: string, names: string[]): number | null {
  for (const name of names) {
    const found = sensors.find((s) => part(s.id) === of && s.type === type && s.name === name && s.value !== null);
    if (found) return found.value;
  }
  return null;
}

function firstPart(sensors: Sensor[], pattern: RegExp): string | null {
  return sensors.map((s) => part(s.id)).find((p) => pattern.test(p)) ?? null;
}

/** The first processor, the graphics card (a separate one before the one built in), the memory. */
export function pickValues(sensors: Sensor[]): HardwareValues {
  const cpu = firstPart(sensors, /^\/(intel|amd)cpu\/\d+$/);
  const gpu = firstPart(sensors, /^\/gpu-(nvidia|amd)\//) ?? firstPart(sensors, /^\/gpu-intel/);
  const gauge = (of: string | null, temperatures: string[]): Gauge | null =>
    of === null
      ? null
      : {
          load: value(sensors, of, 'Load', of === cpu ? ['CPU Total'] : ['GPU Core']),
          temperature: value(sensors, of, 'Temperature', temperatures),
        };
  let memory: MemoryGauge | null = null;
  if (sensors.some((s) => part(s.id) === '/ram')) {
    const used = value(sensors, '/ram', 'Data', ['Memory Used']);
    const available = value(sensors, '/ram', 'Data', ['Memory Available']);
    memory = {
      load: value(sensors, '/ram', 'Load', ['Memory']),
      used,
      total: used !== null && available !== null ? Math.round((used + available) * 10) / 10 : null,
    };
  }
  return { cpu: gauge(cpu, CPU_TEMPERATURES), gpu: gauge(gpu, ['GPU Core']), memory };
}

// ---------- asking ----------

class HardwareFailure extends Error {
  readonly problem: HardwareProblem;
  constructor(problem: HardwareProblem) {
    super(problem);
    this.problem = problem;
  }
}

export interface HardwareWatcherOptions {
  /** LibreHardwareMonitor's settings file, for its user name and password. */
  settingsFile: string;
  intervalMs: number;
  /** For tests; the global fetch otherwise. */
  fetch?: typeof fetch;
  now?: () => number;
  onChange?: () => void;
  log?: (line: string) => void;
}

export class HardwareWatcher {
  values: HardwareValues | null = null;
  updatedAt: number | null = null;
  problem: HardwareProblem | null = null;
  private readonly options: HardwareWatcherOptions;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;
  /** Undefined until the settings file has been read. */
  private authorization: string | null | undefined;

  constructor(options: HardwareWatcherOptions) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  view(): HardwareView {
    return { values: this.values, updatedAt: this.updatedAt, problem: this.problem };
  }

  /** One round; a round still running is not started twice. */
  poll(): Promise<void> {
    this.polling ??= this.round().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async round(): Promise<void> {
    const before = JSON.stringify([this.values, this.problem]);
    const problemBefore = this.problem;
    try {
      if (this.authorization === undefined) this.authorization = this.readAuthorization();
      let response = await this.ask();
      if (response.status === 401) {
        await response.body?.cancel();
        this.authorization = this.readAuthorization();
        response = await this.ask();
      }
      if (response.status === 401) throw new HardwareFailure('rejected');
      if (!response.ok) throw new HardwareFailure('unexpected');
      const body = await response.arrayBuffer();
      if (body.byteLength > MAX_ANSWER_BYTES) throw new HardwareFailure('unexpected');
      let data: unknown;
      try {
        data = JSON.parse(Buffer.from(body).toString('utf8'));
      } catch {
        throw new HardwareFailure('unexpected');
      }
      const sensors = readSensors(data);
      if (!sensors) throw new HardwareFailure('unexpected');
      this.values = pickValues(sensors);
      this.updatedAt = this.now();
      this.problem = null;
      if (problemBefore !== null) this.options.log?.('Hardware: LibreHardwareMonitor answers again.');
    } catch (err) {
      this.values = null;
      this.problem = err instanceof HardwareFailure ? err.problem : 'not-running';
      // Once per new problem, not every round.
      if (this.problem !== problemBefore) this.options.log?.(`Hardware: ${describeHardwareProblem(this.problem)}`);
    }
    if (JSON.stringify([this.values, this.problem]) !== before) this.options.onChange?.();
  }

  private ask(): Promise<Response> {
    return this.fetch(LHM_URL, {
      headers: this.authorization ? { Authorization: this.authorization } : {},
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => {
      throw new HardwareFailure('not-running');
    });
  }

  private readAuthorization(): string | null {
    try {
      return lhmAuthorization(parseAppSettings(fs.readFileSync(this.options.settingsFile, 'utf8')));
    } catch {
      return null;
    }
  }
}

export function describeHardwareProblem(problem: HardwareProblem): string {
  switch (problem) {
    case 'not-running':
      return `LibreHardwareMonitor does not answer on 127.0.0.1:${LHM_PORT}. Is it running?`;
    case 'rejected':
      return 'LibreHardwareMonitor turned the password down (401). Run "stellwerk hardware install" again.';
    case 'unexpected':
      return 'unexpected answer from LibreHardwareMonitor.';
  }
}
