// The start with Windows: which screen the display goes on, the command lines and the Task Scheduler XML.
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DISPLAY_DELAY_S,
  DISPLAY_TASK,
  HUB_TASK,
  commandLine,
  displayPlacement,
  displayTask,
  hubTask,
  pickScreen,
  screenNumber,
  taskXml,
  updateScreen,
  type Screen,
} from '../src/setup/autostart.ts';

const SCREENS: Screen[] = [
  { name: '\\\\.\\DISPLAY1', primary: false, x: -1920, y: 359, width: 1920, height: 1080 },
  { name: '\\\\.\\DISPLAY5', primary: true, x: 0, y: 0, width: 3440, height: 1440 },
  { name: '\\\\.\\DISPLAY6', primary: false, x: 0, y: 1440, width: 1920, height: 720 },
];

const HUB = hubTask({
  node: 'C:\\Program Files\\nodejs\\node.exe',
  cli: 'C:\\Users\\dev\\Projects\\stellwerk\\dist\\cli.js',
  root: 'C:\\Users\\dev\\Projects\\stellwerk',
  logFile: 'C:\\Users\\dev\\AppData\\Local\\stellwerk\\hub.log',
  conhost: 'C:\\Windows\\System32\\conhost.exe',
});
const DISPLAY_OPTIONS = {
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  // The start file that signs the display in, not the hub's address.
  url: 'file:///C:/Users/dev/AppData/Local/stellwerk/display.html',
  profileDir: 'C:\\Users\\dev\\AppData\\Local\\stellwerk\\edge-display',
  screen: SCREENS[2]!,
  root: 'C:\\Users\\dev\\Projects\\stellwerk',
};
const DISPLAY = displayTask(DISPLAY_OPTIONS);

describe('the screen for the display', () => {
  test('is the only 1920×720 screen, or the one given by number', () => {
    assert.equal(pickScreen(SCREENS).name, '\\\\.\\DISPLAY6');
    assert.equal(pickScreen(SCREENS, 2).name, '\\\\.\\DISPLAY5');
  });

  test('must be chosen when no screen or several have 1920×720, with the list in the message', () => {
    assert.throws(() => pickScreen(SCREENS.slice(0, 2)), /No screen has 1920×720.*--screen[\s\S]*1 {2}1920×1080 at -1920,359/);
    assert.throws(() => pickScreen([...SCREENS, { ...SCREENS[2]!, x: 1920 }]), /Several screens/);
    assert.throws(() => pickScreen(SCREENS, 4), /There is no screen 4/);
  });

  test('--screen takes a number from 1', () => {
    assert.equal(screenNumber(undefined), undefined);
    assert.equal(screenNumber('3'), 3);
    for (const value of ['0', '-1', 'two', '1.5', '', '03x']) assert.throws(() => screenNumber(value), /--screen takes the number of a screen/);
  });

  test('the display task tells its place and size; edited without them it tells nothing', () => {
    const xml = taskXml(DISPLAY, 'PC\\dev');
    assert.deepEqual(displayPlacement(xml), { x: 0, y: 1440, width: 1920, height: 720 });
    assert.deepEqual(displayPlacement('--window-position=-1920,359 --window-size=1920,1080'), { x: -1920, y: 359, width: 1920, height: 1080 });
    assert.equal(displayPlacement(xml.replace(/ --window-size=[\d,]+/, '')), null);
  });
});

describe('the screen after an update', () => {
  /** The display task as an earlier setup registered it for that screen. */
  const task = (screen: Screen) => taskXml(displayTask({ ...DISPLAY_OPTIONS, screen }), 'PC\\dev');

  test('is the one given, even when the task uses another', () => {
    assert.deepEqual(updateScreen(SCREENS, 1, task(SCREENS[2]!)), { number: 1, reason: 'given' });
    assert.throws(() => updateScreen(SCREENS, 4, task(SCREENS[2]!)), /There is no screen 4/);
  });

  test('otherwise the one the display task uses now, also when it is not 1920×720', () => {
    assert.deepEqual(updateScreen(SCREENS, undefined, task(SCREENS[0]!)), { number: 1, reason: 'kept' });
    assert.deepEqual(updateScreen(SCREENS, undefined, task(SCREENS[2]!)), { number: 3, reason: 'kept' });
    // Its screen moved to another place in the list.
    assert.deepEqual(updateScreen([SCREENS[2]!, SCREENS[1]!], undefined, task(SCREENS[2]!)), { number: 1, reason: 'kept' });
  });

  test('without a display task, the only 1920×720 screen', () => {
    assert.deepEqual(updateScreen(SCREENS, undefined, null), { number: 3, reason: 'only' });
    assert.throws(() => updateScreen(SCREENS.slice(0, 2), undefined, null), /No screen has 1920×720/);
  });

  test('never a guess when the task cannot tell its screen', () => {
    assert.throws(() => updateScreen(SCREENS.slice(0, 2), undefined, task(SCREENS[2]!)), /at 0,1440 in 1920×720, where no screen is now\. Choose one with --screen/);
    const twice = [...SCREENS, { ...SCREENS[2]!, name: '\\\\.\\DISPLAY7' }];
    assert.throws(() => updateScreen(twice, undefined, task(SCREENS[2]!)), /where several screens are/);
    assert.throws(() => updateScreen(SCREENS, undefined, '<Task/>'), /names no screen/);
  });
});

