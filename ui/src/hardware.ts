// The gauges in the status column, one row each with a bar and its percent. Processor, graphics card and
// memory: the load, then the temperature (memory: used of all); a hot part's temperature needs attention.
// Below them the plans' limits, under a title per provider: the window, how much is used, then when the
// window starts again; a limit nearly used up needs attention.
//
// SPDX-License-Identifier: Apache-2.0

import type { Gauge, HardwareView, MemoryGauge, PlanView } from '../../src/shared/protocol.js';
import { el, label } from './dom.ts';
import type { Texts } from './i18n.ts';
import { PLAN_FULL, currentLimits, resetText } from './plans.ts';
import { state } from './states.ts';

/** From this temperature on a value is shown as attention, with the warning triangle. */
export const HOT_CELSIUS = 90;

export function renderHardware(list: HTMLElement, hardware: HardwareView | null, texts: Texts): void {
  const values = hardware?.values ?? null;
  const rows: HTMLElement[] = [];
  const temperature = (gauge: Gauge) => {
    const text = gauge.temperature === null ? '' : `${texts.number(gauge.temperature, 0)} °C`;
    return isHot(gauge) ? label(state('warning', text)) : text;
  };
  if (values?.cpu) rows.push(gaugeRow(texts.parts.cpu, values.cpu.load, percent(values.cpu.load, texts), temperature(values.cpu)));
  if (values?.gpu) rows.push(gaugeRow(texts.parts.gpu, values.gpu.load, percent(values.gpu.load, texts), temperature(values.gpu)));
  if (values?.memory) rows.push(gaugeRow(texts.parts.memory, values.memory.load, percent(values.memory.load, texts), memoryText(values.memory, texts)));
  list.replaceChildren(...rows);
}

export function renderPlans(container: HTMLElement, plans: readonly PlanView[], now: number, texts: Texts): void {
  container.replaceChildren(
    ...plans.map((plan) => {
      const section = el('section', 'gauge-section');
      const list = el('dl', 'gauges');
      for (const limit of currentLimits(plan, now)) {
        const used = percent(limit.used, texts);
        const shown = limit.used >= PLAN_FULL ? label(state('warning', used)) : used;
        list.append(gaugeRow(texts.planWindow(limit.windowMinutes), limit.used, shown, resetText(limit.resetsAt, now, texts)));
      }
      section.append(el('h2', 'section-title', texts.planTitle(texts.providers[plan.provider])), list);
      return section;
    }),
  );
}

export function isHot(gauge: Gauge): boolean {
  return gauge.temperature !== null && gauge.temperature >= HOT_CELSIUS;
}

function percent(load: number | null, texts: Texts): string {
  return load === null ? '' : `${texts.number(load, 0)} %`;
}

function memoryText(memory: MemoryGauge, texts: Texts): string {
  if (memory.used === null) return '';
  return memory.total === null
    ? `${texts.number(memory.used, 1)} GB`
    : `${texts.number(memory.used, 0)} / ${texts.number(memory.total, 0)} GB`;
}

function gaugeRow(name: string, load: number | null, percentText: string | Node, extra: string | Node): HTMLElement {
  const item = el('div', 'gauge');
  const bar = el('span', 'gauge__bar');
  const fill = el('span', 'gauge__fill');
  fill.style.transform = `scaleX(${Math.min(100, Math.max(0, load ?? 0)) / 100})`;
  bar.append(fill);
  const loadCell = el('dd', 'gauge__load');
  const percentCell = el('span', 'gauge__percent');
  percentCell.append(percentText);
  loadCell.append(bar, percentCell);
  const extraCell = el('dd', 'gauge__extra');
  extraCell.append(extra);
  item.append(el('dt', 'gauge__label', name), loadCell, extraCell);
  return item;
}
