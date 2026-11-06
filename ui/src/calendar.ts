// The calendar page: on the left the event running now and the next one, then today and the next six days
// with their events; on the right the open tasks, the GitHub issues assigned to me first (a tap opens one in
// the browser), then each task list. A calendar whose last question failed says so at the foot of its
// column; its events of before stay. Titles go in as text only.
//
// SPDX-License-Identifier: Apache-2.0

import type { CalendarView, EventView, GitHubProblem, IssueView, TaskView } from '../../src/shared/protocol.js';
import { agendaDays, dayFromToday, dueOf, midnightOf, nowAndNext } from './agenda.ts';
import { alert, el, icon } from './dom.ts';
import type { Texts } from './i18n.ts';
import type { TapEntry, TapList } from './taps.ts';
import { ago, clock } from './time.ts';

export interface CalendarParts {
  nowNext: HTMLElement;
  agenda: HTMLElement;
  agendaEmpty: HTMLElement;
  calendarState: HTMLElement;
  tasksCount: HTMLElement;
  issuesSection: HTMLElement;
  issues: HTMLUListElement;
  lists: HTMLElement;
  tasksEmpty: HTMLElement;
  tasksState: HTMLElement;
}

/** The key of an issue in its list, which a tap hands back. */
export const issueKey = (issue: Pick<IssueView, 'repo' | 'number'>) => `${issue.repo}#${issue.number}`;

export function renderCalendar(
  parts: CalendarParts,
  calendar: CalendarView | null,
  issues: IssueView[] | null,
  issuesProblem: GitHubProblem | null,
  issueTaps: TapList,
  now: number,
  texts: Texts,
): void {
  const events = calendar?.events ?? [];
  // Drawn anew only when what it shows changes, at most once a minute: the lists keep their place.
  redraw(parts.nowNext, [events, Math.floor(now / 60_000)], () => nowNextNodes(events, now, texts));
  parts.nowNext.hidden = parts.nowNext.childElementCount === 0;
  const days = agendaDays(events, now);
  redraw(parts.agenda, [days, Math.floor(now / 60_000)], () => days.map((day) => dayNode(day.day, day.events, now, texts)));
  parts.agendaEmpty.hidden = calendar === null || days.length > 0;

  const problem = calendar?.problems[0];
  parts.calendarState.hidden = problem === undefined;
  redraw(parts.calendarState, [problem], () =>
    problem ? [alert({ tone: 'warning', title: `${problem.source}: ${texts.calendar.problem[problem.problem]}`, fix: texts.calendar.fix[problem.problem] })] : [],
  );

  const open = issues ?? [];
  parts.issuesSection.hidden = issues === null || open.length === 0;
  issueTaps.render(parts.issues, open.map((issue) => issueEntry(issue, now, texts)));
  const tasks = calendar?.tasks ?? [];
  const bySource = new Map<string, TaskView[]>();
  for (const task of tasks) bySource.set(task.source, [...(bySource.get(task.source) ?? []), task]);
  redraw(parts.lists, [tasks, Math.floor(now / 60_000)], () => [...bySource].map(([source, list]) => taskList(source, list, now, texts)));
  const count = open.length + tasks.length;
  parts.tasksCount.textContent = count > 0 ? `(${count})` : '';
  parts.tasksEmpty.hidden = count > 0;
  parts.tasksState.hidden = issuesProblem === null;
  redraw(parts.tasksState, [issuesProblem], () => (issuesProblem ? [alert({ tone: 'warning', title: texts.issues.problem, fix: texts.issues.fix })] : []));
}

/** Puts new content into a node, only when what it stands for changed. */
function redraw(node: HTMLElement, what: unknown, content: () => Node[]): void {
  const key = JSON.stringify(what);
  if (node.dataset.shown === key) return;
  node.dataset.shown = key;
  node.replaceChildren(...content());
}