describe('command lines', () => {
  test('quote arguments with spaces and quotes as Windows programs split them', () => {
    assert.equal(commandLine(['plain', 'with space', '']), 'plain "with space" ""');
    assert.equal(commandLine(['say "hi"']), '"say \\"hi\\""');
    assert.equal(commandLine(['C:\\dir with space\\']), '"C:\\dir with space\\\\"');
    assert.equal(commandLine(['C:\\no\\space\\']), 'C:\\no\\space\\');
  });
});

describe('the tasks', () => {
  test('the hub runs without a window and writes its messages to hub.log', () => {
    assert.equal(HUB.name, HUB_TASK);
    assert.equal(HUB.action.command, 'C:\\Windows\\System32\\conhost.exe');
    assert.deepEqual(HUB.action.args, [
      '--headless',
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Users\\dev\\Projects\\stellwerk\\dist\\cli.js',
      'serve',
      '--log-file',
      'C:\\Users\\dev\\AppData\\Local\\stellwerk\\hub.log',
      '--exit-with-parent',
    ]);
    assert.equal(HUB.delaySeconds, 0);
    assert.equal(HUB.restartOnFailure, true);
  });

  test('the display opens later in kiosk mode, full screen on the chosen screen, with its own profile', () => {
    assert.equal(DISPLAY.name, DISPLAY_TASK);
    assert.deepEqual(DISPLAY.action.args, [
      '--kiosk',
      'file:///C:/Users/dev/AppData/Local/stellwerk/display.html',
      '--edge-kiosk-type=fullscreen',
      '--user-data-dir=C:\\Users\\dev\\AppData\\Local\\stellwerk\\edge-display',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=0,1440',
      '--window-size=1920,720',
    ]);
    assert.equal(DISPLAY.delaySeconds, DISPLAY_DELAY_S);
    assert.equal(DISPLAY.restartOnFailure, false);
  });
});

describe('the Task Scheduler XML', () => {
  const hubXml = taskXml(HUB, 'LAPTOP\\dev');
  const displayXml = taskXml(DISPLAY, 'LAPTOP\\dev');

  test('starts at the logon of this user, as this user, without elevation', () => {
    assert.match(hubXml, /<LogonTrigger>\s*<Enabled>true<\/Enabled>\s*<UserId>LAPTOP\\dev<\/UserId>\s*<\/LogonTrigger>/);
    assert.match(hubXml, /<LogonType>InteractiveToken<\/LogonType>/);
    assert.match(hubXml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
    assert.match(displayXml, new RegExp(`<Delay>PT${DISPLAY_DELAY_S}S</Delay>`));
    assert.doesNotMatch(hubXml, /<Delay>/);
  });

  test('keeps the hub running: on battery, without a time limit, restarted after a failure', () => {
    assert.match(hubXml, /<DisallowStartIfOnBatteries>false</);
    assert.match(hubXml, /<StopIfGoingOnBatteries>false</);
    assert.match(hubXml, /<ExecutionTimeLimit>PT0S</);
    assert.match(hubXml, /<MultipleInstancesPolicy>IgnoreNew</);
    assert.match(hubXml, /<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>3<\/Count>/);
    assert.doesNotMatch(displayXml, /<RestartOnFailure>/);
  });

  test('carries the command line, with every value escaped for XML', () => {
    assert.match(
      hubXml,
      /<Arguments>--headless &quot;C:\\Program Files\\nodejs\\node.exe&quot; C:\\Users\\dev\\Projects\\stellwerk\\dist\\cli.js serve --log-file C:\\Users\\dev\\AppData\\Local\\stellwerk\\hub.log --exit-with-parent<\/Arguments>/,
    );
    const odd = taskXml({ ...HUB, description: 'a < b & "c"' }, 'DOM&AIN\\<user>');
    assert.match(odd, /<Description>a &lt; b &amp; &quot;c&quot;<\/Description>/);
    assert.match(odd, /<UserId>DOM&amp;AIN\\&lt;user&gt;<\/UserId>/);
    assert.equal((odd.match(/<UserId>/g) ?? []).length, 2);
  });
});
