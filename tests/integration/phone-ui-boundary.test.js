import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { EXIT_MESSAGE } from '../../src/engine/menus.js';
import { next } from '../../src/engine/ussd.js';
import { createMockAIProvider } from '../../src/ui/mock-ai.js';
import { mountPhoneUI } from '../../src/ui/phone-ui.js';

const entryPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const apiPath = fileURLToPath(new URL('../../api/ask.js', import.meta.url));
const entryHtml = readFileSync(entryPath, 'utf8');

const controllers = [];
const browsers = [];

function createBrowser() {
  const browser = new JSDOM(entryHtml, {
    url: 'http://ghostdial.test/',
  });
  browsers.push(browser);
  return browser;
}

function createAudioRecorder() {
  return {
    keyBeep: vi.fn(),
    startConnecting: vi.fn(),
    stopConnecting: vi.fn(),
    setMuted: vi.fn(),
    isMuted: vi.fn(() => false),
    destroy: vi.fn(),
  };
}

function mountBoundary({
  transition = vi.fn(() => con({ view: { kind: 'main' } }, 'Main menu')),
  aiProvider = vi.fn(),
  audio = createAudioRecorder(),
} = {}) {
  const browser = createBrowser();
  const root = browser.window.document.querySelector('#app');
  const controller = mountPhoneUI(root, {
    transition,
    aiProvider,
    audio,
    clock: { now: () => Date.now() },
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });

  controllers.push(controller);
  return {
    aiProvider,
    audio,
    browser,
    controller,
    document: browser.window.document,
    transition,
  };
}

function con(state, text) {
  return { state, screen: { type: 'CON', text } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function dispatchKey(browser, key, modifiers = {}) {
  const event = new browser.window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: Boolean(modifiers.ctrlKey),
    altKey: Boolean(modifiers.altKey),
    metaKey: Boolean(modifiers.metaKey),
  });
  browser.window.document.dispatchEvent(event);
  return event;
}

function typeText(browser, text) {
  for (const character of Array.from(text)) {
    dispatchKey(browser, character);
  }
}

function characterKey(document, label) {
  return [...document.querySelectorAll('.character-key')]
    .find((button) => button.textContent === label);
}

function interactiveInputControls(document) {
  return [
    ...document.querySelectorAll('.character-key'),
    document.querySelector('.call-key'),
    document.querySelector('.clear-key'),
  ];
}

function allSessionControls(document) {
  return [
    ...document.querySelectorAll('.character-key'),
    document.querySelector('.call-key'),
    document.querySelector('.clear-key'),
    document.querySelector('.back-key'),
    document.querySelector('.home-key'),
  ];
}

