// The display's scrolling lists in a real Edge, for the browser checks: what of a list is in view and can be
// read, and real input to move it (mouse wheel, finger, keys) and to tap. Measured in the page, as the
// browser lays it out; never by setting scrollTop.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pause, type Edge } from './edge.ts';

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Which list to measure, and what of it. */
export interface ListSpec {
  /** The element that scrolls. */
  list: string;
  /** Its entries, within it. */
  entries: string;
  /** Parts of an entry that must be readable; without them the entry as a whole. */
  parts?: string[];
  /** The part that holds an entry's name, for its text and whether it is cut. */
  name?: string;
  /** The list's class while its bottom fades out. */
  fade?: string;
  /** Ids of what must stay in view outside the list (a title, a line below it). */
  fixed?: Record<string, string>;
}

export interface Entry {
  /** The entry's class names. */
  classes: string;
  /** Its name's text, or all its text. */
  text: string;
  /** The name is cut: more text than its box shows. */
  clipped: boolean;
  box: Box;
  /** It lies in the list's visible area, outside the fade, and nothing covers it. */
  readable: boolean;
}

export interface Geometry {
  scrollTop: number;
  max: number;
  /** The fade at the bottom is on. */
  more: boolean;
  mask: string;
  /** Tab can stop at the list itself. */
  focusable: boolean;
  scrollbar: number;
  overflowX: number;
  /** The list's visible area, without its scroll bar; null while it is hidden. */
  view: Box | null;
  entries: Entry[];
  /** The height of what the list holds. */
  content: number;
  /** Each in the window, outside the list, uncovered. */
  fixed: Record<string, { box: Box; shown: boolean }>;
}

/** Measures a list in the page; the spec goes in as an argument, never as code. */
const MEASURE = `(spec) => {
  const list = document.querySelector(spec.list);
  const rect = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  const outer = list.getBoundingClientRect();
  const view = { top: outer.top + list.clientTop, left: outer.left + list.clientLeft };
  view.bottom = view.top + list.clientHeight;
  view.right = view.left + list.clientWidth;
  const more = spec.fade ? list.classList.contains(spec.fade) : false;
  const mask = getComputedStyle(list).maskImage;
  const fade = mask !== 'none' ? 3 * parseFloat(getComputedStyle(document.documentElement).fontSize) : 0;
  const readableBottom = Math.min(innerHeight, view.bottom - fade);
  const inside = (b) => b.top >= view.top - 0.5 && b.bottom <= readableBottom + 0.5 && b.left >= view.left - 0.5 && b.right <= view.right + 0.5;
  const uncovered = (node) => {
    const b = node.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return hit !== null && (node === hit || node.contains(hit));
  };
  const entries = [...list.querySelectorAll(spec.entries)].map((item) => {
    const name = spec.name ? item.querySelector(spec.name) : null;
    const parts = spec.parts ? spec.parts.flatMap((part) => [...item.querySelectorAll(part)]) : [item];
    return {
      classes: item.className,
      text: (name ?? item).textContent,
      clipped: name ? name.scrollWidth > name.clientWidth + 1 : false,
      box: rect(item),
      readable: parts.length > 0 && parts.every((part) => inside(rect(part)) && uncovered(part)),
    };
  });
  const fixed = {};
  for (const [key, id] of Object.entries(spec.fixed ?? {})) {
    const node = document.getElementById(id);
    const box = rect(node);
    fixed[key] = { box, shown: !list.contains(node) && box.bottom > box.top && box.top >= 0 && box.bottom <= innerHeight && uncovered(node) };
  }
  const content = [...list.children].filter((child) => !child.hidden).reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
  return {
    scrollTop: list.scrollTop, max: list.scrollHeight - list.clientHeight, more, mask,
    focusable: list.tabIndex >= 0, scrollbar: list.offsetWidth - list.clientWidth - list.clientLeft * 2,
    overflowX: list.scrollWidth - list.clientWidth, view: list.offsetParent === null ? null : view, entries, content, fixed,
  };
}`;

export function measure(edge: Edge, spec: ListSpec): Promise<Geometry> {
  return edge.call<Geometry>(MEASURE, spec);
}

/** Waits until the list stands still (a wheel or a fling may still glide), then measures. */
export async function settled(edge: Edge, spec: ListSpec): Promise<Geometry> {
  let last = await measure(edge, spec);
  for (let i = 0; i < 40; i++) {
    await pause(120);
    const now = await measure(edge, spec);
    if (now.scrollTop === last.scrollTop) return now;
    last = now;
  }
  return last;
}

export type Gesture = (center: { x: number; y: number }) => Promise<void>;

/**
 * Moves the list with real input, one gesture at a time over its middle, until it stands at the end (or
 * the start) or stops moving. Returns where it stands and which entries could be read on the way.
 */
export async function scrollWith(edge: Edge, spec: ListSpec, gesture: Gesture, toward: 'end' | 'start') {
  let g = await settled(edge, spec);
  const read = new Set<number>();
  const note = (at: Geometry) => at.entries.forEach((e, i) => e.readable && read.add(i));
  note(g);
  let stalls = 0;
  for (let i = 0; i < 80 && stalls < 3; i++) {
    if (toward === 'end' ? g.scrollTop >= g.max - 1 : g.scrollTop <= 0) break;
    const before = g.scrollTop;
    const view = g.view!;
    await gesture({ x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 });
    g = await settled(edge, spec);
    note(g);
    stalls = g.scrollTop === before ? stalls + 1 : 0;
  }
  return { g, read };
}

export const wheel =
  (edge: Edge, delta: number): Gesture =>
  async ({ x, y }) => {
    await edge.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: delta });
  };

/** A finger drawn up by `distance` pixels (down when negative): the list follows it. */
export const swipe =
  (edge: Edge, distance: number): Gesture =>
  async ({ x, y }) => {
    const from = y + distance / 2;
    await edge.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
    for (let step = 1; step <= 10; step++) {
      await edge.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from - (distance * step) / 10 }] });
      await pause(16);
    }
    await edge.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

/** A finger tapping one point. */
export async function tap(edge: Edge, x: number, y: number): Promise<void> {
  await edge.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await pause(50);
  await edge.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** A key pressed and let go; a key that types (Enter: "\r") sends its text, which is what presses a button. */
export async function press(edge: Edge, key: string, code: number, text?: string): Promise<void> {
  const event = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, ...(text ? { text, unmodifiedText: text } : {}) };
  await edge.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...event });
  await edge.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

/** Counts the changes to a list from now on, so a check knows the display drew it again. */
export async function countRenders(edge: Edge, selector: string): Promise<() => Promise<number>> {
  await edge.call(
    `(selector) => {
      window.__renders = 0;
      new MutationObserver(() => window.__renders++).observe(document.querySelector(selector), { childList: true, subtree: true, characterData: true });
    }`,
    selector,
  );
  return () => edge.evaluate<number>('window.__renders');
}

/** The display's screen, a touch screen, with the page in focus as in the kiosk; signed in with the start file. */
export async function openDisplay(edge: Edge, startFile: string): Promise<void> {
  await edge.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 720, deviceScaleFactor: 1, mobile: false });
  await edge.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await edge.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await edge.send('Page.navigate', { url: pathToFileURL(startFile).href });
}

/** A screenshot into `folder`, when one was given. */
export async function screenshot(edge: Edge, folder: string | null, name: string): Promise<void> {
  if (!folder) return;
  const { data } = (await edge.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${name}.png`), Buffer.from(data, 'base64'));
}
