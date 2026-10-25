// A line that opens its list with a tap and closes again by itself a while after the last touch: the
// sessions at rest in the agents column, the last decisions in the waiting column. Without the DOM, so the
// tests can use it.
//
// SPDX-License-Identifier: Apache-2.0

/** An opened line closes again this long after the last touch. */
export const OPEN_FOR_MS = 60_000;

/** Whether the line is open: since a tap on it, until OPEN_FOR_MS after the last touch. */
export class TimedFold {
  private openUntil: number | null = null;

  isOpen(now: number): boolean {
    if (this.openUntil !== null && now >= this.openUntil) this.openUntil = null;
    return this.openUntil !== null;
  }

  /** A tap on the line: opens it, or closes it when it is open. */
  toggle(now: number): void {
    this.openUntil = this.isOpen(now) ? null : now + OPEN_FOR_MS;
  }

  /** A touch on what it opened keeps an open line open. */
  touched(now: number): void {
    if (this.isOpen(now)) this.openUntil = now + OPEN_FOR_MS;
  }

  /** Closed at once, whatever the time. */
  close(): void {
    this.openUntil = null;
  }
}
