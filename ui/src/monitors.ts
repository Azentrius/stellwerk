// The column of Uptime Kuma's monitors. What fails stands out: a monitor that is down in large letters
// with a filled label, one that Uptime Kuma is trying again quieter below. Everything that works is a
// number only ("35 up"), as is maintenance; at the foot, when Uptime Kuma was last asked.
//
// SPDX-License-Identifier: Apache-2.0

import type { FailingMonitor, UptimeKumaView } from '../../src/shared/protocol.js';
import { el, label } from './dom.ts';
import type { Texts } from './i18n.ts';
import { failingFor, monitorState, state } from './states.ts';

export interface MonitorNodes {
  down: HTMLElement;
  pending: HTMLElement;
  ok: HTMLElement;
}

/** Draws the monitors; returns how many fail. */
export function renderMonitors(nodes: MonitorNodes, kuma: UptimeKumaView | null, now: number, texts: Texts): number {
  const monitors = kuma?.monitors ?? null;
  const failing = monitors?.failing ?? [];
  nodes.down.replaceChildren(...failing.filter((m) => m.status === 'down').map((m) => failingEntry(m, now, texts)));
  nodes.pending.replaceChildren(...failing.filter((m) => m.status === 'pending').map((m) => failingEntry(m, now, texts)));
  nodes.ok.replaceChildren(...(monitors ? okLine(monitors.up, monitors.maintenance, failing.length, texts) : []));
  return failing.length;
}

/**
 * The column is narrow: the name gets the whole first line, state and time share the second. Down has the
 * large name and the filled label; pending the name in the text's size and the tinted label.
 */
function failingEntry(monitor: FailingMonitor, now: number, texts: Texts): HTMLLIElement {
  const item = el('li', `entry monitor monitor--${monitor.status}`);
  const top = el('span', 'entry__line');
  top.append(el('span', 'entry__name', monitor.name));
  const bottom = el('span', 'entry__line');
  bottom.append(
    label(monitorState(monitor.status, texts), { strong: monitor.status === 'down' }),
    el('span', 'entry__time', failingFor(monitor, now, texts)),
  );
  item.append(top, bottom);
  return item;
}

/** What works, as numbers: "✓ 35 up · 1 in maintenance"; with no monitor at all, says so. */
function okLine(up: number, maintenance: number, failing: number, texts: Texts): Array<string | Node> {
  if (up + maintenance + failing === 0) return [texts.monitorsNone];
  const parts: Array<string | Node> = [];
  if (up > 0) parts.push(label(state('success', texts.monitorsUp(up))));
  if (maintenance > 0) parts.push(el('span', 'monitors__maintenance', texts.monitorsMaintenance(maintenance)));
  return parts;
}
