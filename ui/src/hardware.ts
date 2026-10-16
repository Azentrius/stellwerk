// Processor, graphics card and memory in the status column, one row each: the load as a bar and in
// percent, then the temperature (memory: used of all). A hot part's temperature needs attention.
//
// SPDX-License-Identifier: Apache-2.0

import type { Gauge, HardwareView, MemoryGauge } from '../../src/shared/protocol.js';
import { el, label } from './dom.ts';
import type { Texts } from './i18n.ts';
import { state } from './states.ts';

/** From this temperature on a value is shown as attention, with the warning triangle. */
export const HOT_CELSIUS = 90;

export function renderHardware(list: HTMLElement, hardware: HardwareView | null, texts: Texts): void {
  const values = hardware?.values ?? null;
  const rows: HTMLElement[] = [];
  const temperature = (gauge: Gauge) => (gauge.temperature === null ? '' : `${texts.number(gauge.temperature, 0)} °C`);
  if (values?.cpu) rows.push(row(texts.parts.cpu, values.cpu.load, temperature(values.cpu), isHot(values.cpu), texts));
  if (values?.gpu) rows.push(row(texts.parts.gpu, values.gpu.load, temperature(values.gpu), isHot(values.gpu), texts));
  if (values?.memory) rows.push(row(texts.parts.memory, values.memory.load, memoryText(values.memory, texts), false, texts));
  list.replaceChildren(...rows);
}

/** The line below the rows: asking, or why there are no values. Null when the values are there. */
export function hardwareLine(hardware: HardwareView | null, texts: Texts): { text: string; problem: boolean } | null {
  if (!hardware || hardware.values) return null;
  if (hardware.problem) return { text: texts.hardware.problem[hardware.problem], problem: true };
  return { text: texts.hardware.asking, problem: false };
}

export function isHot(gauge: Gauge): boolean {
  return gauge.temperature !== null && gauge.temperature >= HOT_CELSIUS;
}

function memoryText(memory: MemoryGauge, texts: Texts): string {
  if (memory.used === null) return '';
  return memory.total === null
    ? `${texts.number(memory.used, 1)} GB`
    : `${texts.number(memory.used, 0)} / ${texts.number(memory.total, 0)} GB`;
}

function row(name: string, load: number | null, extra: string, hot: boolean, texts: Texts): HTMLElement {
  const item = el('div', 'gauge');
  const bar = el('span', 'gauge__bar');
  const fill = el('span', 'gauge__fill');
  fill.style.transform = `scaleX(${Math.min(100, Math.max(0, load ?? 0)) / 100})`;
  bar.append(fill);
  const loadCell = el('dd', 'gauge__load');
  loadCell.append(bar, el('span', 'gauge__percent', load === null ? '' : `${texts.number(load, 0)} %`));
  const extraCell = el('dd', 'gauge__extra');
  if (hot) extraCell.append(label(state('warning', extra)));
  else extraCell.textContent = extra;
  item.append(el('dt', 'gauge__label', name), loadCell, extraCell);
  return item;
}
