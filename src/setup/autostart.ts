// Starting Stellwerk with Windows: two Task Scheduler tasks for the current user, at logon.
// "Stellwerk hub" runs the hub without a console window (conhost --headless) and writes its messages to
// hub.log. "Stellwerk display" opens the display a little later in Edge's kiosk mode, full screen on the
// chosen screen, with an Edge profile of its own. This module only builds the tasks; registering them is
// in windows.ts.
//
// SPDX-License-Identifier: Apache-2.0

export const HUB_TASK = 'Stellwerk hub';
export const DISPLAY_TASK = 'Stellwerk display';
/** The display starts this long after logon, when the hub is up. */
export const DISPLAY_DELAY_S = 20;

export interface Screen {
  name: string;
  primary: boolean;
  /** Position and size in physical pixels on the virtual desktop. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The screen for the display: the one given by number (1-based, as listed), otherwise the only screen of
 * 1920×720, the format Stellwerk is made for.
 */
export function pickScreen(screens: Screen[], number?: number): Screen {
  if (number !== undefined) {
    const screen = screens[number - 1];
    if (!screen) throw new Error(`There is no screen ${number}.\n${describeScreens(screens)}`);
    return screen;
  }
  const matching = screens.filter((s) => s.width === 1920 && s.height === 720);
  if (matching.length === 1) return matching[0]!;
  throw new Error(
    `${matching.length === 0 ? 'No screen has 1920×720' : 'Several screens have 1920×720'}. ` +
      `Choose one with --screen <number>.\n${describeScreens(screens)}`,
  );
}

/** The value of --screen as a number; undefined without it. */
export function screenNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new Error('--screen takes the number of a screen.');
  return Number(value);
}

/** Where the display task puts the display: its --window-position and --window-size; null without them. */
export function displayPlacement(definition: string): { x: number; y: number; width: number; height: number } | null {
  const position = /--window-position=(-?\d+),(-?\d+)/.exec(definition);
  const size = /--window-size=(\d+),(\d+)/.exec(definition);
  if (!position || !size) return null;
  return { x: Number(position[1]), y: Number(position[2]), width: Number(size[1]), height: Number(size[2]) };
}

export interface ScreenChoice {
  /** 1-based, as listed. */
  number: number;
  /** Given with --screen, kept from the display task, or the only 1920×720 screen (no display task yet). */
  reason: 'given' | 'kept' | 'only';
}

/**
 * The screen for the display when `stellwerk update` sets up a release: the one given; otherwise the one the
 * display task uses now (exactly one screen at its place and size); without a display task, the only screen
 * of 1920×720. A display task whose screen cannot be told is not overwritten by a guess: then a screen has
 * to be given. Throws before anything is changed.
 */
export function updateScreen(screens: Screen[], given: number | undefined, displayTask: string | null): ScreenChoice {
  if (given !== undefined) {
    pickScreen(screens, given);
    return { number: given, reason: 'given' };
  }
  if (displayTask === null) return { number: screens.indexOf(pickScreen(screens)) + 1, reason: 'only' };
  const place = displayPlacement(displayTask);
  if (!place) {
    throw new Error(`The task "${DISPLAY_TASK}" names no screen. Choose one with --screen <number>.\n${describeScreens(screens)}`);
  }
  const matching = screens.flatMap((s, i) => (s.x === place.x && s.y === place.y && s.width === place.width && s.height === place.height ? [i + 1] : []));
  if (matching.length === 1) return { number: matching[0]!, reason: 'kept' };
  throw new Error(
    `The task "${DISPLAY_TASK}" shows the display at ${place.x},${place.y} in ${place.width}×${place.height}, ` +
      `${matching.length === 0 ? 'where no screen is now' : 'where several screens are'}. ` +
      `Choose one with --screen <number>.\n${describeScreens(screens)}`,
  );
}

export function describeScreens(screens: Screen[]): string {
  return screens
    .map((s, i) => `  ${i + 1}  ${s.width}×${s.height} at ${s.x},${s.y}${s.primary ? '  (main screen)' : ''}`)
    .join('\n');
}

export interface TaskAction {
  command: string;
  args: string[];
  workingDirectory: string;
}

export interface Task {
  name: string;
  description: string;
  action: TaskAction;
  delaySeconds: number;
  /** Start the program again if it ends with an error (the hub, not the display). */
  restartOnFailure: boolean;
  /** Run with the user's administrator rights (only the hardware monitor, which reads the sensors). */
  elevated?: boolean;
  /** Started at logon (default); without, only when something runs the task (the hub runs the hardware monitor's). */
  atLogon?: boolean;
}

export function hubTask(paths: { node: string; cli: string; root: string; logFile: string; conhost: string }): Task {
  return {
    name: HUB_TASK,
    description: 'Starts the Stellwerk hub on 127.0.0.1 at logon, without a window. Its messages go to hub.log.',
    action: {
      command: paths.conhost,
      // Ending the task ends only the console host; --exit-with-parent makes the hub follow it.
      args: ['--headless', paths.node, paths.cli, 'serve', '--log-file', paths.logFile, '--exit-with-parent'],
      workingDirectory: paths.root,
    },
    delaySeconds: 0,
    restartOnFailure: true,
  };
}

export function displayTask(options: { edge: string; url: string; profileDir: string; screen: Screen; root: string }): Task {
  const { screen } = options;
  return {
    name: DISPLAY_TASK,
    description: 'Opens the Stellwerk display at logon, full screen on the screen chosen at setup.',
    action: {
      command: options.edge,
      // Kiosk mode: full screen without title bar and over the taskbar (an --app window ignores
      // --start-fullscreen). Alt+F4 closes it.
      args: [
        '--kiosk',
        options.url,
        '--edge-kiosk-type=fullscreen',
        `--user-data-dir=${options.profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        `--window-position=${screen.x},${screen.y}`,
        `--window-size=${screen.width},${screen.height}`,
      ],
      workingDirectory: options.root,
    },
    delaySeconds: DISPLAY_DELAY_S,
    restartOnFailure: false,
  };
}

/** One command line from arguments, quoted the way Windows programs split them again. */
export function commandLine(args: string[]): string {
  return args.map(quoteArgument).join(' ');
}

function quoteArgument(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  // Backslashes before a quote are doubled, the quote is escaped (CommandLineToArgvW rules).
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/** The task as Task Scheduler XML, for the given user (DOMAIN\name). */
export function taskXml(task: Task, user: string): string {
  const x = escapeXml;
  const delay = task.delaySeconds > 0 ? `\n      <Delay>PT${task.delaySeconds}S</Delay>` : '';
  // A task without a logon trigger starts only when something runs it.
  const triggers =
    task.atLogon === false
      ? ''
      : `  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${x(user)}</UserId>${delay}
    </LogonTrigger>
  </Triggers>
`;
  const restart = task.restartOnFailure
    ? '\n    <RestartOnFailure>\n      <Interval>PT1M</Interval>\n      <Count>3</Count>\n    </RestartOnFailure>'
    : '';
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Stellwerk</Author>
    <Description>${x(task.description)}</Description>
  </RegistrationInfo>
${triggers}  <Principals>
    <Principal id="Author">
      <UserId>${x(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>${task.elevated ? 'HighestAvailable' : 'LeastPrivilege'}</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>${restart}
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${x(task.action.command)}</Command>${task.action.args.length > 0 ? `\n      <Arguments>${x(commandLine(task.action.args))}</Arguments>` : ''}
      <WorkingDirectory>${x(task.action.workingDirectory)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}
