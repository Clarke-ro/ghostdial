import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountPhoneUI } from '../../src/ui/phone-ui.js';
import { sessionStateLabel } from '../../src/ui/render.js';

const mounted = [];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function con(state, text = 'The line is open...\n1 Ask the Oracle') {
  return { state, screen: { type: 'CON', text } };
}

function end(state, text = 'The line goes dead... Goodbye.') {
  return { state, screen: { type: 'END', text } };
}

async function settlePromise() {
  await Promise.resolve();
  await Promise.resolve();
}

// Mount the real phone in a jsdom page with a manual timer queue so the END
// pause can be finished on demand.
function mountBrowser(transition) {
  const browser = new JSDOM('<main id="app"></main>', { url: 'http://ghostdial.test/' });
  const timers = [];
  const controller = mountPhoneUI(browser.window.document.querySelector('#app'), {
    transition,
    aiProvider: vi.fn(),
    setTimeoutFn: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeoutFn: () => {},
  });
  mounted.push({ browser, controller });

  const document = browser.window.document;
  return {
    controller,
    document,
    sessionText: () => document.querySelector('.session-state').textContent,
    runTimers: () => timers.splice(0).forEach((callback) => callback()),
  };
}

afterEach(() => {
  for (const { browser, controller } of mounted.splice(0)) {
    controller.destroy();
    browser.window.close();
  }
});

describe('LCD status bar', () => {
  it('sits at the top of the LCD with signal bars, a No Data tag, and the session state', () => {
    const { document } = mountBrowser(vi.fn());
    const lcd = document.querySelector('.lcd-display');
    const statusBar = document.querySelector('.status-bar');

    expect(document.querySelectorAll('.status-bar')).toHaveLength(1);
    expect(lcd.firstElementChild).toBe(statusBar);
    expect(document.querySelector('.keypad').contains(statusBar)).toBe(false);

    const signal = statusBar.querySelector('.signal-bars');
    expect(signal).not.toBeNull();
    expect(signal.getAttribute('aria-hidden')).toBe('true');
    expect(statusBar.querySelector('.no-data-tag').textContent).toBe('No Data');
    expect(statusBar.querySelector('.session-state').textContent).toBe('IDLE');

    // The status bar is separate from the screen text and adds no buttons.
    expect(statusBar.contains(document.querySelector('.screen-output'))).toBe(false);
    expect(statusBar.querySelectorAll('button')).toHaveLength(0);
  });

  it('follows the lifecycle: IDLE, DIAL while loading, CON, END, then IDLE again', async () => {
    const pending = deferred();
    const transition = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(end({ status: 'ended' }));
    const { controller, document, sessionText, runTimers } = mountBrowser(transition);

    expect(sessionText()).toBe('IDLE');

    controller.dispatch({ type: 'call' });
    expect(controller.getSnapshot().lifecycle).toBe('loading');
    expect(sessionText()).toBe('DIAL');

    pending.resolve(con({ view: { kind: 'main' } }));
    await settlePromise();
    expect(controller.getSnapshot().lifecycle).toBe('interactive');
    expect(sessionText()).toBe('CON');
    expect(document.querySelector('.session-state').getAttribute('data-state')).toBe('CON');

    controller.dispatch({ type: 'call' });
    expect(controller.getSnapshot().lifecycle).toBe('end-pause');
    expect(sessionText()).toBe('END');

    runTimers();
    expect(controller.getSnapshot().lifecycle).toBe('idle');
    expect(sessionText()).toBe('IDLE');
  });

  it('shows IDLE after a failed dial and CON after a failure inside a session', async () => {
    const firstFailure = deferred();
    const secondFailure = deferred();
    const transition = vi.fn()
      .mockReturnValueOnce(firstFailure.promise)
      .mockReturnValueOnce(con({ view: { kind: 'main' } }))
      .mockReturnValueOnce(secondFailure.promise);
    const { controller, sessionText } = mountBrowser(transition);

    controller.dispatch({ type: 'call' });
    firstFailure.reject(new Error('no spirits'));
    await settlePromise();
    expect(controller.getSnapshot()).toMatchObject({ lifecycle: 'error', engineState: null });
    expect(sessionText()).toBe('IDLE');

    controller.dispatch({ type: 'call' });
    expect(sessionText()).toBe('CON');

    controller.dispatch({ type: 'call' });
    expect(sessionText()).toBe('DIAL');
    secondFailure.reject(new Error('static'));
    await settlePromise();
    expect(controller.getSnapshot().lifecycle).toBe('error');
    expect(sessionText()).toBe('CON');
  });

  it('maps every lifecycle to one of IDLE, DIAL, CON, or END', () => {
    expect(sessionStateLabel('idle')).toBe('IDLE');
    expect(sessionStateLabel('loading')).toBe('DIAL');
    expect(sessionStateLabel('interactive')).toBe('CON');
    expect(sessionStateLabel('end-pause')).toBe('END');
    expect(sessionStateLabel('error', false)).toBe('IDLE');
    expect(sessionStateLabel('error', true)).toBe('CON');
    expect(sessionStateLabel('unknown')).toBe('IDLE');
  });
});