/** "Now" with the events running, "Next" with the next one and when it starts. */
function nowNextNodes(events: EventView[], now: number, texts: Texts): Node[] {
  const { current, next } = nowAndNext(events, now);
  const nodes: Node[] = [];
  if (current.length > 0) {
    const block = el('section', 'now-next__block now-next__block--now');
    block.append(el('h3', 'section-title', texts.nowTitle));
    for (const event of current) {
      block.append(el('p', 'now-next__title', event.title), el('p', 'now-next__when', `${texts.until(clock(event.end))} · ${event.source}`));
    }
    nodes.push(block);
  }
  if (next) {
    const block = el('section', 'now-next__block');
    const minutes = Math.ceil((next.start - now) / 60_000);
    const day = dayFromToday(next.start, now);
    const when =
      day === 0 ? (minutes <= 60 ? `${texts.inMinutes(minutes)} · ${clock(next.start)}` : clock(next.start)) : `${day === 1 ? texts.tomorrow : texts.day(next.start)} ${clock(next.start)}`;
    block.append(el('h3', 'section-title', texts.nextTitle), el('p', 'now-next__title', next.title), el('p', 'now-next__when', `${when} · ${next.source}`));
    nodes.push(block);
  }
  return nodes;
}

/** A day: its name, then its events with their times. */
function dayNode(day: number, events: EventView[], now: number, texts: Texts): HTMLLIElement {
  const node = el('li', 'agenda__day');
  const which = dayFromToday(day, now);
  const name = which === 0 ? `${texts.today} · ${texts.day(day)}` : which === 1 ? `${texts.tomorrow} · ${texts.day(day)}` : texts.day(day);
  const list = el('ul', 'entries');
  const nextDay = midnightOf(day + 36 * 3_600_000);
  for (const event of events) {
    const item = el('li', 'event');
    if (event.end <= now && event.end !== event.start) item.classList.add('event--past');
    if (!event.allDay && event.start <= now && now < event.end) item.classList.add('event--now');
    item.append(el('span', 'event__time', timeOf(event, day, nextDay, texts)), el('span', 'event__title', event.title), el('span', 'event__source', event.source));
    list.append(item);
  }
  node.append(el('h3', 'section-title agenda__name', name), list);
  return node;
}

/** An event's time on one of its days: "09:00–10:00"; one that runs on from the day before or into the next lacks that end. */
function timeOf(event: EventView, day: number, nextDay: number, texts: Texts): string {
  if (event.allDay) return texts.allDay;
  if (event.start === event.end) return clock(event.start);
  const from = event.start >= day ? clock(event.start) : '';
  const to = event.end <= nextDay ? clock(event.end) : '';
  return from === '' && to === '' ? texts.allDay : `${from}–${to}`;
}

function issueEntry(issue: IssueView, now: number, texts: Texts): TapEntry {
  const fresh = el('li', 'entry entry--short issue');
  const top = el('span', 'entry__line');
  top.append(el('span', 'entry__name', issue.title), el('span', 'entry__time', ago(now - issue.updatedAt, texts)));
  const bottom = el('span', 'entry__line');
  bottom.append(el('span', 'entry__details', `${issue.repo} #${issue.number}`));
  fresh.append(top, bottom);
  return { key: issueKey(issue), fresh, tappable: true, hint: texts.openIssue };
}

/** A task list by its name, with its open tasks: overdue first, then by due date. */
function taskList(source: string, tasks: TaskView[], now: number, texts: Texts): HTMLElement {
  const section = el('section', 'task-list');
  const list = el('ul', 'entries');
  for (const task of tasks) {
    const due = dueOf(task, now);
    const item = el('li', `entry entry--short task${due.kind === 'overdue' ? ' task--overdue' : ''}`);
    const name = el('span', 'entry__name', task.title);
    if (task.priority !== null && task.priority <= 4) {
      const mark = el('span', 'task__mark');
      mark.setAttribute('role', 'img');
      mark.setAttribute('aria-label', texts.highPriority);
      mark.append(icon('exclamation-circle'));
      name.prepend(mark);
    }
    const time = (at: number, allDay: boolean) => (allDay ? null : clock(at));
    const label =
      due.kind === 'none'
        ? ''
        : due.kind === 'overdue'
          ? texts.due.overdue(due.days)
          : due.kind === 'today'
            ? texts.due.today(time(due.at, due.allDay))
            : due.kind === 'tomorrow'
              ? texts.due.tomorrow(time(due.at, due.allDay))
              : texts.due.on(due.allDay ? texts.day(due.at) : `${texts.day(due.at)} ${clock(due.at)}`);
    item.append(name, el('span', 'entry__time task__due', label));
    list.append(item);
  }
  section.append(el('h3', 'section-title', source), list);
  return section;
}