async function settlePromise() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  for (const controller of controllers.splice(0)) {
    controller.destroy();
  }
  for (const browser of browsers.splice(0)) {
    browser.window.close();
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('complete browser UI boundary', () => {
  it('loads index.html without the API module and mounts the exact idle phone shell', async () => {
    const browser = createBrowser();
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.document = browser.window.document;
    globalThis.window = browser.window;

    try {
      vi.resetModules();
      await import('../../src/ui/main.js');
      if (!browser.window.document.querySelector('.retro-phone')) {
        browser.window.document.dispatchEvent(
          new browser.window.Event('DOMContentLoaded'),
        );
      }

      const { document } = browser.window;
      const root = document.querySelector('#app');
      const enclosure = document.querySelector('.retro-phone');
      const keypad = document.querySelector('.keypad');
      const characterKeys = [...document.querySelectorAll('.character-key')];

      expect(existsSync(apiPath)).toBe(false);
      expect(document.querySelectorAll('script[type="module"][src="/src/ui/main.js"]')).toHaveLength(1);
      expect(root.children).toHaveLength(1);
      expect(document.querySelectorAll('.retro-phone')).toHaveLength(1);
      expect(document.querySelectorAll('.lcd-display')).toHaveLength(1);
      expect(document.querySelectorAll('.screen-output')).toHaveLength(1);
      expect(document.querySelectorAll('.input-line')).toHaveLength(1);
      expect(document.querySelectorAll('.keypad')).toHaveLength(1);
      expect(characterKeys.map((button) => button.textContent)).toEqual([
        '1', '2', '3',
        '4', '5', '6',
        '7', '8', '9',
        '*', '0', '#',
      ]);
      expect(keypad.children).toHaveLength(12);
      expect(enclosure.querySelectorAll('.call-key')).toHaveLength(1);
      expect(enclosure.querySelectorAll('.clear-key')).toHaveLength(1);
      expect(keypad.querySelector('.call-key')).toBeNull();
      expect(keypad.querySelector('.clear-key')).toBeNull();
      expect(document.querySelector('.screen-output').textContent).toBe('Dial *266# to begin');
      expect(document.querySelector('.input-line').textContent).toBe('');
      expect(enclosure.dataset.lifecycle).toBe('idle');

      typeText(browser, '*266#');
      expect(document.querySelector('.input-line').textContent).toBe('*266#');
      document.querySelector('.call-key').click();
      expect(document.querySelector('.screen-output').textContent).toContain('1 Ask the Oracle');
      expect(enclosure.dataset.lifecycle).toBe('interactive');

      characterKey(document, '1').click();
      document.querySelector('.call-key').click();
      expect(document.querySelector('.screen-output').textContent).toContain('Ask the Oracle');
      expect(document.querySelector('.input-line').textContent).toBe('');
    } finally {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    }
  });

  it('passes exact browser input and dependencies to one engine invocation, then renders literal result text', () => {
    const returnedState = {
      view: { kind: 'main' },
      nested: { marker: 'adopt by reference' },
    };
    const unsafeText = 'Line 1\r\n<&>"\'\n<script>window.hacked = true</script>\rLine 3';
    const returnedScreen = { type: 'CON', text: unsafeText };
    const transition = vi.fn(() => ({ state: returnedState, screen: returnedScreen }));
    const aiProvider = vi.fn();
    const { browser, controller, document } = mountBoundary({ transition, aiProvider });

    typeText(browser, '*266#');
    document.querySelector('.call-key').click();

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(null, '*266#', aiProvider);
    expect(controller.getSnapshot().engineState).toBe(returnedState);
    expect(controller.getSnapshot().screen).toBe(returnedScreen);
    expect(document.querySelector('.screen-output').textContent).toBe(unsafeText);
    expect(document.querySelector('.screen-output').childElementCount).toBe(0);
    expect(document.querySelector('.screen-output script')).toBeNull();
    expect(browser.window.hacked).toBeUndefined();
    expect(document.querySelector('.input-line').textContent).toBe('');
  });

  it('shows deferred loading before settlement, blocks duplicate actions, adopts fulfillment, and recovers from rejection', async () => {
    const activeState = { view: { kind: 'question', mode: 'oracle' }, retained: 'first' };
    const fulfilledState = { view: { kind: 'answer' }, retained: 'fulfilled' };
    const firstPending = deferred();
    const secondPending = deferred();
    const transition = vi.fn()
      .mockReturnValueOnce(con(activeState, 'Ask your question'))
      .mockReturnValueOnce(firstPending.promise)
      .mockReturnValueOnce(secondPending.promise);
    const audio = createAudioRecorder();
    const {
      aiProvider,
      browser,
      controller,
      document,
    } = mountBoundary({ transition, audio });

    typeText(browser, '*266#');
    document.querySelector('.call-key').click();
    transition.mockClear();
    audio.keyBeep.mockClear();

    typeText(browser, 'why?');
    document.querySelector('.call-key').click();

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(activeState, 'why?', aiProvider);
    expect(controller.getSnapshot()).toMatchObject({
      engineState: activeState,
      lifecycle: 'loading',
      inputBuffer: '',
      multiTap: null,
    });
    expect(document.querySelector('.screen-output').textContent).toBe('Contacting the spirits...');
    expect(allSessionControls(document).every((control) => control.disabled)).toBe(true);
    expect(audio.startConnecting).toHaveBeenCalledTimes(1);

    transition.mockClear();
    audio.keyBeep.mockClear();
    document.querySelector('.call-key').click();
    document.querySelector('.back-key').click();
    document.querySelector('.home-key').click();
    characterKey(document, '7').click();
    dispatchKey(browser, 'x');
    dispatchKey(browser, 'Enter');

    expect(transition).not.toHaveBeenCalled();
    expect(audio.keyBeep).not.toHaveBeenCalled();
    expect(controller.getSnapshot().inputBuffer).toBe('');

    const fulfilledScreen = { type: 'CON', text: 'Spirit answer\n1.More 0.Back' };
    firstPending.resolve({ state: fulfilledState, screen: fulfilledScreen });
    await settlePromise();

    expect(controller.getSnapshot().engineState).toBe(fulfilledState);
    expect(controller.getSnapshot().screen).toBe(fulfilledScreen);
    expect(controller.getSnapshot().lifecycle).toBe('interactive');
    expect(document.querySelector('.screen-output').textContent).toBe(fulfilledScreen.text);
    expect(allSessionControls(document).every((control) => !control.disabled)).toBe(true);
    expect(audio.stopConnecting).toHaveBeenCalledTimes(1);

    transition.mockClear();
    typeText(browser, 'retry');
    document.querySelector('.call-key').click();
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(fulfilledState, 'retry', aiProvider);
    expect(controller.getSnapshot().lifecycle).toBe('loading');

    secondPending.reject(new Error('private rejection detail'));
    await settlePromise();

    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: 'error',
      inputBuffer: '',
      multiTap: null,
      screen: null,
    });
    expect(controller.getSnapshot().engineState).toBe(fulfilledState);
    expect(document.querySelector('.screen-output').textContent).toBe('Request failed. Try again.');
    expect(document.querySelector('.screen-output').textContent).not.toContain('private rejection detail');
    expect(interactiveInputControls(document).every((control) => !control.disabled)).toBe(true);

    typeText(browser, 'r');
    expect(document.querySelector('.input-line').textContent).toBe('r');
  });

  it('keeps keypad 0 as U+0020 SPACE while Back and Home submit exact navigation values once', () => {
    const questionState = { view: { kind: 'question', mode: 'oracle' }, marker: 'question' };
    const transition = vi.fn(() => con(questionState, 'Ask your question'));
    const audio = createAudioRecorder();
    const {
      aiProvider,
      browser,
      controller,
      document,
    } = mountBoundary({ transition, audio });

    document.querySelector('.call-key').click();
    transition.mockClear();
    audio.keyBeep.mockClear();

    typeText(browser, 'stale');
    characterKey(document, '0').click();
    expect(document.querySelector('.input-line').textContent).toBe('stale ');
    expect(controller.getSnapshot().multiTap).toMatchObject({ digit: '0', index: 0 });
    expect(document.querySelector('.input-line').textContent.endsWith('\u0020')).toBe(true);

    transition.mockImplementationOnce((state, input, provider) => {
      expect(document.querySelector('.input-line').textContent).toBe('');
      expect(controller.getSnapshot().multiTap).toBeNull();
      expect(state).toBe(questionState);
      expect(input).toBe('0');
      expect(provider).toBe(aiProvider);
      return con(questionState, 'Ask your question');
    });
    transition.mockClear();
    audio.keyBeep.mockClear();
    document.querySelector('.back-key').click();

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(questionState, '0', aiProvider);
    expect(audio.keyBeep).toHaveBeenCalledTimes(1);

    typeText(browser, 'old');
    characterKey(document, '0').click();
    expect(document.querySelector('.input-line').textContent).toBe('old ');
    transition.mockImplementationOnce((state, input, provider) => {
      expect(document.querySelector('.input-line').textContent).toBe('');
      expect(controller.getSnapshot().multiTap).toBeNull();
      expect(state).toBe(questionState);
      expect(input).toBe('00');
      expect(provider).toBe(aiProvider);
      return con({ view: { kind: 'main' } }, 'Main menu');
    });
    transition.mockClear();
    audio.keyBeep.mockClear();
    document.querySelector('.home-key').click();

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(questionState, '00', aiProvider);
    expect(audio.keyBeep).toHaveBeenCalledTimes(1);
  });

  it('uses the real engine and mock provider for 1,200 ms paging and the 1,500 ms END pause', async () => {
    const aiProvider = createMockAIProvider({
      setTimeoutFn: setTimeout,
    });
    const transition = vi.fn(next);
    const audio = createAudioRecorder();
    const {
      browser,
      controller,
      document,
    } = mountBoundary({ transition, aiProvider, audio });

    typeText(browser, '*266#');
    document.querySelector('.call-key').click();
    characterKey(document, '1').click();
    document.querySelector('.call-key').click();
    typeText(browser, 'How do I revise?');

    const startedAt = Date.now();
    document.querySelector('.call-key').click();
    expect(controller.getSnapshot().lifecycle).toBe('loading');
    expect(document.querySelector('.screen-output').textContent).toBe('Contacting the spirits...');

    const loadingSnapshot = controller.getSnapshot();
    const loadingCalls = transition.mock.calls.length;
    audio.keyBeep.mockClear();
    document.querySelector('.back-key').click();
    document.querySelector('.home-key').click();
    characterKey(document, '9').click();
    dispatchKey(browser, 'z');
    expect(controller.getSnapshot()).toEqual(loadingSnapshot);
    expect(transition).toHaveBeenCalledTimes(loadingCalls);
    expect(audio.keyBeep).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1199);
    expect(controller.getSnapshot().lifecycle).toBe('loading');
    expect(document.querySelector('.screen-output').textContent).toBe('Contacting the spirits...');

    await vi.advanceTimersByTimeAsync(1);
    const elapsed = Date.now() - startedAt;
    const answerSnapshot = controller.getSnapshot();
    expect(elapsed).toBeGreaterThanOrEqual(1100);
    expect(elapsed).toBeLessThanOrEqual(1300);
    expect(answerSnapshot.lifecycle).toBe('interactive');
    expect(answerSnapshot.engineState.view.kind).toBe('answer');
    expect(answerSnapshot.engineState.view.pages.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('.screen-output').textContent).toBe(
      answerSnapshot.engineState.view.pages[0],
    );

    document.querySelector('.home-key').click();
    expect(controller.getSnapshot().engineState.view.kind).toBe('main');
    document.querySelector('.back-key').click();

    expect(controller.getSnapshot().lifecycle).toBe('end-pause');
    expect(document.querySelector('.screen-output').textContent).toBe(EXIT_MESSAGE);
    expect(allSessionControls(document).every((control) => control.disabled)).toBe(true);

    const endedSnapshot = controller.getSnapshot();
    const endedCalls = transition.mock.calls.length;
    audio.keyBeep.mockClear();
    characterKey(document, '1').click();
    document.querySelector('.call-key').click();
    document.querySelector('.back-key').click();
    document.querySelector('.home-key').click();
    dispatchKey(browser, 'x');
    dispatchKey(browser, 'Enter');
    expect(controller.getSnapshot()).toEqual(endedSnapshot);
    expect(transition).toHaveBeenCalledTimes(endedCalls);
    expect(audio.keyBeep).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1499);
    expect(controller.getSnapshot().lifecycle).toBe('end-pause');
    expect(document.querySelector('.screen-output').textContent).toBe(EXIT_MESSAGE);

    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toEqual({
      engineState: null,
      lifecycle: 'idle',
      inputBuffer: '',
      multiTap: null,
      screen: null,
    });
    expect(document.querySelector('.screen-output').textContent).toBe('Dial *266# to begin');
    expect(document.querySelector('.input-line').textContent).toBe('');
  });

  it('keeps Back and Home disabled in idle without changing buffered input', () => {
    const {
      audio,
      browser,
      controller,
      document,
      transition,
    } = mountBoundary();

    typeText(browser, 'waiting');
    audio.keyBeep.mockClear();
    const idleSnapshot = controller.getSnapshot();

    expect(idleSnapshot).toMatchObject({
      lifecycle: 'idle',
      inputBuffer: 'waiting',
      multiTap: null,
    });
    expect(document.querySelector('.back-key').disabled).toBe(true);
    expect(document.querySelector('.home-key').disabled).toBe(true);

    document.querySelector('.back-key').click();
    document.querySelector('.home-key').click();

    expect(controller.getSnapshot()).toEqual(idleSnapshot);
    expect(transition).not.toHaveBeenCalled();
    expect(audio.keyBeep).not.toHaveBeenCalled();
  });

  it('preserves Promise and END lifecycles when navigation is attempted while disabled', async () => {
    const questionState = {
      view: { kind: 'question', mode: 'oracle' },
      marker: 'question',
    };
    const endedState = { status: 'ended', marker: 'finished' };
    const pending = deferred();
    const transition = vi.fn()
      .mockReturnValueOnce(con(questionState, 'Ask your question'))
      .mockReturnValueOnce(pending.promise);
    const audio = createAudioRecorder();
    const {
      aiProvider,
      browser,
      controller,
      document,
    } = mountBoundary({ transition, audio });

    document.querySelector('.call-key').click();
    typeText(browser, 'stale');
    characterKey(document, '0').click();
    expect(controller.getSnapshot()).toMatchObject({
      inputBuffer: 'stale ',
      multiTap: { digit: '0', index: 0 },
    });

    transition.mockClear();
    audio.keyBeep.mockClear();
    document.querySelector('.back-key').click();

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(questionState, '0', aiProvider);
    expect(controller.getSnapshot()).toMatchObject({
      engineState: questionState,
      lifecycle: 'loading',
      inputBuffer: '',
      multiTap: null,
    });
    expect(audio.keyBeep).toHaveBeenCalledTimes(1);
    expect(audio.startConnecting).toHaveBeenCalledTimes(1);
    expect(audio.stopConnecting).not.toHaveBeenCalled();

    transition.mockClear();
    audio.keyBeep.mockClear();
    const loadingSnapshot = controller.getSnapshot();
    document.querySelector('.back-key').click();
    document.querySelector('.home-key').click();

    expect(controller.getSnapshot()).toEqual(loadingSnapshot);
    expect(transition).not.toHaveBeenCalled();
    expect(audio.keyBeep).not.toHaveBeenCalled();
    expect(audio.startConnecting).toHaveBeenCalledTimes(1);
    expect(audio.stopConnecting).not.toHaveBeenCalled();

    const endScreen = { type: 'END', text: 'The spirits release the line.' };
    pending.resolve({ state: endedState, screen: endScreen });
    await settlePromise();

    expect(controller.getSnapshot()).toMatchObject({
      engineState: endedState,
      lifecycle: 'end-pause',
      inputBuffer: '',
      multiTap: null,
      screen: endScreen,
    });
    expect(document.querySelector('.screen-output').textContent).toBe(endScreen.text);
    expect(audio.stopConnecting).toHaveBeenCalledTimes(1);

    const endedSnapshot = controller.getSnapshot();
    document.querySelector('.back-key').click();
    document.querySelector('.home-key').click();

    expect(controller.getSnapshot()).toEqual(endedSnapshot);
    expect(transition).not.toHaveBeenCalled();
    expect(audio.keyBeep).not.toHaveBeenCalled();
    expect(audio.stopConnecting).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1499);
    expect(controller.getSnapshot()).toEqual(endedSnapshot);

    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toEqual({
      engineState: null,
      lifecycle: 'idle',
      inputBuffer: '',
      multiTap: null,
      screen: null,
    });
    expect(audio.stopConnecting).toHaveBeenCalledTimes(1);
  });
});
